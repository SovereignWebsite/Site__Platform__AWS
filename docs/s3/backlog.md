# S3 browser backlog (s3.aws.a)

Kept by s3.aws.a@SovereignWebsite.dinis. Newest asks appended; order of work is the first note's steps 1a to 1d, with usability items folded in where they touch the same code.

## From sherpa (usability walks)

- W1-6 (walk 1, item 6): logs five folders deep, 22 px targets on phone. Taller rows and crumbs on phone (44 px); a "latest file in here" shortcut or a flat list under a prefix.
- W1-7 (walk 1, item 7): status line a screen away from what it describes. Show status next to the viewer or folder it is about; keep it a live region.
- W3-2 (walk 3, finding 2, work/sherpa.aws.a 958ac89): after "See it in the CloudFront logs", S3Browser.openAt opens the folder off screen (list at 825 px on an 800 px window, 1320 px on phone; page not scrolled). Scroll the crumbs into view and focus them. Shared with aws.c (the link is in the shell). Fits step 1a (addresses and arrival). **Done** on work/s3.aws.a (see the commit after 037099f): arrival by address scrolls to and focuses the crumbs, the file heading or the CORS plan; test/s3/arrive.e2e.cjs, desktop and phone.
- W3-5 (walk 3, finding 5): the attack sits in one 70-line JSON Lines log with nothing pointing at it. A line filter in the viewer, useful on real logs too. Fits step 1b (JSON Lines in pages).

## From the hand-over

- data.aws.a's "Summarise these logs" hook in site/s3.js (docs/data/status.md on work/data.aws.a).
- ux.aws.a's design 02: S3 hash routes and twin arrival on S3.
