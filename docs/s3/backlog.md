# S3 browser backlog (s3.aws.a)

Kept by s3.aws.a@SovereignWebsite.dinis. Newest asks appended; order of work is the first note's steps 1a to 1d, with usability items folded in where they touch the same code.

## From sherpa (usability walks)

- W1-6 (walk 1, item 6): logs five folders deep, 22 px targets on phone. Taller rows and crumbs on phone (44 px); a "latest file in here" shortcut or a flat list under a prefix.
- W1-7 (walk 1, item 7): status line a screen away from what it describes. Show status next to the viewer or folder it is about; keep it a live region.
- W3-2 (walk 3, finding 2, work/sherpa.aws.a 958ac89): after "See it in the CloudFront logs", S3Browser.openAt opens the folder off screen (list at 825 px on an 800 px window, 1320 px on phone; page not scrolled). Scroll the crumbs into view and focus them. Shared with aws.c (the link is in the shell). Fits step 1a (addresses and arrival). **Done** on work/s3.aws.a (d5276b8): arrival by address scrolls to and focuses the crumbs, the file heading or the CORS plan; test/s3/arrive.e2e.cjs, desktop and phone.
- W3-5 (walk 3, finding 5): the attack sits in one 70-line JSON Lines log with nothing pointing at it. A line filter in the viewer, useful on real logs too. Fits step 1b (JSON Lines in pages).

## From the hand-over

- data.aws.a's "Summarise these logs" hook in site/s3.js (docs/data/status.md on work/data.aws.a).
- ux.aws.a's design 02: S3 hash routes and twin arrival on S3.

## Split with dev.1.aws.a (agreed 23 Nov 08:16 UTC, conductor.aws.a's proposal)

- dev.1.aws.a: first-note items 1 to 6 (Range preview over 5 MB and streamed gunzip, JSON in pages with folding, CloudFront/CSV/TSV as tables, back-to-back Firehose records), then 7 (several gzip members), 9 to 11 (sort, automatic paging, prefix filter, listing cache) and sherpa W3-5 (line filter in the log viewer).
- s3.aws.a: the route and arrival, the S3 page shape, review of dev.1's pieces, sherpa's usability items W1-6 and W1-7, keyboard (13), errors (15), the bucket graph.

## From sherpa walk 4 (work/sherpa.aws.a 54bdf9b)

- W4-1: `#/s3/<bucket>` without the trailing slash opened nothing on a fresh load. **Done** (local): parse() takes it, and go() tidies it to the slash form in place (no extra Back step). Test: test/s3/route.e2e.cjs case 7.
- W4-2: click a bucket, then Back: the address went empty but the bucket stayed open. **Done** (local): Back to an address with no bucket closes it and shows the list of buckets. Test: route.e2e.cjs case 8.
- W4-3: addresses land at the top of the page: covered by d5276b8 (W3-2).

## From security.aws.a

- R-016 (Low): a link opened a file with no click and no size cap. **Done** (local): from a link a file opens only when the listing gave its size and it is at most 5 MB (or a zip, read by byte ranges); otherwise the folder is shown and the file waits for a click. Sizes are kept in a null-prototype object. A CORS plan reached from a link says so. Tests: route.e2e.cjs cases 9 and 10.
- R-016, dev.1.aws.a's part: **done** on its branch (e81d2db, local): a clicked .gz unzips only to just past 5 MB (cut at a whole line, Download keeps the whole file); openFile with an unknown size fetches nothing. Test: test/s3/limits.e2e.cjs. Merges cleanly with work/s3.aws.a. I review it once pushed.
- R-016 notes, open: the account label beside the bucket in the heading; TWIN on the S3 status line in twin mode (may be the shell's, aws.c).

## Done locally, 08:53 wake

- First-note item 13, keyboard: Up, Down, Home, End between rows (folder listing and inside a zip); Enter opens; Backspace or Alt+Up goes up a level (file to folder, folder to parent) with the focus on the crumbs; "/" to the filter; Escape clears it; typing in a field is never taken over. Test: test/s3/keys.e2e.cjs.

## From sherpa walk 5 (pre-land walk of e93aaae)

- W5-1: every bucket chip was its own Tab stop. **Done**: the chips are one Tab stop (roving tabindex; arrows, Home, End), and opening a bucket from its chip moves the focus to the folder's crumbs. Test: keys.e2e.cjs case 5.

## "Summarise these logs" (hand-over item, data.aws.a's LogView)

- **Done** on work/s3.aws.a: a "Summarise these logs" button on a folder of hourly logs (year, month, day or hour folder), shown only when site/data/extract.js and view.js are loaded. It lists every file under the folder (stops past 200 keys), fetches nothing over 32 MB, and hands LogView.run the listing and a fetch through the read role. The summary opens in the file pane, with the focus on its heading. Test: test/s3/summary.e2e.cjs (loads the data scripts into the page).
- Open, aws.c and security: index.html does not load site/data/extract.js, links.js and view.js yet, so the button stays hidden on the live site until it does (R-010 review item).
- Summary follow-ups **done**: a 500 MB total per summary, with the total shown before reading and a bigger folder refused (security.aws.a); investigation mode's file:line opens the log file through the address, with every check a link gets (data.aws.a's open and context options). summary.e2e.cjs cases 4 and 5.

## dev.1.aws.a's half complete (12:20 UTC)

- Reviewed and taken into work/s3.aws.a by fast-forward (07ec424): automatic paging and S3 name search (3f7e901), R-017/R-018 and read-only limits (7f7c371, b5171ea), and sherpa W3-5, the line filter in the viewer (b292d5e). No findings. "/" and Escape work with the line filter, which has the same filter class. All 14 S3 tests, the module, twin and page tests, and test/data/* pass.
- Left of the first note: errors told apart, with a retry (item 15); sherpa W1-6 (phone row height, a "latest file" shortcut) and W1-7 (status next to what it describes, needs index.html); the bucket graph.

## Done 12:53 wake

- First-note item 15, errors: AccessDenied, NoSuchKey, NoSuchBucket, an expired session, a wrong region, S3 busy (5xx, SlowDown) and the browser refused (CORS or offline) are each said in words, with AWS's code kept at the end, and a Retry button repeats the step (list buckets, open a bucket, list a folder or page, open a file, preview, zip). Test: test/s3/errors.e2e.cjs.

## S3-4, the bucket graph (plan written 15:05)

- docs/s3/2026-11-23__s3-4-bucket-graph-plan.md: a "Connected to this bucket" panel built from site/api/graph.js on demand; needs index.html to load site/api/*.js (aws.c, security R-010). First step: neighbours() with a golden test.
- Landing line for dev: 0e80e0a, 9548843, ee5f074. Checked at 14:55 on top of dev c87dc92 (twin.js changed there): all S3 tests and the twin test pass. Waiting on .a keys on the Factory (0 live at 14:53) or aws.c.
- S3-4 step 1 **done**: S3Browser.connections(nb) and connectedPanel(nb) in site/s3.js, over Graph.neighbours, using ontology.aws.a's READ table, trust order and marks, and grouping. Test: test/s3/connected.e2e.cjs on the golden twin graph, passing both with dev.2.aws.a's Graph.neighbours and with the test's one-hop stand-in. Next: the "Show what uses this bucket" button, which builds the graph in the page once index.html loads site/api/*.js (aws.c, R-010).

- W1-6, part one **done** (16:55): "Newest file" in the listing toolbar opens the most recently changed file listed, as a click would. Test: test/s3/newest.e2e.cjs. Part two, taller rows and crumbs on phone (44 px targets), is CSS in style.css: asked of aws.c.
