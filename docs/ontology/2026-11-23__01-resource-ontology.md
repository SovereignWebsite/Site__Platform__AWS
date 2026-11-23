# Ontology 01: the resource graph, first draft over the twin

Written by ontology.aws.c@SovereignWebsite.dinis, 23 November 2026. Status: **draft**, for architect.aws.c and the area agents to challenge, and for the UIs to read. Pipeline P2 ("a gigantic graph that connects the whole lot"); memo sections 9 (everything hyperlinked), 21 (altitudes) and 22 (data you can follow). Built only from the twin (site/twin.js at dev 4433914) and the hub's own template (site/cloudformation/bootstrap.yaml). No AWS was called.

The graph itself is in [twin-graph.json](twin-graph.json): every node and every edge of the twin's synthetic account 111122223333, each edge with the evidence it rests on.

## What a user gets from this

Open any asset and see everything known to connect to it, and how we know. For the twin's CloudFront-logs bucket that reads:

> **111122223333--demo-cloudfront-logs--eu-west-2** (S3 bucket, eu-west-2)
> - receives logs from **the Firehose delivery stream** for **demo-distribution-1** (inferred: object names and a code comment; the twin has no Firehose API yet)
> - is named as the log destination in **config/site.yaml** in the demo site bucket (read from the file)
> - holds 9 log files, 20 to 22 Nov, 09:00 to 11:00, 225 requests from 203.0.113.0/24
> - the log lines name paths under **vault-demo-001** and **vault-demo-002** (read from the log lines)
> - made by: unknown (no stack in the twin claims it); costs: not yet broken down

That is the test for every view built on this ontology: a first-time user can see what an asset is, what it touches, and which of those links are seen, read or guessed.

## 1. Public ontologies we build on

We invent as little as possible; Dinis: "a lot of these ontology and taxonomies are public stuff ... We just connected the dots."

| Need | Public source we reuse | How |
|---|---|---|
| Resource type names | AWS CloudFormation resource type identifiers (`AWS::S3::Bucket`, `AWS::IAM::Role`, `AWS::Lambda::Function` ...) and the Cloud Control resource schemas AWS publishes for them | The `type` of every node is the CloudFormation type name, so a node maps one-to-one to a template resource and to Cloud Control `GetResource`, which the twin already answers |
| Identity of a node | Amazon Resource Names (ARNs) | The node `id` is the ARN where AWS defines one; otherwise a `twin:` URI marked as ours |
| "Made by", "derived from", "written by" | W3C PROV-O (`prov:wasGeneratedBy`, `prov:wasDerivedFrom`, `prov:wasAttributedTo`, `prov:used`) | Relations of provenance carry the PROV-O term beside ours, so the graph exports to RDF without a mapping table |
| Activity in the logs | OCSF (Open Cybersecurity Schema Framework), its API Activity and HTTP Activity classes | A CloudTrail record and a CloudFront log line become event nodes whose fields follow OCSF names where they exist (actor, api.operation, src_endpoint.ip, http_request.url.path) |
| Plain metadata | Dublin Core terms (`dcterms:created`, `dcterms:modified`, `dcterms:format`) | Object dates and content types |

Not yet checked line by line against each standard's current version: the terms above are named from the standards as published; boto3.aws.c is asked to check the AWS ones against AWS's documentation.

## 2. Types (the taxonomy)

The twelve types named for this role, plus the few the twin forces on us. Grouped by what a user would call them.

| Group | Type | CloudFormation type | In the twin today |
|---|---|---|---|
| Where | account | (none; an AWS account) | 111122223333 |
| Where | region | (none) | eu-west-2, eu-west-1, us-east-1 |
| Storage | bucket | `AWS::S3::Bucket` | 4 |
| Storage | object | (none; S3 object) | 15 |
| Delivery | distribution | `AWS::CloudFront::Distribution` | 1, inferred |
| Delivery | stream | `AWS::KinesisFirehose::DeliveryStream` | 1, inferred, unnamed |
| Delivery | record | `AWS::Route53::RecordSet` | 0 |
| Compute | function | `AWS::Lambda::Function` | 1, inferred from its dependency zip |
| Control | stack | `AWS::CloudFormation::Stack` | 1 (sws-aws-platform) |
| Identity | role | `AWS::IAM::Role` | 3, plus 1 referenced that does not exist |
| Identity | policy | `AWS::IAM::ManagedPolicy` (and inline policies) | 2 AWS managed, attached to the read role |
| Identity | identity provider | `AWS::IAM::OIDCProvider` for GitHub Actions; Google is trusted directly as a web identity provider, with no resource | 2 (Google, GitHub Actions) |
| Watch | trail | `AWS::CloudTrail::Trail` | 1, inferred from its bucket |
| Watch | alarm | `AWS::CloudWatch::Alarm` | 0 |
| Activity | event | (none; a CloudTrail record or a log line) | 2 CloudTrail records, 225 log lines |
| Business | vault | (none; ours) | 2 |
| Business | site | (none; ours) | 1 (the demo site) |

`record`, `alarm` and Route 53 zones have no twin data yet: listed so the schema is ready, not drawn.

## 3. Relations

Each relation has a direction, a reading in plain English both ways (so the UI can show it from either end), and a PROV-O term where one fits.

| Relation | From, to | Reads forward / backward | PROV-O |
|---|---|---|---|
| `in` | region to account, resource to region | is in / contains | |
| `holds` | bucket to object | holds / is held by | |
| `made_by` | resource to stack | was made by / made | `prov:wasGeneratedBy` |
| `writes_to` | stream to bucket | writes to / receives from | |
| `logs_to` | distribution to stream, trail to bucket | sends its logs to / receives logs from | |
| `serves_from` | distribution to bucket | serves from / is the origin of | `prov:used` |
| `packages` | object (zip) to function | is the code of / runs code from | `prov:wasDerivedFrom` (backward) |
| `trusts` | role to identity provider | trusts / is trusted by | |
| `allows_subject` | role to external principal | may be assumed by / may assume | |
| `has_policy` | role to policy | has / is attached to | |
| `acted_as` | event to role | was done as / did | `prov:wasAttributedTo` |
| `acted_on` | event to resource or object | acted on / was acted on by | `prov:used` |
| `records` | object (log file) to event | records / is recorded in | |
| `refers_to` | object to anything | names / is named in | |
| `part_of` | resource to site, vault to site | is part of / is made of | |

## 4. Evidence: how we know each link

A user must see which links are seen and which are guessed; AWS mixes the two silently. Every edge carries one of:

| Evidence | Meaning | Example in the twin |
|---|---|---|
| `api` | An AWS API (or the twin answering as one) returned it | `GetRole` returns the DNS role's trust to GitHub's OIDC provider |
| `template` | A CloudFormation template declares it | bootstrap.yaml makes both platform roles |
| `content` | Read from inside a file or record | site.yaml names the logs bucket; a CloudTrail record names the role it ran as |
| `naming` | Inferred from a name or key pattern | `demo-distribution-1` from the log file names |
| `comment` | Only a code comment says so | "CloudFront logs delivered by Firehose" in twin.js |

`naming` and `comment` edges are drawn dashed, and every one is a question for the twin's engine (design 02 onward): give the twin the API, and the edge becomes `api`.

## 5. Altitudes

Memo section 21: atoms at the bottom, business functions at the top, a graph per altitude, connected. Proposed mapping, using the memo's own words:

| Altitude | Memo's word | Nodes | Twin example |
|---|---|---|---|
| A0 | atoms | fields and values | `c_ip 203.0.113.7`, a role ARN, a key |
| A1 | cells | events and objects | one log line, one CloudTrail record, `data/vaults.json` |
| A2 | molecules | resources | a bucket, a role, a stack |
| A3 | organs | systems of resources | the demo site: distribution, site bucket, stream, logs bucket |
| A4 | people | actors | a visitor, the read role, a GitHub workflow |
| A5 | civilisation | business functions | "a visitor reads a vault's files", "the Factory changes DNS" |

Each node lives at one altitude; `part_of` and `records` are the edges that cross altitudes, so a click on a business function walks down to the log lines that prove it, and a click on an IP walks up to what it was doing (memo section 22, "link mode").

## 6. Found as a by-product

Mapping the twin already shows two things worth a look, the kind of finding memo section 9 asks for:

1. **A dangling reference.** The twin's CloudTrail record of `UpdateAssumeRolePolicy` names role `demo-dns-role`, but the only DNS role in the twin's IAM is `sovereignwebsite-factory-dns`. In a real account this would mean the role was renamed or deleted; in the twin it is probably a seed inconsistency. For aws.c to decide which (twin.js, the CloudTrail seed).
2. **Unowned resources.** No stack in the twin claims any of the four buckets, the stream, the distribution or the function. The graph shows them as "made by: unknown", which is the untidy-account view Dinis asked for; cloudformation.aws.c may want the twin to seed a stack for the demo site.

## 7. Gaps in the twin (asks for the twin's engine)

For the graph to rest on `api` evidence, the twin needs read APIs it does not have yet: CloudFront (`GetDistribution`, for the origin and logging), Firehose (`DescribeDeliveryStream`, for the destination), Lambda (`GetFunction`, for the code location), CloudTrail (`DescribeTrails`), IAM `ListAttachedRolePolicies` and `ListRoles`, Route 53 zones and records, CloudWatch alarms. Sent to architect.aws.c as input for design 02, not built here.

## 8. Next

- architect.aws.c: does the node and edge shape in twin-graph.json fit the API layer (site/api/)? A schema file (JSON Schema) follows once the shape is agreed.
- The UIs: the "connected to" panel above is the first view; one per node type, five UIs as for every view.
- Me, next wake: a generator that builds twin-graph.json from the twin itself, so the graph never drifts from the data, and the per-altitude views as a storyboard.

## 9. Draft 01.1: the graph is now generated (ontology.aws.a, 23 Nov 2026, 04:15 UTC)

ontology.aws.a@SovereignWebsite.dinis takes this role over from ontology.aws.c. [build-twin-graph.mjs](build-twin-graph.mjs) now builds [twin-graph.json](twin-graph.json) from the twin itself: it loads site/twin.js as the page does and asks it over the same AWS calls the page makes (Cloud Control, S3 ListObjectsV2 and GetObject, IAM GetRole, CloudFormation DescribeStacks and GetTemplate). Nothing leaves the process; no AWS, no network. `node docs/ontology/build-twin-graph.mjs --check` fails when the file and the twin disagree, so the graph cannot drift silently.

Regenerated at dev 003976e (demo pack "baseline"): **47 nodes, 96 edges** (api 29, content 39, naming 11, template 8, curated 7, comment 2).

Changes to the schema, each small and reversible:

- **Evidence `curated`.** Links no file states on its own (the demo site's parts, the business function) were marked `content` with source "this draft"; they are now `curated`, so a user can tell the ontologist's assertions from what the data says.
- **Type `prefix`.** A folder of more than 50 objects is one node with its count and size (the twin's `archive/2026/`, 1,203 objects), so the graph stays readable; a click opens the S3 browser there.
- **Relation `signed_in_via`** (event to identity provider), from CloudTrail's `webIdFederationData`.
- **Ids.** The account is `twin:account/111122223333` (`arn:aws:::<account>` is not an ARN form AWS defines); the trail is `twin:cloudtrail/trail/demo`, since its region is not known from the data. Events use CloudTrail's `eventID`.
- **Facts on nodes, read from the data:** bytes and dates on objects; requests and time range on each log file; 225 requests from 148 addresses on the logs bucket; memory and timeout on the function (from config.json in its zip); `browser_readable` on buckets.

Findings, replacing section 6:

1. **Fixed:** the dangling `demo-dns-role` (section 6.1) was a seed inconsistency, fixed by aws.c in 787735b; the graph no longer has it.
2. **New, for aws.c:** the twin's stack is `CREATE_COMPLETE` and STS lets the page assume both platform roles, but IAM `GetRole` answers `NoSuchEntity` for `sws-aws-platform-read` and `sws-aws-platform-change`. A user who opens either role from the map would see "not found". Suggest: the twin's IAM answers GetRole for the roles the template declares.
3. **Visible on purpose:** the demo site bucket has no CORS rule, so a browser cannot read it until the page's fix is applied (the graph applies the same fix in memory to see inside). Shown as `browser_readable: false`.
4. **Still open:** no stack claims the five buckets, the stream, the distribution or the function (section 6.2).
5. **New bucket** `demo.static.example` (dots in its name) is in the graph with its one object; nothing links to it yet.

Next: per-pack graphs (the attack pack adds an actor, 203.0.113.66, with its probes as events), a JSON Schema for the node and edge shape once architect.aws.c agrees it, and the "connected to" panel spec for ux.aws.c.

## 10. Draft 01.2: one graph per demo pack (ontology.aws.a, 23 Nov 2026, 06:20 UTC)

The twin has three demo packs (site/twin.js: baseline, attack, surge). The generator now builds one graph each: `node docs/ontology/build-twin-graph.mjs --all` writes twin-graph.json (baseline), twin-graph.attack.json and twin-graph.surge.json; `--check --all` fails if any of them drifts from the twin. Baseline keeps its file name, so nothing that reads it changes.

What a user sees change between packs, all read from the log lines:

| Pack | Requests | vault-demo-001 | vault-demo-002 | Actors |
|---|---|---|---|---|
| Normal day (baseline) | 225 | 32 (14%) | 29 (13%) | none |
| Attack in progress | 315 | 41 (13%) | 28 (9%) | 203.0.113.66: 90 requests, all refused, 9 distinct paths, sqlmap, Nuclei and curl; targeted vault-demo-001 |
| Traffic surge | 2,250 | 1,696 (75%) | 96 (4%) | none |

Schema additions, each small and reversible:

- **Type `actor`** (A4): an address that stands out. The rule is on the data, not a list of known bad addresses: at least 10 requests and at least 80% refused (4xx). The rule is written on the node, so a user can see why it is there. Normal visitors stay a count on the logs bucket.
- **Relations `seen_in`** (actor to the log files that hold its lines) and **`targeted`** (actor to a vault named in its paths), both `content`.
- **Facts on vaults:** `requests` and `share_of_requests`, so the surge's hot vault is visible on the vault itself.

For the UIs (ux.aws.c, viz.aws.c): the attack graph is the first with a story to follow: actor, then the hours it was seen in, then the vault it went for. For security.aws.c: the actor rule is a starting point to tune, not a detector.

## 11. Draft 01.3: the twin's new APIs replace guesses (ontology.aws.a, 23 Nov 2026, 08:30 UTC)

The twin now answers Lambda (ListFunctions) and Firehose (ListDeliveryStreams, DescribeDeliveryStream), and IAM knows the platform's two roles (dev 88148db). The generator asks those APIs, so links that were guesses are now answers. Regenerated at dev 6985180: **53 nodes, 104 edges** (api 44, content 38, naming 11, curated 7, template 4); the attack pack adds the scanner as before.

| Link | Was | Now |
|---|---|---|
| The stream and the logs bucket | a code comment, stream unnamed | `demo-cloudfront-logs`, from DescribeDeliveryStream (`api`), with its prefix, compression and buffer |
| The stream's processor | not known | `transforms_with` demo-log-enricher (`api`) |
| The zip and demo-handler | zip name (`naming`) | the function's CodeSha256 equals the zip's SHA-256 (`api`): AWS's own identity for a package |
| Functions | one, inferred from the zip | three, from ListFunctions, with runtime, memory, timeout and code size |
| Platform roles trust Google | template | IAM GetRole (`api`); a link stated twice keeps the stronger evidence |
| Countries | none | requests per country on the logs bucket, from the field the enricher adds to each line |

Schema additions: relations **`runs_as`** (function or stream to its IAM role) and **`transforms_with`** (stream to its processing function). The distribution's link to the stream is `naming`: its log files sit under the stream's prefix; a CloudFront API in the twin would make it `api`.

Findings, replacing section 9's:

1. **Fixed:** IAM GetRole now answers for both platform roles (dev 3608235).
2. **New, for aws.c and lambda.aws.a:** the four execution roles the new APIs name (demo-handler-role, demo-log-enricher-role, demo-nightly-report-role for the functions; demo-cloudfront-logs-firehose for the stream) are not in the twin's IAM: GetRole says NoSuchEntity. In a real account a function cannot run without its role, so a user opening one from the map would see a broken link. Suggest the twin's IAM answers for them, with a trust policy for lambda.amazonaws.com and firehose.amazonaws.com.
3. **Still open:** no stack claims the buckets, the stream, the functions or the distribution (cloudformation.aws.a has a seed for review).

## 12. The graph's schema (ontology.aws.a, 23 Nov 2026, 10:25 UTC)

[twin-graph.schema.json](twin-graph.schema.json) (JSON Schema 2020-12) is the contract for anything that reads the graphs: the 22 node types, 20 relations, six evidence levels and six altitudes, the required fields of a node (id, type, label, altitude) and of an edge (from, rel, to, evidence, source), and the id form (an ARN, or `twin:` where AWS defines none). Nodes may carry other facts; edges may not, so every link stays one shape.

The generator checks each graph against it before writing, plus what JSON Schema cannot say: ids are unique, every edge end is a node, the counts add up. A graph that fails is not written. All three graphs also pass a full JSON Schema 2020-12 validator.

For architect.aws.c: this is the shape proposed for site/api/ to serve and the UIs to read (section 8 asked for agreement first; this draft is what to agree on). Adding a type or relation is one line in the schema and the doc.

## 13. Agreed with architect.aws.a: the page builds the graph; these files are its golden test (23 Nov 2026, 10:50 UTC)

Design 03 part 4 (work/architect.aws.a 7af86f6) puts the graph builder in the page (`site/api/graph.js`), built from the service APIs at run time so it works on real AWS, with this schema moved to `site/api/graph.schema.json` as data. Agreed: it is the only way the graph works on a real account. The three twin-graph files become the golden test: Graph over the twin, per pack, must equal this builder's output, except edges whose evidence is `curated` or `comment`.

Two details for the test, so it compares like with like:

- Compare node `id`, `type`, `altitude` and edge `from`, `rel`, `to`, `evidence`. Facts on nodes (request counts, sizes) depend on how much a view has read and are not compared.
- The twin's demo site bucket has no CORS rule, so a browser cannot list it. This builder applies the page's own fix in the twin's memory (Cloud Control UpdateResource) before listing; the test must do the same first, or Graph sees the bucket as unreadable and its objects are missing.

**Ids renamed: `twin:` is now `urn:sws:<kind>:<name>`**, since these ids name real resources too, not only twin ones. Kinds in use: account, region, vault, site, cloudfront-distribution, cloudtrail-trail, cloudtrail-event, idp, github-subject, actor-ip, business-function, lambda-function (fallback only). ARNs stay ARNs. The schema's id pattern is now `^(arn:aws:|urn:sws:[a-z0-9-]+:)`. Altitudes are unchanged; nothing is lost.

## 14. CloudTrail addresses are actors too (23 Nov 2026, 11:05 UTC)

At architect.aws.a's ask (design 03 refinement 6), each CloudTrail record's `sourceIPAddress` becomes an `actor` node, `urn:sws:actor-ip:<ip>`, with an `acted_on` edge (`content`) to whatever the record acted on, the same as the page's `Graph.add.activity`. In the twin, 203.0.113.7 now links to `data/vaults.json` and to the DNS role whose trust it changed. CloudFront addresses still become actors only by the refused-requests rule (section 10), so normal visitors stay a count. Graphs: 54 nodes, 106 edges (baseline and surge); 55 and 110 (attack). dev.2.aws.a's graph test (work/dev.2.aws.a 237c397) still passes against them, and can now drop its exception for actor-ip edges.

## 15. Trust: what AWS answered apart from what files claim (23 Nov 2026, 11:45 UTC)

security.aws.a's R-020: anything read from inside a bucket (CloudTrail files, CloudFront logs, vault JSON, config, zip metadata) can be planted by whoever can write that bucket. Design 03's "Trust of evidence" (work/architect.aws.a ce15b3e) answers it, and the schema and builder now carry it:

- Every edge has **`trust`**: `verified` for `api` and `template`, `claimed` for `content`, `naming` and `comment`, `curated` for `curated`. A link stated by two sources keeps the stronger evidence, so it is verified if any source is.
- Every node has `trust`: `verified` if any verified edge names it, otherwise `claimed`.
- The graph and every node have **`backend`**: `twin` here; the page sets it from its mode, so a twin graph is never merged with an AWS one.

On the twin (baseline): 43 nodes verified, 11 claimed; 48 edges verified, 51 claimed, 7 curated. The claimed nodes are what a user should treat as unconfirmed: the CloudTrail events and the address in them, the distribution and the trail (known only from names), the vaults and the site (known only from files), the two regions known only from file contents, and in the attack pack the scanner. Claimed evidence may raise a question in the UI, never drive a plan.

Refined 11:40 UTC with architect.aws.a (design 03): a node is `verified` if any verified edge names it, else `curated` if any curated edge names it, else `claimed`; a person's word is not a file's claim. Baseline now: 43 verified, 5 curated (the business function, the site, the two vaults, demo-distribution-1), 6 claimed. Note: the vaults and the distribution read `curated` only because a curated `part_of` or `refers_to` edge touches them; their own existence still rests on files and names.

Refined again 11:45 UTC (architect.aws.a took the stricter version): a node not verified is `curated` only when every edge naming it is curated; otherwise `claimed`. A curated edge touching a node known from files does not vouch for its existence.
