# S3 browser: where it stands, and the next three steps

Written by s3.aws.c@SovereignWebsite.dinis, 23 Nov 2026, first wake. Read from site/s3.js, site/zip.js, site/app.js (assume) and test/ at dev e5f90f5. No live AWS: everything here is from the code and the tests.

## What already makes it good

- **Inside a zip by byte ranges** (zip.js): the index is read in 2 requests (test: 65,923 of 252,963 bytes), one file in 2 more; zip64, stored and deflate, UTF-8 names. Better than the AWS console, which has nothing like it.
- **.gz unzipped in the page** and shown as formatted JSON, JSON Lines or highlighted text. Content-Encoding gzip is handled (the bytes are simply not gzip by then).
- **Credentials cached** per account and role, renewed 5 minutes before expiry, one STS call for callers asking together (app.js `assume`). No extra round trip per click.
- **Safe display**: everything goes through textContent and blobs; JSON is built from DOM nodes, never HTML strings.
- **Region right for each bucket** (from RegionalDomainName), path-style URLs for dotted bucket names.
- Tests pass today: plan, sigv4, zip, highlight, mask; the end-to-end page test covers list, CORS plan, JSON, YAML, .json.gz and a zip.

## What makes it not smooth today

### Speed and size
1. **Every file is downloaded whole, then judged.** `openFile` GETs the full object and only then checks `MAX_SHOW` (5 MB). A 2 GB log is downloaded to say "too large". A HEAD (or the size already in the listing) and a `Range: bytes=0-N` preview would show the first part at once.
2. **gzip is unzipped whole into memory.** No streaming preview of the first N lines of a large .gz. DecompressionStream can be read chunk by chunk and stopped early.
3. **Large JSON renders as one `<pre>` with a span per token**: a 5 MB file is hundreds of thousands of nodes, built in one go. No folding, no "first N items".
4. **JSON Lines parses and renders every row**: no paging, no count first.

### Formats
5. **CSV and TSV show as plain text**, not a table. CloudFront logs are tab-separated (standard logs with `#Version` / `#Fields` headers; real-time logs without), so this is the first gap for the CloudFront-logs bucket.
6. **Firehose output is often not JSON Lines**: unless a delimiter is added, Firehose writes records back to back (`}{`), which both the JSON and JSON Lines readers reject, so the file falls through to plain text. A reader that splits concatenated JSON values is needed.
7. **Files that are several gzip members** (common when data is appended): whether DecompressionStream reads past the first member in every browser is to be tested, not assumed. Fixture and test needed.
8. Parquet and Avro: not read (only if Dinis uses them).

### Large listings
9. **Load more is manual**, 500 keys a time, and the filter only searches what is loaded. Folders of thousands (log prefixes by date and hour) need: filter as a server prefix when it is a prefix, an automatic next page while scrolling, and a count.
10. **No sort** (name, size, date) and no "newest first", which is what one wants in a log folder.
11. **No cache**: going back up a folder lists it again from S3.

### Navigation and keyboard
12. **No address for where you are**: refresh, back and a shared link all lose the bucket, folder and file. A `#bucket/prefix/key` hash would fix all three (no server, no cookie).
13. **No keyboard**: arrows to move, Enter to open, Backspace to go up, `/` to filter. Today it is mouse only.

### Correctness under quick clicks
14. **Late answers land in the wrong place.** `listObjects` and `openFile` clear the box, then append when the answer comes; click two folders or two files quickly and the slower, older answer is appended under the newer one. Each request needs a generation number (or an AbortController) so stale answers are dropped.

### Errors
15. Errors are one status line. "Failed to fetch" gets a CORS hint, but a missing key, AccessDenied on one prefix, an expired session, or a bucket in an opt-in region are not told apart, and there is no retry button.

## The next three steps, in Dinis's order

1. **The smooth browser** (site/s3*.js and test/s3/**, once aws.c agrees the paths), in small commits with tests:
   a. stale-answer guard (14) and a `#bucket/prefix/key` address (12);
   b. preview by Range and streamed gunzip, a size gate before any download (1, 2), JSON shown in pages with folding (3, 4);
   c. CSV/TSV as a table, CloudFront headers understood, concatenated JSON read (5, 6), multi-member gzip fixture (7);
   d. sort, automatic paging, prefix filter, listing cache (9 to 11); keyboard (13); clearer errors (15).
2. **The bucket graph** (memo section 9): for a bucket, the Firehose streams writing to it, Lambda functions, the CloudFormation stack that made it, Route 53 records, CORS and lifecycle. Read through architect.aws.c's API layer (docs/architecture/, not written yet) and shown against the twin's synthetic data until Dinis signs in. New read permissions are a plan aws.c writes for Dinis's Approve.
3. **The CloudFront-logs bucket written by Firehose**: with 5, 6 and 7 done, its files open as a table; then a fixture of the exact format (standard or real-time logs, delimiter or not) once Dinis signs in and we see one file, and the first extract step for the data scientist.

## Open questions (to pm.aws.c for the board, not blocking tonight)

- Which log format the Firehose stream writes (standard or real-time CloudFront logs; JSON, or tab-separated; delimiter added or not). Until known, the reader handles all of them.
- Whether Parquet or Avro is in Dinis's buckets at all.
