# P1 storyboard: follow one page view on the twin

viz.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Redrafted on account A: the account C draft (viz.aws.c) did not reach dev.

## The packet

Confirmed by Dinis (~03:35 UTC, via pm.aws.c's board): one visitor loads a page on a Sovereign Website, and we follow that one request through CloudFront, S3, the log through Firehose, the vault it touches, and the cost of that one request. "to have different data, and to visualize, again, step by step, color-coded, really nicely, zoomed in, zoomed out".

On the twin (site/twin.js, synthetic account 111122223333, eu-west-2, pack "Normal day") the request is:

`GET /vault/vault-demo-001/files` from 203.0.113.x (documentation range), edge LHR50-C1, answered 200.

Every value on screen comes from the twin, or is marked "not in the twin yet". Nothing is made up in the view itself.

## What the user sees first

One sentence at the top: "Follow one visit to a page, from the browser to the logs and the bill." A Play button, a speed control, and seven stations laid out left to right. A first-time user presses Play and understands it without reading anything else.

## Seven frames

| # | Station (colour) | What moves | What the user can open | Twin source |
|---|---|---|---|---|
| 1 | Visitor (grey) | The packet appears at the browser: method, path, address | The request as a card | log line fields: cs_method, cs_uri_stem, c_ip, cs_user_agent |
| 2 | CloudFront edge (orange) | The packet jumps to the edge location on a small map | Edge location, time taken | x_edge_location, time_taken |
| 3 | S3 origin (green) | The packet walks into bucket 111122223333--demo-site--eu-west-2 | The object, its size and type, read through the twin | twin objects; CloudTrail GetObject example |
| 4 | Back to the visitor (grey) | The response returns, sized by bytes, coloured by status | Status and bytes | sc_status, sc_bytes |
| 5 | Log line (blue) | A copy of the request drops out as one JSON line | The exact line, formatted | the hour's .gz in 111122223333--demo-cloudfront-logs--eu-west-2 |
| 6 | Firehose batch (blue) | The line joins the hour's batch and lands as cloudfront/2026/11/DD/HH/demo-distribution-1-....gz | The batch, opened in place (byte-range, no download) | log key pattern in the twin |
| 7 | Vault and cost (purple, gold) | The packet lights vault-demo-001 (42 files, eu-west-2), then a coin counter adds this one request's cost | Vault card; cost line with the cited price | data/vaults.json; price from billing.aws.a's price book, cited, or "price not yet cited" |

## Controls

- Play, pause, step one frame, step back.
- Speed: 0.25x, 1x, 4x, 16x. Replay from any frame by clicking it.
- Zoom: three altitudes. Services (seven stations); resources (bucket, distribution, stream, vault); fields (the request and log line, field by field).
- Same request in the log: click any line in the S3 browser's log view and "Follow this request" opens here on that line.

## Engine (pragmatic, built here)

Dinis asked for "something a bit more pragmatic" for moving and jumping; the characters come from PrompTugal__News__Bulletins later.

- One SVG, stations on a fixed grid, no physics. A packet is a small sprite tweened along a path; a "jump" is an arc between two stations.
- A run is a list of steps `{t, from, to, kind, ref}` built from one twin log line; the engine only plays steps, so live data later is the same list from real logs.
- requestAnimationFrame clock with a speed multiplier; scrubbing sets the clock.
- No libraries, no network beyond the twin, works under the site's CSP; keyboard and screen reader: each step is also a line of text.
- Split agreed with swarm.aws.c: swarm keeps the 3D universe; this is the flat engine. Both read steps in the wire's schema (docs/team/events.jsonl).

## Gaps in the twin (asks, not inventions)

- No CloudFront cache hit or miss field: frame 2 shows "not in the twin yet". Ask: architect.aws.c, dev.2.aws.a (twin).
- No Firehose stream as a resource, only its output: frame 6 shows the output. Same ask.
- What serves /vault/* behind CloudFront is not modelled; frame 3 shows the S3 origin for site files and marks vault paths. Same ask.
- No price yet: frame 7 waits on billing.aws.a's cited price book.

## Next

1. A prototype page on the twin with architect.aws.c, frames 1 to 6, once code paths are agreed.
2. Attack pack: the same view for 203.0.113.66's probes (security.aws.c writes the scenario, this shows it).
3. Sherpa walk of the prototype at desktop and phone width.
