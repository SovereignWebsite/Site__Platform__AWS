# The extract workflow: first design (EX-1)

Written by data.aws.c@SovereignWebsite.dinis, 23 Nov 2026, first wake. Read from site/twin.js and site/transport.js at dev 4433914, the memo (items 6 and the "investigation mode" note), docs/board/ and docs/s3/2026-11-23__first-note.md. No live AWS: everything here is from the twin's code. Numbers about the twin were computed by replaying its seed (see "What is in the bucket").

## The question it answers

Dinis: visibility of what the sites behind S3 are doing, "including all of the ... vault usage, including what vaults are being accessed". For a first-time user that means one page that answers, without reading a single log line:

1. How much traffic, and when? (an hour-by-hour strip)
2. What was asked for, and what failed? (top paths, errors)
3. Which vaults were touched, how often, from where, and when last?
4. Click any value (a path, a vault, an edge, an hour) and see the lines behind it, and the resource it refers to (memo: "link" mode).

## What is in the twin's bucket

Bucket `111122223333--demo-cloudfront-logs--eu-west-2` (twin.js:55), seeded at twin.js:69-80:

- **Layout:** `cloudfront/YYYY/MM/DD/HH/demo-distribution-1-YYYY-MM-DD-HH-00-00.gz`, the Firehose-style hourly prefix. 9 objects: 20 to 22 Nov, hours 09, 10 and 11 only. LastModified is HH:59.
- **Format:** gzip of JSON Lines, one object per line, newline at the end.
- **Fields (9):** `timestamp`, `c_ip`, `cs_method`, `cs_uri_stem`, `sc_status`, `sc_bytes`, `time_taken`, `x_edge_location`, `cs_user_agent`.
- **Contents (replayed):** 225 records, 25 per file; 1,077,558 bytes served; 148 distinct client IPs, all in 203.0.113.0/24 (the documentation range); status 200 x190, 404 x35 (every 404 is `/favicon.ico`); edges LHR50-C1 84, DUB2-C1 71, AMS1-C1 70; agents curl 89, python-requests 69, Mozilla 67.
- **Vault usage:** paths `/vault/<id>/files`. vault-demo-001: 32 requests (20 Nov 10, 21 Nov 9, 22 Nov 13). vault-demo-002: 29 (14, 5, 10).
- **Lines are not in time order** within a file (108 of 216 neighbouring pairs go backwards). Real Firehose output is not guaranteed sorted either, so the extract must sort, not assume.

### Three findings for the twin (aws.c owns twin.js)

1. **The log contents depend on call order.** `handle` (twin.js:215) calls `rnd()` for its fake latency from the same seed the log generator uses, and STS calls do not call `build()`. So a page that assumes a role before listing S3 (the normal path) gets different logs from a test that lists S3 first. The numbers above hold only if the bucket is built before any other twin call. Suggest: a second generator for latency, so the seeded data is the same every time and tests can assert exact counts.
2. **Fields the extract and its neighbours will need are missing.** No request id (`x-edge-request-id`: the key that joins a log line to the packet in P1 and to a CloudTrail or Lambda record), no host or distribution id in the record (only in the file name), no query string, no referrer, no cache result (`x-edge-result-type`: hit or miss, which billing.aws.c needs for P4), no bytes received, no content type, and only GET. Suggest adding these to the seed, with a few 5xx, a POST, and a burst from one IP.
3. **The field names are the twin's own.** Real CloudFront logs name fields with hyphens (`c-ip`, `cs-uri-stem`) in their header, and the shape that arrives depends on how logging is set up (standard logs, standard logging v2 to Firehose, or real-time logs through Kinesis). Which one Dinis's distributions use, and the exact field list, is to be read from AWS's documentation and then from the real bucket, not assumed here. The extract keeps a mapping per source so either names work.

## The workflow, in five steps

One small JavaScript module of pure functions (no DOM, no network of its own): it is handed bytes and returns records and summaries. The same file runs in the page, in node for tests, and later in a GitHub Action. It reads only through AwsTransport, so on the twin it never touches the network (transport.js fails closed).

1. **Discover.** List the prefix (paging past 1,000 keys), group keys by hour, and show what is there before reading anything: files per day and hour, sizes, gaps (missing hours are a finding in themselves, for example a stopped Firehose stream). Cheap: listing only.
2. **Read.** Stream each object through DecompressionStream; split into records. Accept JSON Lines, concatenated JSON with no delimiter (`}{`, common in Firehose output, s3.aws.c's note item 6), several gzip members in one file (to be tested, not assumed), and tab-separated lines with a `#Fields` header. Each record keeps where it came from: object key and line number, so any number on screen links back to the exact lines.
3. **Normalise** to one record shape (schema v0):

   | Field | From | Note |
   |---|---|---|
   | `t` | timestamp | ISO, UTC; also `hour` for grouping |
   | `client` | c_ip | see "Privacy" below |
   | `method`, `path`, `status`, `bytes`, `ms` | cs_method, cs_uri_stem, sc_status, sc_bytes, time_taken x 1000 | |
   | `edge`, `edge_city` | x_edge_location | `LHR50-C1` gives `LHR` |
   | `agent_kind` | cs_user_agent | browser, script (curl, python), bot, other |
   | `kind` | path | page, asset, data, vault, other (rules in one table, easy to change) |
   | `vault` | path | the id in `/vault/<id>/`, else empty |
   | `src` | key and line | provenance for link mode |

4. **Summarise** into small tables: per hour (requests, bytes, errors, p50 and p95 time); per path; per status class; per edge; per agent kind; and per vault (requests per day, first and last seen, distinct clients, edges). These are what the page draws; the raw records stay available for drill-down.
5. **Move.** Stage one, web first: nothing is written anywhere. Results live in the page, with a download as JSON. Stage two: a GitHub Action with a scoped OIDC role runs the same module on new hours and writes the summaries to a separate bucket or prefix, and the browser reads those instead of every raw file. Writing to S3 is a change to AWS: it is a plan for aws.c to prepare and Dinis to approve, with its own least-privilege role. Not proposed for approval yet.

**Incremental by design:** a small manifest of processed objects (key, ETag, size) so each run reads only new hours. Firehose itself may go later (memo item 6); the module does not care who wrote the files.

## What the first-time user sees

Opening the logs bucket in the S3 browser offers "Summarise these logs" on any folder of `.gz` log files. One page, in this order:

- A line in words first: "225 requests over 9 hours, 20 to 22 Nov; 35 failed (all /favicon.ico); 2 vaults used."
- A strip of hours (bars), gaps shown as gaps, not hidden.
- Vault cards: id, requests by day, last seen, where from. Click one: its lines.
- Top paths and errors, with every value clickable (link mode).
- A plain note of what was read: how many files, how many lines skipped and why.

Progress is shown per file, and a folder of thousands of hours is summarised from listing first, then read on request. It works on the twin today and on real data unchanged.

## Privacy

Client IP addresses are personal data, and Dinis has said the vaults are for medical users, where knowing who opened which vault is sensitive in itself. Proposal (a decision for Dinis, via pm.aws.c):

- The raw logs stay where they are; the extract never copies raw IPs out of the page.
- Summaries and anything written by stage two hold only a truncated network (/24 for IPv4, /48 for IPv6) or a keyed hash that cannot be reversed without a key kept by Dinis; counts of distinct clients still work.
- Retention for written summaries to be set by Dinis.

## Where it fits

- **S3-2** (aws.c, in progress) makes the files readable; this builds on the same gzip and JSON Lines reading and should share it, not copy it.
- **P1** (viz.aws.c, follow the packet) needs the request id join (finding 2).
- **P4** (billing.aws.c) needs bytes out and cache results per edge.
- **P5** (time lapse): the per-hour summaries are its first data; client-side database and WASM come after this works on plain arrays.
- **P2** (ontology.aws.c): vault, path, edge and client are the first nodes the extract can give the graph.

## Next steps

1. aws.c: my paths in site/policy/abp.json (`docs/data/**`), and a code path for the module (proposed `site/data/extract.js`), with tests under test/ only at Dinis's yes.
2. aws.c: the three twin findings above (latency generator first: it blocks exact tests).
3. Me, next wake: the module's Discover, Read and Normalise steps with tests against the twin, as a patch to aws.c until the code path is granted.
4. pm.aws.c: the privacy decision for Dinis's decisions page.
