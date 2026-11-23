# Design 02: the twin's engine (world, journal, packs, scenarios, actors, edits, feeds)

Written by architect.aws.a@SovereignWebsite.dinis, 23 November 2026 ~08:50 UTC, taking over from architect.aws.c. Status: **proposed**. For dev.1.aws.a and dev.2.aws.a to build, aws.c (keeper of `site/twin*`) to agree the paths, security.aws.a to review. Sources: the memo part 4 (sections 17 to 23), design 01, `site/twin.js` as it stands on dev (88148db, 359 lines), vaults.aws.a's vault twin contract (work/vaults.aws.a, ef248c8), https://coding.sgit.ai and https://nfrs.sgit.ai.

## The problem

Twin v0 works and has grown fast: S3, Cloud Control, STS, IAM, CloudFormation, Cost Explorer, Lambda and Firehose answer from one file, and three demo packs (normal day, attack, surge) change the data. But the memo asks for much more than one file can carry:

- packs loaded on demand that change every view (section 19);
- scenarios over time (an attack in progress, a surge) and synthetic users making changes (19);
- a twin you can browse and **edit**, with generators ("create many buckets at once") and three ways in: from scratch with outside data, a pack plus outside data, or instrumented from outside (20);
- altitudes, each with its own graph, so side effects show (21);
- data you can follow, back and forward in time (22, pipeline P5).

Today a pack is a flag read inside `build()`, so each new pack means more `if`s in the generator, the data is fixed at load, an edit has nowhere to go, and nothing records *why* a thing exists. That is the part to design now, before more services are added the same way.

## The decision

**The twin's state is a fold over a journal.** Every fact in the synthetic account is the result of an entry in one append-only journal; the world the services answer from is what you get by applying the entries in order. Everything that changes the twin writes entries, and nothing else changes it:

```
 packs (JSON) ──compile──┐
 generators ─────────────┤
 scenarios (over time) ──┤──> Journal (append-only, ordered by twin time)
 actors (synthetic users)┤           │ fold
 edits (UI, sliders) ────┤           v
 feeds (outside data) ───┘        World  (buckets, objects, functions, streams, roles, records ...)
                                     │
                     service twins answer from it, at the wire (design 01)
                                     │
                     AwsTransport.fetch  <-  S3Api, the five UIs, the actors
```

A journal entry:

```json
{ "seq": 1042, "t": "2026-11-22T10:04:40Z", "actor": "admin:demo-admin",
  "op": "s3.putObject", "target": "arn:aws:s3:::111122223333--demo-site--eu-west-2/index.html",
  "data": { "type": "text/html", "body": { "gen": "page", "seed": 17 } },
  "why": "user.publishes-page", "source": "scenario:attack#3" }
```

- `op` names an operation on the world (`s3.createBucket`, `s3.putObject`, `lambda.createFunction`, `iam.updateAssumeRolePolicy`, `cloudfront.request` ...), one small pure function each, `(world, entry) -> world`.
- `actor` is who did it (a role, a synthetic visitor, an admin, the pack itself), so CloudTrail and the access logs are **derived** from the journal, not seeded separately: one cause, every side effect.
- `why` names the business function at the top altitude (section 21: "the user sends a file, the user creates a vault"). ontology.aws.a's altitudes hang off it: an altitude is a grouping of `op`s under a `why`.
- `source` says where the entry came from (pack, generator, scenario step, actor, edit, feed), so the UI can show and undo by source.
- Bodies stay lazy: `body` is a generator reference with its own seed, materialised only when a GetObject asks, exactly as v0 does with promises today. The journal stays small (kilobytes), the bytes stay real.

## Why a journal, and not a mutable object (options)

| Option | For | Against | Verdict |
|---|---|---|---|
| **A. Journal folded into a world** | One place every change goes; CloudTrail, access logs and the graph's edges fall out of it; time travel is replay to a point (P5); undo is drop-and-refold; packs, scenarios, edits and feeds are the same kind of thing; export is the journal itself (JSON Lines), which is exactly what a vault append lane holds (vaults.aws.a) | Replay cost on big worlds (mitigated: snapshots every N entries, lazy bodies) | **Chosen** |
| B. Mutable world, edits change it in place | Simplest; what v0 does | No history, so no time travel, no "why", no undo; CloudTrail has to be faked apart from the change it describes, and drifts | Rejected |
| C. Per-service stores, each with its own seed | Services stay independent | The cross-service links (stream writes to bucket, function built from zip, record points at distribution) are the graph; split stores lose them | Rejected |
| D. A database in the page (SQLite WASM) | Queries | A heavy dependency for the twin's core; the journal can feed one later for data.aws.a's investigations | Later, as a reader of the journal, not the store |

nfrs.sgit.ai's "no mocks": the twin is still answered at the wire; the journal only changes how its state is made.

## The parts

### World

A plain object of maps keyed by ARN, with the relations the graph needs held as ARNs (a stream's destination bucket, a function's code object, a role's trust). `World.apply(entry)` dispatches to the `op`'s function. Services read only the world; they never hold state of their own. Snapshots (a structured clone) every 500 entries make "go to time t" cheap.

### Determinism

Every generator, scenario and actor draws from **its own named random stream** (`rng("pack:baseline/logs")`), seeded from the pack seed and the name. v0 learned this with latency (`lag()` has its own generator so the data does not depend on call order); this makes it the rule, so adding a generator never shifts the data another one makes. Same pack and same journal give the same bytes, in Node and in the browser.

### Packs

A pack is **data**, not code: a JSON file that names a seed, the generators to run with their parameters, and the scenarios to arm.

```json
{ "id": "attack", "title": "Attack in progress", "seed": 20261123, "clock": "2026-11-22T12:00:00Z",
  "about": "One address scanning for secrets and admin pages, then trying path traversal on the vault API, among normal visitors.",
  "generate": [ { "gen": "account.platform" }, { "gen": "site.static" },
                { "gen": "cloudfront.traffic", "from": "2026-11-20T09:00Z", "to": "2026-11-22T12:00Z", "perHour": 25 } ],
  "scenarios": [ { "id": "probe", "start": "2026-11-22T09:00Z" } ],
  "see": [ { "label": "the CloudFront logs of 22 November", "href": "#/s3/111122223333--demo-cloudfront-logs--eu-west-2/cloudfront/2026/11/22/" } ] }
```

Compiling a pack runs its generators, which emit journal entries. v0's three packs become three JSON files with the same output, which is the first test (below).

### Generators

A generator is a function `(params, rng, clock) -> entries[]`: `site.static`, `cloudfront.traffic`, `lambda.fromZip`, `trail.fromJournal`, `buckets.many(n, pattern)`. The sliders in the edit UI are generator parameters ("create many buckets at once" is `buckets.many` with a slider on `n`). Generators that describe a *consequence* (Firehose writing the hour's log file, CloudTrail writing its five-minute file) are **derivations**: they read the journal and emit entries, so they run again after any edit and the logs always match what happened.

### Twin clock and scenarios

The twin has its own clock: paused, real time, or faster (×10, ×60), which is what viz.aws.a's "follow the packet" replay and the P5 time slider need. A scenario is a script of timed steps that emit entries as the clock passes them (`at +0m: probe /.env ×15; at +60m: louder`). security.aws.a writes scenarios as data (what an attack looks like in the logs); viz.aws.a shows them. A scenario armed in a pack starts with the pack; one picked later starts at the current twin time.

### Actors (synthetic users)

An actor is a small loop driven by the twin clock that **calls the site's own APIs through the transport** (S3Api, later VaultApi), as a visitor or an admin would, with its own twin credentials. It does not write the journal directly: its calls reach the service twins, which turn writes into entries with `actor` set. So actors exercise the same code path the UIs use, and their activity shows in CloudTrail exactly as a real user's would. Read-only actors (visitors) produce `cloudfront.request` entries through a tiny edge twin.

### Edits

The edit UI (browse the world, change a field, run a generator) writes entries with `source: "edit"`. Undo drops the entry and refolds. An edit that would be impossible in AWS (a bucket name with capitals, a key over 1024 bytes) is refused with the error AWS would give, so the twin cannot be edited into a state the real code never meets.

### Feeds (outside data)

A feed turns outside records into entries: a CloudTrail dump (cloudtrail.aws.a's normalised event shape maps one event to one entry, `actor` from `userIdentity`, `op` from `eventSource` and `eventName`), a CloudFront log file, a vault's append lane. The three ways in (section 20) are then just three starting journals: empty plus feed; pack plus feed; or a feed only, watched as it arrives (instrument).

### More back ends

vaults.aws.a's vault twin contract is one more service twin behind the same router (its host, its routes), answering from the same world (`vault.*` ops), so a vault write and the CloudFront request that carried it are one journal story. The batch body stays open until the SG/Send browser library's source is in hand, as vaults.aws.a says; the twin answers 501 for it until then (fail closed, design 01).

## Code shape

One idea per file, each setting one global, no bundler, as the site does today:

```
site/twin.js                 router: host -> service twin (as now), and AwsTwin's public surface
site/twin/world.js           TwinWorld: apply, snapshot, at(t)
site/twin/journal.js         TwinJournal: append, entries, export/import JSON Lines
site/twin/rng.js             named deterministic streams
site/twin/clock.js           TwinClock: pause, play, speed, at
site/twin/ops/s3.js          s3.* ops (pure)        site/twin/ops/lambda.js, iam.js, ...
site/twin/svc/s3.js          S3 wire answers from the world (moved from twin.js)   svc/lambda.js, ...
site/twin/gen/*.js           generators and derivations
site/twin/packs/*.json       baseline.json, attack.json, surge.json
site/twin/scenarios/*.json   probe.json, surge.json
test/twin/*.test.mjs         fold, determinism, packs, derivations, wire fidelity
```

`site/twin/**` and `test/twin/**` are aws.c's today; this design asks aws.c to grant them to the developers (dev.1.aws.a, dev.2.aws.a) as each step lands. The CSP does not change: no network, and packs load as same-origin JSON.

## Migration (small steps, each shippable, each keeps the page working)

1. **Journal and world under v0.** Add `world.js`, `journal.js`, `rng.js`; make `build()` emit entries into the journal and fold them, with the same data out. Test: every object key, size and ETag for each of the three packs is byte-for-byte what v0 gives today (a golden file made from dev 88148db).
2. **Packs as JSON.** Move the three packs to `site/twin/packs/`; `PACKS` in twin.js becomes the loaded list. Same golden test.
3. **Derivations.** CloudTrail and the Firehose hour files derived from the journal instead of seeded apart. Test: every journal entry with a role actor has exactly one CloudTrail record; every `cloudfront.request` is in exactly one hour file.
4. **Split the services** into `svc/*.js` one at a time behind the router; test/twin and the e2e test stay green throughout.
5. **Clock and the first scenario** (probe, from the attack pack), then the edit UI's first generator (`buckets.many`), then the first actor (a visitor), then the first feed (a CloudTrail dump).

Steps 1 and 2 are one developer-day each and change no page; they are the right first task for dev.1.aws.a. dev.2.aws.a stays on the API layer (below).

## Tests

- **Golden**: v0's output per pack, kept in `test/fixtures/`, so the refactor provably changes nothing.
- **Determinism**: same pack, two runs, identical journal and bytes; adding a generator leaves the others' output unchanged.
- **Fold laws**: replaying the journal from a snapshot equals replaying from the start; undo then redo gives the same world.
- **Derivations**: one cause, one record (step 3).
- **Fidelity**: unchanged from design 01 (bodies and errors match AWS's documented examples).

## Security notes for security.aws.a

- The journal is synthetic data only. Feeds bring outside data into the page: a feed reads a file the user picks (no network), parses it as data (JSON, never `eval`), and caps its size. A real CloudTrail dump can hold real account IDs and addresses; the twin shows them only in the user's own page and never stores them beyond the page (no localStorage for journal contents; export is a download the user asks for).
- The banner rule from design 01 holds: a world built from a real feed is still labelled "Twin", with the feed named, so nobody mistakes it for live AWS.
- Actors hold only twin credentials (`ASIATWIN...`), which the AWS back end can never accept.
- **R-010 applies.** `site/twin/**` is code served on the hub's origin, where the change role's session lives. Granting it to developers is the same question as decision 3 (R-010) for `site/api/**`, so it waits on Dinis's answer there. Until then steps 1 to 5 are built on the developers' branches and landed by aws.c after security.aws.a's review; packs and scenarios as JSON data (never evaluated) are the lowest-risk part and can go first.

## Review of the developers' branches (this wake)

- **dev.2.aws.a, work/dev.2.aws.a (a0e3d47)**: `s3.openapi.json` 0.3.0 matches S3Api as landed (774fc03); both contract tests pass here (openapi 10, s3-api 31). The Cloud Control handler actions are now listed from boto3.aws.a's note, with their source and the names still to check called out rather than guessed. **Agreed; ready to land** when aws.c or the paths allow. One design point it surfaces: `getBucket` through Cloud Control's `GetResource` needs all 22 read handler actions, while the S3 browser uses only the region and the CORS rule. Proposal for the next S3Api step (dev.2.aws.a): read those two with S3's own `GetBucketLocation` and `GetBucketCors` (two actions: `s3:GetBucketLocation`, `s3:GetBucketCORS`) and keep Cloud Control for the bucket list, which shrinks the read role by 20 actions. aws.c and iam.aws.a to weigh it for template v3.
- **dev.1.aws.a**: no branch on the remote yet; first task proposed above (steps 1 and 2).

## Open questions

1. For aws.c, once Dinis answers decision 3 (R-010): grant `site/twin/**` and `test/twin/**` to dev.1.aws.a for steps 1 and 2? (Recommendation: yes; v0's file stays the router, so the change is reviewable step by step. Until then, aws.c lands each step after review.)
2. For ontology.aws.a: does `why` on each entry, grouped by altitude, fit your altitude model, or do you want a separate mapping file from `op` to altitude? (Recommendation: `why` on the entry, mapping file for the altitudes above it.)
3. For cloudtrail.aws.a: your normalised event shape becomes the feed's input; confirm `eventSource` + `eventName` -> `op` is enough, or name what else must survive.
4. Not blocking, for Dinis via pm.aws.a: none.
