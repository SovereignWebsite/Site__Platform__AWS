# Design 03: every service in one shape (service APIs, decoders, the activity reader, the graph)

Written by architect.aws.a@SovereignWebsite.dinis, 23 November 2026 ~10:50 UTC. Status: **proposed**. For dev.2.aws.a (API layer) to build, cloudformation.aws.a, cloudtrail.aws.a, ontology.aws.a, ux.aws.a and lambda.aws.a to challenge, aws.c to land, security.aws.a to review. It settles four questions open at hand-over: cloudformation.aws.a's CfnApi and Route53Api sketch, cloudtrail.aws.a's event shape, ux.aws.a's shared decoders, and ontology.aws.a's "does twin-graph.json fit site/api/?". Sources: design 01 and 02; `site/api/s3-api.js` on dev; work/dev.2.aws.a ee3c03e; docs/cloudformation/2026-11-23__seed-and-read-api.md; docs/cloudtrail/2026-11-23__02-event-shape.md and its reader (work/cloudtrail.aws.a); docs/ontology/twin-graph.schema.json (work/ontology.aws.a); docs/design/ (ux.aws.a).

## The problem

S3Api set a good pattern, and five more areas are now sketching their own: CfnApi and Route53Api (cloudformation.aws.a), a Lambda and Firehose page (lambda.aws.a), a CloudTrail reader (cloudtrail.aws.a), a graph builder (ontology.aws.a), and a Files console that needs gzip, JSON Lines and CSV as tables (ux.aws.a). Each is sound alone. Without one shape they will page, fail, decode and name resources five ways, and the five UIs (Map, Timeline, Files, Desk, Command) will each need adapters for each area. The aim of this design is that a UI, given any area, can list it, read it, show its activity and draw its graph with the same few calls.

## The decision, in four parts

```
 UIs (Map, Timeline, Files, Desk, Command)
   |           |              |             |
 Graph      Activity       Decode       XxxApi.*          <- four kinds of thing, each one shape
 (nodes,    (events in     (bytes ->    (plain objects
  edges)     one shape)     rows)        per service)
   ^           ^              ^             |
   +-----------+--------------+-------------+
                              |
                      send(req) -> Response     (design 01: AwsTransport, AWS or the twin)
```

### 1. One shape for every service API

Every service API is a factory over the same `send` S3Api takes, sets one global, and follows these rules:

| Rule | Why |
|---|---|
| `XxxApi(send)` returns an object of methods; no state but `send` | Testable in Node over the twin or a recording `send`, as S3Api is |
| Methods return plain objects with **short lower-case names** (`name`, `region`, `status`, `created`) and AWS's own values for enumerations (`UPDATE_ROLLBACK_COMPLETE`, not "rolled back") | The UI words them; the API never translates meaning |
| Every resource object carries **`arn`** (or the ARN AWS would give it) | The graph, the activity reader and the UIs join on it (part 4) |
| **List methods return one page: `{ items, next }`**, `next` null at the end; `XxxApi.all(page => ...)` (one shared helper) drains pages up to a cap and says when it stopped at the cap | The UI shows the first page fast; a "load all" is explicit and bounded. S3Api's `listBuckets()` (which drains) and `listObjects` (`{ folders, files, next }`) stay as landed; new APIs follow this rule |
| Errors: an `Error` with `message` "Code: Message", `.code`, `.status`; a CORS `TypeError` passes through unchanged | As S3Api, so `Platform.awsError` and every UI handle every service the same way |
| Reads only. Changes are plans (`plan.js`) and Approve, never an API method | Design 01; R-002, R-008 |
| One OpenAPI document per service, `site/api/<svc>.openapi.json`, operation IDs = method names, `x-aws-actions` per operation, a contract test that checks each method's real request against its listed actions (dev.2.aws.a's test generalised) | The least-privilege list for template v3 is generated, not hand-kept |

**CfnApi and Route53Api** (cloudformation.aws.a's sketch) are adopted with three changes to fit the rules: `stacks()` and `zones()` and `records()` return `{ items, next }`; every stack, resource, zone and record carries its ARN (records, which have none in AWS, get the graph's `twin:`/derived id, below); and `importers(export)` stays, but the Map calls it lazily per export, not once per export at load. Its seed files go to `site/twin/packs/` data under design 02, not to a separate `data/` folder.

**LambdaApi and FirehoseApi** follow the same rules over the twin's read answers already on dev (d55d463): `functions()`, `function(name)`, `streams()`, `stream(name)`.

### 2. One decoder library (`site/api/decode.js`, global `Decode`)

Bytes in, typed results out; no DOM, no network, runs in Node:

```
Decode.sniff(bytes, { name, contentType })  -> "gzip" | "zip" | "json" | "jsonl" | "csv" | "text" | "binary"
Decode.gunzip(bytes)                        -> Promise<Uint8Array>   (DecompressionStream, as s3.js does)
Decode.json(text)                           -> value | throws with line and column
Decode.jsonLines(text, { max })             -> { columns, rows, errors: [{ line, message }] }
Decode.csv(text, { max })                   -> { columns, rows, errors }   (RFC 4180: quotes, embedded commas and newlines)
Decode.table(value)                         -> { columns, rows }   (an array of objects, or CloudTrail's { Records: [...] })
```

- Tables share one form, `{ columns, rows, errors }`, so the Files console's sortable table, data.aws.a's investigation views and the CloudTrail reader all take the same thing.
- `zip.js` stays as it is (ranged reads); `Decode` is what runs on an entry once it is inflated.
- Limits are part of the API, not of each caller: `max` rows (default 50 000), a byte cap before decoding (default 50 MB unpacked), and a bad line is an `errors` entry, not a stop. Never `eval`, never HTML: callers write values through `textContent`, as s3.js does today.
- s3.js's own gzip and JSON Lines code (s3.js:215-231) moves to `Decode` in one step, owned by s3.aws.a, with no change a user can see.

### 3. One activity shape (cloudtrail.aws.a's event shape, adopted as is)

cloudtrail.aws.a's shape (`id, time, iso, service, action, region, account, who, from, change, category, failed, targets, words, raw`) becomes **the** event every Timeline and per-asset activity view reads, from any source:

- CloudTrail files (the reader, as written), and later LookupEvents;
- CloudFront log lines, normalised by data.aws.a into the same shape (`service: "cloudfront"`, `action: "GET"`, `who.kind: "web"`, `targets` the object), so one timeline shows both an attack's requests and the role changes around it;
- on the twin, the same files the twin serves: the reader never reads twin internals.

The reader moves from docs/cloudtrail/reader/ to `site/api/activity.js` (global `Activity`) when the path allows. Two small changes: `targets[].id` is the graph node id (the ARN, or the same `twin:` id the graph uses), and `raw` is dropped from objects passed to the graph (kept for the detail panel only), so a large dump does not double in memory.

### 4. The graph is built in the page, from the APIs (answer to ontology.aws.a)

**Does twin-graph.json fit site/api/? Its schema does; the file itself does not.** twin-graph.json is built offline by `docs/ontology/build-twin-graph.mjs` reading the twin's source. A page cannot do that on real AWS, and a graph read from twin internals breaks "the code should not know the difference". So:

- `site/api/graph.js` (`Graph({ account })`, an instance per account so two accounts never mix; dev.2.aws.a 237c397) builds nodes and edges **at run time, from the service APIs and the activity reader only**, in ontology.aws.a's schema (`twin-graph.schema.json`: node `id, type, label, altitude`, edge `from, rel, to, evidence, source`). One small adapter per service turns its API objects into nodes and edges (`Graph.add.s3(buckets)`, `Graph.add.cfn(stacks, resources, exports)`, `Graph.add.route53(zones, records)`, `Graph.add.activity(events)`), so a new area adds one adapter, not a new graph.
- Evidence follows the schema: an edge from an API answer is `api`; from a stack's resources, `template`; from inside a file (a log line naming a vault, a config naming a bucket), `content`; from a naming rule, `naming`. Every edge's `source` names the call or file, so a user can check it.
- The schema moves to `site/api/graph.schema.json` as data (no code), owned jointly: ontology.aws.a owns the terms, the architect owns the file's place in the API.
- **twin-graph.json becomes the golden test**: `Graph` built over the twin, per pack, must give the same nodes and edges ontology.aws.a's offline builder gives, except edges whose evidence is `curated` or `comment`, which only a person or the source can supply. A difference is a bug in one of the two, found on the spot.
- Node ids: the ARN where AWS defines one; otherwise a derived id that is stable across sources (`twin:` in the schema today). Proposal to ontology.aws.a: rename the prefix to `urn:sws:` (for example `urn:sws:route53-record:Z123/www.example.com/A`), since these ids also name real resources, not only twin ones.
- Altitudes: the graph keeps A0 to A5 on nodes, as the schema has them; design 02's `why` on journal entries feeds A5 on the twin only, and real accounts get A5 from curated mappings. Both meet in the same node ids.

## Options considered

| Question | Options | Chosen | Why |
|---|---|---|---|
| Paging | drain always / one page always / both | One page plus a shared `all` with a cap | Fast first paint; bounded memory; one explicit place where "everything" is asked for |
| Where decoders live | in each console / in s3.js / one library | One library in site/api/ | Five UIs and two areas already need the same four decoders; limits enforced once |
| Event shape | per source / OCSF / cloudtrail.aws.a's | cloudtrail.aws.a's, with OCSF class as a field later | Already written and tested, fits CloudFront lines too; OCSF adds names the UIs do not need yet (the schema already has `ocsf_class` for nodes) |
| Graph | prebuilt file / built from twin internals / built from APIs at run time | From APIs at run time, prebuilt file as test | The only option that works on real AWS and keeps the code blind to the back end |

## Code shape

```
site/api/s3-api.js  cfn-api.js  route53-api.js  lambda-api.js  firehose-api.js   one per service
site/api/<svc>.openapi.json                                                      one per service
site/api/all.js             XxxApi.all: drain pages with a cap (shared)
site/api/decode.js          Decode
site/api/activity.js        Activity (cloudtrail.aws.a's reader)
site/api/graph.js           Graph and its per-service adapters
site/api/graph.schema.json  ontology.aws.a's schema, as data
test/api/<svc>-api.test.mjs  decode.test.mjs  activity.test.mjs  graph.test.mjs (golden: twin-graph*.json)
```

## Order (each a small finished piece for dev.2.aws.a, after getBucketCors)

1. `decode.js` with tests (lift from s3.js; s3.aws.a then switches s3.js to it).
2. `cfn-api.js` and `route53-api.js` with contracts and tests, once cloudformation.aws.a's twin patch (docs/cloudformation/patches/) is landed by aws.c.
3. `activity.js` from cloudtrail.aws.a's reader, with its fixtures.
4. `graph.js` with the S3 and CloudFormation adapters and the golden test against twin-graph.json.
5. Lambda and Firehose APIs and adapters.

## Security notes for security.aws.a

- All of `site/api/**` is code on the hub's origin: **R-010 applies**, as for S3Api; nothing here lands until decision 3 is answered or aws.c lands it after review. The schema and the OpenAPI documents are data loaded by no page, the lowest-risk part.
- Decoders read files the user chose or objects in the user's own buckets: caps on bytes and rows, errors as data, no `eval`, no HTML. A hostile log line (a path with `<script>`) must render as text in every view; a test per decoder asserts it.
- The graph and activity views show real ARNs and addresses from the user's own account in the user's own page, and keep them nowhere else (no localStorage, no network).

## Agreed refinements (cloudformation.aws.a, 10:41 UTC)

1. **Derived ARNs are marked.** ListStackResources gives only physical ids, so CfnApi derives ARNs per type (S3 bucket `arn:aws:s3:::<name>`; IAM role `arn:aws:iam::<acct>:role/<name>`; CloudFront `arn:aws:cloudfront::<acct>:distribution/<id>`; Lambda `arn:aws:lambda:<region>:<acct>:function:<name>`; hosted zone `arn:aws:route53:::hostedzone/<id>`), uses a physical id that is already an ARN as it is, and sets `arnDerived: true` on every derived one. A derived ARN can be wrong (a role with a path), so the graph lets the owning service's own answer overwrite it. A type with no rule gets `urn:sws:cfn-resource:<stackArn>/<logicalId>`, never a guess.
2. **`next` is opaque.** Services page differently (CloudFormation `NextToken`; ListHostedZones `Marker`/`NextMarker`; ListResourceRecordSets the triple `StartRecordName`, `StartRecordType`, `StartRecordIdentifier`), so each API encodes its own cursor into `next` and only it reads it back. The twin needs a paging seed case per service later (cloudformation.aws.a's patch 2c9b62a returns one page, enough for four stacks).
3. **Record ids** are `urn:sws:route53-record:<zoneId>/<name>/<type>[/<setIdentifier>]`, the name normalised (lower case, trailing dot removed, Route 53's octal escapes decoded, `\052` is `*`), the set identifier included when present, since weighted, latency and failover records share a name and type.
4. **Seed region:** `demo-dns` is in eu-west-2 (cloudformation.aws.a's patch), since an export can only be imported in its own region.
5. **Decode says what it cut and what it saw** (ux.aws.a): every table result carries `truncated: { rows, bytes }` (booleans) and `rowsRead`, so a console says "showing the first 50 000 rows" instead of implying it saw everything; `gunzip` resolves to `{ bytes, packed, unpacked }` (sizes for the "n KB gzip -> n KB" line); and each column gets a `hint` (`number`, `time` or `text`, from the first 200 rows) in `columns: [{ name, hint }]`, computed once in Decode so sort and the Timeline's time axis never guess twice. Zip stays as today: `sniff` says `zip`, zip.js lists and inflates, Decode reads each entry.
6. **Activity ids** (cloudtrail.aws.a, done on work/cloudtrail.aws.a): `targets[].id` is the graph node id, checked against twin-graph.json; each event carries `node` (its own graph id, from `eventID`); the derived prefix is one constant, so `urn:sws:` is a one-line switch; `CloudTrailReader.forGraph(e)` drops `raw`. `ct-alarms.js` moves to site/api/ beside the reader. Done with `urn:sws:` ids (cloudtrail-trail, cloudtrail-event), checked against ontology.aws.a's 849f77a graph. The reader keeps the caller's address in `from.ip` and makes no node for it; `Graph.add.activity` makes the `urn:sws:actor-ip:<ip>` node and its `acted_on` edges, so an address in the attack pack links to everything it touched.
7. **The golden test, exactly** (ontology.aws.a, done on work/ontology.aws.a 849f77a): ids are now `urn:sws:<kind>:<name>` (schema pattern `^(arn:aws:|urn:sws:[a-z0-9-]+:)`), all three graphs regenerated. `graph.test.mjs` compares node `id`, `type`, `altitude` and edge `from`, `rel`, `to`, `evidence` only (node facts such as request counts are not compared), skips `curated` and `comment` edges, and first applies the page's CORS fix to the twin's demo-site bucket (Cloud Control UpdateResource, as a user's Approve would), since that bucket has no CORS rule and its objects are otherwise unreadable. cloudtrail.aws.a switches its derived prefix constant to `urn:sws:`.

## Open questions

1. ontology.aws.a: agreed both (refinement 7).
2. cloudtrail.aws.a: agree `targets[].id` = graph node id and `raw` kept out of the graph?
3. cloudformation.aws.a: agree the three changes to CfnApi and Route53Api?
4. ux.aws.a: does `Decode`'s `{ columns, rows, errors }` give the Files console what its wireframes need (per-column counts are computed by the console from `rows`)?
5. Not blocking, for Dinis via pm.aws.a: none.
