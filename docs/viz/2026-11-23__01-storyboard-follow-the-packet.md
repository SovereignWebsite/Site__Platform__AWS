# Storyboard 01: follow the packet, one page view, on the twin

Written by viz.aws.c@SovereignWebsite.dinis, 23 November 2026, 03:20 to 03:40 UTC. Status: **draft storyboard**, scope confirmed by Dinis in pm.aws.c's session (~03:35 UTC: CloudFront, S3, Firehose log, vault, cost of the one request), the first step of pipeline P1 (docs/board/pipeline.md). For architect.aws.c (prototype), pm.aws.c (board), security.aws.c (review). Sources: the memo, docs/board/pipeline.md, site/twin.js and site/transport.js as on dev at 4433914. Nothing here touches AWS: every frame is drawn from the twin's synthetic account (111122223333, AWS's own example account).

## The question Dinis asked

"I want to see the exact package. I want to see the exact IAM use. I want to see the exact resources that we use." One request, followed through every component, that can be replayed, sped up, slowed down, with its logs one click away.

## The packet

One visitor opens `/data/vaults.json` on the demo site. It is the best first packet because the twin already holds every trace it leaves:

| Trace | Where the twin keeps it (site/twin.js) |
|---|---|
| The object served | `111122223333--demo-site--eu-west-2` / `data/vaults.json` (lists `vault-demo-001`, `vault-demo-002`) |
| The edge log line | `111122223333--demo-cloudfront-logs--eu-west-2` / `cloudfront/2026/11/<day>/<hour>/demo-distribution-1-...gz`, one JSON line per request: `timestamp`, `c_ip` (203.0.113.x, a documentation range), `cs_uri_stem`, `sc_status`, `sc_bytes`, `time_taken`, `x_edge_location`, `cs_user_agent` |
| A read of the same key by the platform's read role | `aws-cloudtrail-logs-111122223333-demo` / `AWSLogs/.../20261122T1000Z_demo.json.gz`, a `GetObject` on `data/vaults.json` by `sws-aws-platform-read` |

What the twin does **not** have yet: a CloudFront service, a Firehose stream, a distribution config or an origin access setting. Frames 3 and 5 below draw those as labelled boxes marked "not yet in the twin", never as invented data. When those twins land (a request to aws.c and architect.aws.c), the boxes fill in.

## Characters

One character per component, so a non-engineer can follow the story. Names are placeholders until they are matched to characters from the presenters library (labelled synthetic).

- **The Visitor**: the browser that asks.
- **The Edge**: the CloudFront edge location (`LHR50-C1`, `DUB2-C1` or `AMS1-C1` in the twin's logs).
- **The Keeper**: the S3 bucket holding the site.
- **The Scribe**: the log writer (Firehose, in the live stack), carrying the line to the logs bucket.
- **The Archivist**: the logs bucket.
- **The Auditor**: CloudTrail, which sees API calls by roles, not page views.

## Frames

Each frame is one step. The timeline bar at the bottom shows real `time_taken` from the log line, so slowing down and speeding up are true to the data.

1. **Ask.** The Visitor sends `GET /data/vaults.json`. Panel: method, path, user agent, source IP (documentation range).
2. **Edge.** The packet reaches the Edge named in `x_edge_location`. Panel: edge code and what it means (London, Dublin, Amsterdam).
3. **Origin.** The Edge asks the Keeper for `data/vaults.json`. Panel: bucket, key, object size, last modified (all from the twin's S3). Box: "cache hit or miss, origin access identity: not yet in the twin".
4. **Answer.** The Keeper hands back the object; the Edge returns it. Panel: `sc_status` 200, `sc_bytes`, `time_taken`. Click "open" to see the JSON itself in the S3 browser (already built).
5. **Log.** The Scribe writes one JSON line and, within the hour, a gzip lands in the Archivist. Panel: the exact log line, highlighted in the gzip the S3 browser already opens. Box: "Firehose stream: not yet in the twin".
6. **Vault reach.** The answer names two vaults. Panel: `vault-demo-001` (eu-west-2, 42 files), `vault-demo-002` (eu-west-1, 7 files); the line from the memo on why vault usage matters ("critical as vaults are made for medical users").
7. **The other eye.** A separate scene: the Auditor's `GetObject` record for the same key, made by the platform's read role. It shows the difference between a public page view (CloudFront log, no IAM) and a signed role call (CloudTrail, with IAM). This is the "exact IAM use" Dinis asked for. For a public page view the visitor uses no IAM at all; how the Edge itself is allowed to read the Keeper is drawn as "not yet in the twin".
8. **Cost.** What this one request cost: the CloudFront request and bytes out, the S3 GET, the log line through Firehose and its storage. Panel filled by billing.aws.c's price model from AWS's public price lists (pipeline P4); until that lands the panel shows the line items with "price: from billing.aws.c", never a made-up figure.

## Look

Colour-coded by kind: one colour for the visitor's request, one for data served, one for logs, one for IAM, one for cost, checked for contrast in light and dark. Zoom out to the whole path on one screen; zoom in to any frame's panel and its raw record. Engine (Dinis, via pm.aws.c, ~03:35 UTC): rendering, navigation and characters from the PrompTugal__News__Bulletins repository, whose characters already move; moving, jumping and the like built here more pragmatically, with swarm.aws.c. Presenters from that library are always labelled synthetic. Access to the library: to ask maestro.c or bulletins.b/d.

## Controls

Play, pause, step, 0.25x to 8x, and replay. A packet picker: any line in any twin log file becomes a packet (that is the "follow any request" step after this one). Every panel value is a link to the resource it names (the memo's "link mode").

## How it is built (for architect.aws.c, to agree)

- Data only through `AwsTransport.fetch` and the S3 code already on the site, so the same storyboard runs on live data later and checks the twin against it (pipeline P1).
- Static files in site/, no new script origins, no inline script (the CSP), no cookies, no tracking.
- First prototype: an SVG scene with the six characters and the eight frames, driven by one parsed log line; then the Bulletins renderer and characters once access is granted.

## Shared engine (agreed with swarm.aws.c, 23 Nov ~03:31 UTC)

One small engine for moving and jumping, shared by this view and the swarm view. viz.aws.c owns the engine; swarm.aws.c owns the swarm data (docs/swarm/events.jsonl) and its view. API: `engine.mount(el)`, `engine.set({bodies, links})`, `engine.travel(from, to, opts)`, `engine.at(t)`, `engine.speed(x)`, `engine.on("tick")`. Drawing is kept apart from motion, so the Bulletins renderer or Gravity (web-summit.sgit.ai, Apache-2.0, on three.js 0.147.0, MIT) can plug in. Any library is vendored into site/ at a pinned version with its licence notice (the CSP allows scripts from 'self' only).

## Partners

billing.aws.c (frame 8), data.aws.c (the log records, frames 5 and 7), vaults.aws.c (frame 6), security.aws.c (an attack variant later).

## Questions (to pm.aws.c for docs/board/decisions.md)

1. Twins for CloudFront (distribution, origin) and Firehose (stream to bucket)? Blocks: frames 3 and 5 filling in. Recommendation: yes, after S3, as small service twins behind the router (design 01, note 3).

## Revision 2 (viz.aws.a, 23 Nov ~04:30 UTC)

viz.aws.a@SovereignWebsite.dinis took over this role from viz.aws.c on account A. This merges the account A redraft into this storyboard, so there is one. The packet stays `/data/vaults.json`: the twin holds every trace it leaves, which a vault path does not.

**Frame 8, cost, now has its prices.** billing.aws.c's price book landed on dev (docs/billing/prices.json, 86da1ce), each price cited. The cost panel takes its line items from these ids, and shows the figure twin-estimate.mjs works out, never one written by hand:

- `cloudfront.request.https.europe` (one HTTPS request at the edge)
- `cloudfront.transfer_out.europe.first1tb` (the bytes out, `sc_bytes`)
- `s3.request.get` and `s3.transfer.to_cloudfront` (the origin read; only on a cache miss, which the twin cannot tell yet)
- `firehose.ingest.vendedlogs.first500tb` (the log line; Firehose rounds each record up, so the per-request share is shown as a share of the batch, with the rounding rule from the price book)
- `s3.storage.standard.first50tb` (the log's share of storage)
- `cloudfront.free_tier` is shown beside the figure: at the twin's "Normal day" volume (25 requests an hour) the request is inside the CloudFront free tier, and the panel says so in plain words.

**Added from the redraft:**

- **Zoom has three altitudes**: services (the six characters), resources (bucket, distribution, stream, vault), fields (the request and log line, field by field). Altitudes match ontology.aws.c's levels once they are fixed.
- **Speeds**: 0.25x, 1x, 4x, 16x, plus step forward and back.
- **"Follow this request"**: any line opened in the S3 browser's log view opens this view on that line (same as the packet picker, reached from where the user already is).
- **A run is a list of steps** `{t, from, to, kind, ref}` built from one log line; the engine only plays steps (`engine.travel` per step). Live data later is the same list from real logs, and swarm.aws.c's events are the same shape.
- **Accessibility**: each step is also one line of text in a list beside the scene, so a keyboard or screen reader user follows the same story; motion respects `prefers-reduced-motion` (steps without travel).
- **First-time user**: one sentence at the top ("Follow one visit to a page, from the browser to the logs and the bill") and a Play button; nothing else needs reading to start.

**Next, in order:**

1. Prototype with architect.aws.c: frames 1 to 6 as one SVG scene driven by one twin log line, once code paths are agreed.
2. Attack variant: the same view for 203.0.113.66's probes in the twin's "Attack in progress" pack (security.aws.c writes the scenario, this shows it).
3. sherpa.aws.c walks the prototype at desktop and phone width.

**Owners on account A**: billing, data and vaults moved to account A as billing.aws.a, data.aws.a and vaults.aws.a; swarm as swarm.aws.a. The partners above read with that change.
