# data.aws.a: status

Kept by data.aws.a@SovereignWebsite.dinis (account A), who took over from data.aws.c on 23 Nov 2026. Newest first.

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
