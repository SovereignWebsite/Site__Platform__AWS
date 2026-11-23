# data.aws.a: status

Kept by data.aws.a@SovereignWebsite.dinis (account A), who took over from data.aws.c on 23 Nov 2026. Newest first.

- 2026-11-23 11:55 UTC: ux.aws.a found that with the network-only rule the twin's attack pack loses its story in anything written out: every visitor and the scanner share 203.0.113.0/24. Agreed with its suggestion for aws.c (normal visitors across 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24, the scanner on a network of its own). In-page drill-down keeps full addresses, so the investigation view is unaffected. My test no longer assumes one /24 (any RFC 5737 range passes; the attacker's pivot is its own network), so it holds before and after aws.c changes the twin.

- 2026-11-23 11:20 UTC: security.aws.a checked 518b114, no new risks. Standing rule for the first export (download, saved summary, or anything written to a bucket or vault): it holds only `net`, plus city and country, never `client`, with a test that asserts no raw address appears in it. Today the view keeps full addresses only in page memory for drill-down and writes nothing out.

## 2026-11-23 ~11:20 UTC: landed on dev at Dinis's word; privacy decided

- Dinis Cruz, 23 Nov 2026 ~11:15 UTC in data.aws.a's session: "Yes push it, ok to trust your key and test keep only the network (and if available the city and country)".
- Landed on dev in one signed commit: site/data/ (extract, links, view), test/data/, docs/data/, my key files and notes, and data.aws.a in site/policy/abp.json (`docs/data/**`, as data.aws.c). My key is not yet in the Factory's team/keys.json, so the commit carries an Owner override line quoting Dinis; factory.c lands the key itself (sha 8a7e8ee, prepared) now that Dinis has said to trust it.
- Privacy, decided: anything kept or written out holds only the network (/24, /48), plus city and country when available; recorded in design 01's Privacy section. "City" from the logs is the edge's city, not the visitor's; the visitor's country is the enricher's claim. For vaults.aws.a's lanes: `net`, `edge_city`, `country`; never `client`.
- Nothing loads site/data/*.js yet, so the live site looks the same; the S3 browser hook (s3.aws.c) and security.aws.a's wiring review (R-010) come next.

## 2026-11-23 ~11:10 UTC: P5 time lapse, first design

- docs/data/2026-11-23__02-time-lapse-first-design.md: a window (brush), play forwards and backwards, every click also a filter chip, the state in the page address; measured how far plain arrays go (2,250 to 900,000 records: interactive to tens of thousands, a full summary takes 0.7 s at 225,000); so step 1 is hour cubes (window = sums over hours), step 2 typed-array columns, and WebAssembly (DuckDB-WASM or SQLite WASM) only for ad-hoc queries later, since it needs `'wasm-unsafe-eval'` in the CSP (security.aws.a to review, Dinis to decide). Proposes a shared `{ from, to, filters }` state to architect.aws.a for all consoles.
- Board: P5 can move from "waiting for the agent" to "design written; build next" (pm.aws.a's call).

## 2026-11-23 ~09:05 UTC: vault cards split served from refused

- Each vault in the summary now carries `ok` (served: status below 400), `refused` (400 and up) and `ok_clients`; `ok + refused = requests`. The card reads "N served to M clients", and, when there are any, "K refused: probes or errors, not access" in the error colour.
- On the attack pack, vault-demo-001's traversal and `?key=` probes now show as refused instead of swelling its use; baseline and surge show no refused lines. Tests in both test files; all pass. The per-vault client table is prototype-free like the others (R-014).
- Matches what I proposed to vaults.aws.a for its `vault-usage/1` lane (served apart from refused).

- 2026-11-23 08:35 UTC: security.aws.a rechecked f28ef80, clean. On its note, the country pivot is labelled "country (the enricher's claim)": country comes from upstream, not from CloudFront itself.

## 2026-11-23 ~07:55 UTC: the enricher's fields; reply to vaults.aws.a's lane schema

- The twin now adds the enricher's `country` and `vault_id` to each line (88148db): my finding closed. The extract reads `country` (also a pivot). `vault` stays derived from the path by the extract's rule (no `.`, `..` or slash, after decoding); the enricher's `vault_id` is an upstream claim, kept as `vault_claim` only when it differs. On the attack pack it differs: the enricher gives `..` for `/vault/../../etc/passwd`. Tests: country on every twin line, the traversal's vault empty with the claim kept, `%2e%2e` and `%2F` not vaults, baseline agrees.
- Finding for aws.c (twin): `enrich()` in site/twin.js counts `..` as a vault id. If the real enricher does the same, vault usage counted from `vault_id` includes attacks.
- vaults.aws.a's lane record `cloudfront-extract/1` (docs/vaults/2026-11-23__03-lane-records.md section 3.1 on work/vaults.aws.a): agreed with four changes, sent to vaults.aws.a: (1) `vault` from the extract, not from `vault_id`; (2) call the address field `net` (the /24 or /48), never `client`; (3) add `request_id`, `result` (hit or miss), `host` and `hour` when present (P1 and P4 need them); (4) leave out `query` and the raw user agent (queries carry probe strings and can carry tokens). I will name the module's schema `cloudfront-extract/1` when the lane exists.

## 2026-11-23 ~07:45 UTC: R-014 and R-015 fixed (security.aws.a's review)

- R-014 (Medium): every table keyed by a log value is now prototype-free (`Object.create(null)`): extract.js (discover's hours and days, the TSV record, summarise's tables, clients, vault days and edges), links.js (pivots), view.js (busiest clients, gaps). Tests: `__proto__`, `constructor`, `toString`, `hasOwnProperty` as path, vault, client, edge, user agent, a TSV header field and a key; Object.prototype untouched; counts right; in the page too.
- R-015 (Low): gunzip stops at a ceiling (64 MB unzipped by default, `maxUnzipped`), fetched files over 32 MB are not read (`maxFileBytes`), a run stops at 500,000 records (`maxRecords`) and says so. Each file is read inside its own catch, so one failing or hostile file is recorded in the note and the run goes on. Tests: a 3 MB bomb in a few KB stopped at 1 MB in Node and in the page; a refused file and a bomb among good files.

## 2026-11-23 ~07:20 UTC: investigation mode (memo part 4, sections 22 and 23), on branch work/data.aws.a

- `site/data/links.js`: `resolve(field, value, context)` says what a value refers to, only from what the caller already holds (the site bucket's keys, the vaults list, the logs bucket): a path is its S3 object (`/` is `index.html`; found or not found), a vault path also its vault and `data/vaults.json`, a vault its entry, a line's provenance its log file and line, an address its /24. Traversal (`/vault/../../etc/passwd`) resolves to nothing, by design. `pivots(records, field, value)`: for those lines, every other field's values, most frequent first.
- The view now shows, for any value clicked: a trail of the steps (each step clickable back), "Refers to" (an S3 object is a button that calls the caller's `open({ bucket, key, line })`, for the S3 browser to go there), and "These lines also share" (pivots, every value clickable). Clients, paths and each line's file:line in the table are links too.
- Example on the attack pack: click 203.0.113.66: 90 lines on 22 Nov 09:07 to 11:56, 9 paths (/backup.zip, /wp-admin/, /.env ...), 404/400/403 only, Nuclei, curl and sqlmap, all through AMS1-C1, louder each hour (15, 30, 45).
- Tests: links unit tests in `test/data/extract.test.mjs`; `test/data/view.e2e.cjs` now checks refs, pivots, the trail, open on an object and on a line's provenance, `/` as index.html, the attacker's pivots and that traversal does not resolve. All pass, and the existing tests still pass. No HTML sinks in site/data/.
- Finding for the vault work (vaults.aws.a, security): the attacker's `?key=../../secrets` probes count as 9 requests of vault-demo-001, all failed. Right as a count of requests, but "vault usage" should split used (2xx) from probed (4xx and 5xx). Next step for the vault cards.
- Finding for aws.c and lambda.aws.a (twin): the twin's Firehose stream names a processor, demo-log-enricher, "Adds the country and the vault id to each CloudFront log line", but the seeded lines carry neither field. Either the seed adds them (the extract maps `country` and `vault_id` as soon as they appear) or the description drops it.
- Key: Factory commit 8a7e8ee on 885f150 prepared as factory.c's README asks (all five checks pass); docs/team/keys/data.aws.a.iac-commit.txt and .iac-entry.json. docs/team/keys/data.aws.a.factory-entry.json is superseded by them.

### For s3.aws.c: the hook, now with investigation

`LogView.run($("s3-file"), objects, fetchBytes, { context: { siteBucket, siteKeys, logsBucket, vaults }, open: function (ref) { /* go to ref.bucket, ref.key */ } })`. The context is optional: without it, links show lines and pivots only.

## 2026-11-23 ~05:05 UTC: the view, "Summarise these logs", on branch work/data.aws.a

- `site/data/view.js`: `LogView.run(box, objects, fetchBytes)` lists by hour, reads each file (progress per file, at most 200 hourly files per run, else it asks for a smaller folder), and draws: the headline in words, the hour strip with gaps shown as labelled gaps, vault cards (requests, clients, by day, last seen, edges), top paths, failed paths, status, who asked, busiest clients, edges, and a note of what was read and skipped ("Nothing was written anywhere"). Link mode: every value and every hour bar is a button that shows the lines behind it, each with its file and line number.
- Every value is set with textContent; styles through the CSSOM with the page's own colour variables, so it follows the dark theme and needs no CSS change. No HTML sinks in site/data/ (checked by grep).
- `test/data/view.e2e.cjs` (with `view.fixture.html` and `view.fixture.js`): Chromium on the twin's three packs; headline, two gaps, two vault cards, vault lines equal to the summary's count, provenance on every line, hour link, bots and the traversal line in the attack pack shown as text; a crafted `<img onerror>` in every field stays text and runs nothing; fails if any request leaves the page. Passes.

### For s3.aws.c (site/s3.js): the one hook the view needs

When the listed folder holds `.gz` files under the hourly layout, offer a button "Summarise these logs" that calls `LogView.run($("s3-file"), objects, fetchBytes)`, where `objects` is a listing of the prefix without a delimiter (all pages, `{ Key, Size }`) and `fetchBytes(key)` is the same signed GET openFile already makes, resolving to a Uint8Array (still gzip: the view unzips). index.html loads `data/extract.js` and `data/view.js` after s3.js. I can send this as a patch once s3.aws.c says how it wants it.

## 2026-11-23 ~04:40 UTC: EX-1 steps 1 to 4 built, on branch work/data.aws.a

- `site/data/extract.js`: Discover (group a listing by hour, gaps, keys outside the layout), Read (JSON Lines, concatenated `}{` JSON, tab-separated standard logs under `#Fields`, several gzip members; every record keeps key and line), Normalise (schema v0 from the design, both the twin's and CloudFront's field names; query split from the path; `net` = /24 or /48), Summarise (per hour, path, status class, edge, agent kind, kind, vault, network; p50 and p95 time), and a one-line headline. Pure functions: no DOM, no network, no storage. Not yet loaded by any page, so the CSP and the live site are unchanged.
- `test/data/extract.test.mjs`: the twin's three packs (baseline, attack, surge), every total checked against a plain count of the raw lines, plus four formats the twin does not produce. Passes on Node 22; the existing tests still pass.
- On the twin, baseline: "225 requests over 9 hours, 20 Nov to 22 Nov; 35 failed (all /favicon.ico); 2 vaults used; 2 gaps in the hours." The same as data.aws.c's replay. Finding 1 of the design (call order) is fixed in the twin (`lag()` has its own seed).
- Attack pack: path traversal on the vault API (`/vault/../../etc/passwd`) is not counted as a vault; sqlmap and Nuclei show as bots; the `?key=` probe is split into its query.

### Two-way doors taken on my own recommendation (Dinis, 03:00 UTC)

- Code at the design's proposed paths, `site/data/extract.js` and `test/data/`, on my branch only. Neither is my path: `site/**` is the keeper's (aws.c) and `test/**` needs Dinis's yes. They land on dev only through aws.c, or once granted.
- The headline says "20 Nov to 22 Nov" rather than "20 to 22 Nov": simpler, and it works across months.

### Notes for security.aws.c

- Log values are attacker-controlled (the attack pack has SQL injection and traversal strings in paths, queries and user agents). The module only parses; any page that shows its output must set text, never HTML. To check when the view is built.
- The raw client IP stays in the in-page record (`client`) for drill-down; summaries also carry `net`. Whether anything written out keeps more than `net` is the privacy decision in the design, for Dinis.

### Next

1. The view: "Summarise these logs" on a folder of `.gz` in the S3 browser, headline, hour strip, vault cards, top paths and errors, link mode. Needs a hook in site/s3.js (s3.aws.c) and site/app.js (aws.c); I will send a small patch.
2. Step 5 (move) stays a design until Dinis wants it: a write to S3 is a plan for aws.c.
