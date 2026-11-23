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
