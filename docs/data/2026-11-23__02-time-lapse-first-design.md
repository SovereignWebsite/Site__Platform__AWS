# The time lapse: first design (P5)

Written by data.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~11:10 UTC. Pipeline P5 in docs/board/pipeline.md: "Go back and forward in time, see traffic, click anything and the whole UI follows. Data loaded and queried in the browser (client-side databases, WebAssembly)." Builds on the extract (EX-1: site/data/extract.js, view.js, links.js on work/data.aws.a), which already gives every record a time, an hour and its source line, and on vaults.aws.a's lanes (docs/vaults/2026-11-23__03-lane-records.md on work/vaults.aws.a). Twin first; nothing here touches AWS.

## What the first-time user sees

The "Summarise these logs" page gains a time bar across the top:

1. **A window.** Drag across the hour strip to choose a range (a brush); the headline, vault cards, tables and pivots all recompute for that window. Click an hour for just that hour. "All" clears it.
2. **A cursor and play.** Press play and the window slides forward an hour at a time at a chosen speed (1, 4 or 24 hours a second), backwards too, with a pause. An attack is seen growing (the attack pack: 15, 30 then 45 probes an hour on 22 Nov), a surge seen arriving.
3. **Everything linked.** A click anywhere (a vault, a path, an address, a country) becomes a filter as well as a drill-down, shown as a chip beside the window ("vault vault-demo-001 x"); the time bar then draws only the matching lines, so "when did this address start, and when did it stop" is one click. Filters and window together are the investigation's state.
4. **A shareable address.** That state lives in the page address, after the S3 browser's own (fe7170c: `#/s3/<bucket>/<folder>`), for example `...?from=2026-11-22T09&to=2026-11-22T11&client=203.0.113.66`. Copy it and the same view opens for anyone with the same access. No storage, no cookies; nothing leaves the page.

## Measured: how far plain arrays go

Node 22 on this container (4 cores), the twin's surge pack (2,250 records) repeated; times are for the module as it is today (bc11688):

| Records | Normalise | Summarise all | Pivot one value | Summarise a 3-hour window | Heap |
|---|---|---|---|---|---|
| 2,250 | 11 ms | 14 ms | 2 ms | 3 ms | 12 MB |
| 22,500 | 84 ms | 60 ms | 15 ms | 18 ms | 21 MB |
| 225,000 | 852 ms | 699 ms | 102 ms | 127 ms | 146 MB |
| 900,000 | 2,672 ms | 2,221 ms | 394 ms | 583 ms | 639 MB |

Reading: up to a few tens of thousands of records, the current code is interactive as it is. At hundreds of thousands, a full summary takes most of a second, far too slow to play at several frames a second, and the heap grows to hundreds of megabytes. These are Node numbers; the browser is to be measured in Chromium with the same data before building step 2. For scale, the twin's baseline is 25 lines an hour; a busy real site can write far more, so the design has to hold at the bottom of this table.

## The data layer, in three steps (WebAssembly last, and only if measured)

1. **Hour cubes (next build).** At read time, besides the records, count once per hour per dimension: requests, bytes, served and refused, and distinct clients per hour (a small set per hour, kept as counts once the hour is done). A window's tables are then sums over its hours: proportional to hours times distinct values, not to records. Playing and brushing read only the cubes; the raw records are touched only to draw the lines behind a click, filtered by an hour index (records sorted by time once; each hour is a slice). Distinct clients across a window cannot be summed from hours exactly; the window shows the exact figure when the window's records are few, else "about N" from a small sketch per hour (HyperLogLog-style), and says which.
2. **Columns (when the browser measurement says so).** Records as columns of typed arrays (time as seconds in a Uint32Array, status in a Uint16Array, bytes in a Float64Array) with strings dictionary-encoded (each distinct path, client, agent, edge stored once; a Uint32Array of ids per record). Filters become integer comparisons, memory falls to a fraction (the 900,000-record heap above is mostly repeated strings and objects). Plain JavaScript, no new dependency, no CSP change.
3. **A client-side database, only for ad-hoc questions.** If the console later needs free-form queries (group by anything, joins with CloudTrail or billing lanes), a WebAssembly engine such as DuckDB-WASM or SQLite's WASM build is the candidate. Costs to weigh then, not now: a download of several megabytes (to measure), files vendored into site/ (the CSP allows scripts only from the site and Google's sign-in), and the CSP itself: compiling WebAssembly needs `'wasm-unsafe-eval'` in `script-src`, a change to the page's security policy that is security.aws.a's to review and Dinis's to decide. Steps 1 and 2 avoid all of that.

## Where the data comes from, as the window widens

- **Hours to a few days:** the raw log files, read in the page, as today (with the R-015 ceilings).
- **Days to months:** vaults.aws.a's lanes, once they exist: `vault-usage/1` (one record per vault per hour) and, if agreed, an hourly per-dimension summary lane, which is exactly the hour cube of step 1 written out. The time bar then reads hourly summaries for the range and fetches raw files only for the hours a click opens. Writing summaries anywhere is stage two of EX-1 (a plan for aws.c and Dinis), not proposed here.
- **Resources at a point in time:** vault 1's history (vaults design 01: a commit only when a resource changed) answers "what did this bucket's policy look like at 10:00 on 22 Nov", so a time-lapse click on a path can open the object as it was, not as it is. That join is with vaults.aws.a, later.

## Shared with the other consoles

The window and the filter chips are one small state object, `{ from, to, filters: [{ field, value }] }`, read from and written to the address. ux.aws.a's Timeline console, viz.aws.a's follow-the-packet replay (P1) and ontology.aws.a's graphs (P2) can share it, so moving time in one moves it in all. Proposed to architect.aws.a as the contract; the field names are the extract's (`path`, `vault`, `client` or `net`, `country`, `status`, `edge`, `hour`).

## Security notes (for security.aws.a)

- Values from the address are attacker-controlled too (a crafted link): parsed with URLSearchParams, matched only against values present in the records, shown as text, never evaluated. A link can choose a view; it cannot add data or reach the network.
- Play uses requestAnimationFrame or a timer; no workers until step 2 needs one, and a worker would be a same-origin file under site/.

## Next steps

1. Me, next: hour cubes and the brush on the existing view, with tests on the three packs (window sums equal a plain count of the window's lines; play over the attack pack shows the 15, 30, 45 rise). On my branch until site/data/** lands.
2. Me: the same benchmark in Chromium, recorded here.
3. architect.aws.a: the shared `{ from, to, filters }` state for the consoles.
4. vaults.aws.a: whether an hourly per-dimension summary lane belongs beside `vault-usage/1`.
