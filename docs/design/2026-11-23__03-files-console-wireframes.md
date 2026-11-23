# Design 03: the Files console, wireframes on the twin

ux.aws.a@SovereignWebsite.dinis, 23 Nov 2026, second wake. Design 01 section 2 named five consoles; Files is the first because the S3 browser already does part of its job and grows into it (design 01 section 3). This note gives the screens, the moves and the addresses, with real names from the twin (site/twin.js, account 111122223333, region eu-west-2), so s3.aws.c, architect.aws.c and dev.1 can build against it. Addresses follow design 02.

## 1. The question and the promise

**What is in it?** Open any bucket, folder or file and see its content in the form it really has (a table for logs, a tree for JSON, the listing of a zip) without downloading it. The first-time visitor, on the twin, should reach the newest CloudFront log as a table in **two clicks** from arrival (today it takes eight, design 01 finding 1).

## 2. Screens

### 2.1 Desktop, 1280 px: arrival (`?twin#/files`)

```
+----------------------------------------------------------------------------------+
| Twin · synthetic AWS · [Normal day v] · Copy link · Leave            [Ctrl+K]    |
+----------------------------------------------------------------------------------+
| Files   Map  Timeline  Desk  Command                    account 111122223333 v   |
+----------------------------+-----------------------------------------------------+
| Filter buckets  [/]        |  5 buckets                                          |
|                            |                                                     |
| > demo-site                |  Bucket                Region     Objects  Size     |
| > demo-cloudfront-logs     |  demo-site             eu-west-2        n  n KB     |
| > demo-lambda-deps         |  demo-cloudfront-logs  eu-west-2        n  n KB     |
| > aws-cloudtrail-logs-..   |  demo-lambda-deps      eu-west-2        n  n KB     |
| > demo.static.example      |  aws-cloudtrail-logs-  ...              n  n KB     |
|                            |  demo.static.example   ...              n  n KB     |
|                            |  Start here: [Newest log as a table]                |
+----------------------------+-----------------------------------------------------+
```

- Left: the tree. Bucket names are shown short (`demo-site`); the full name (`111122223333--demo-site--eu-west-2`) is in the hover title, in the right pane's header and in Copy (design 01 finding 6).
- Right: what is selected. With nothing selected, the bucket table and one "Start here" action, built from the twin's own data (the newest key under the logs bucket), never a hard-coded path.
- `n` and `...` are filled from the listing. The twin's five buckets are named in twin.js:68-74. A "Connected to" column ("written by Firehose", "made by stack") reads relations from the ontology (ontology.aws.c) when they exist; until then it is not shown, never filled with guesses.

### 2.2 Desktop: a date-partitioned prefix (`#/files/<logs>/cloudfront/`)

```
+----------------------------+-----------------------------------------------------+
| v demo-cloudfront-logs     |  demo-cloudfront-logs / cloudfront /    [edit path] |
|   v cloudfront             |                                                     |
|     > 2026                 |  Dated folders (yyyy/mm/dd/hh).  [Latest]           |
|                            |  Nov 2026   20  21  [22]                            |
|                            |  22 Nov     09  10  [11]                            |
|                            |                                                     |
|                            |  demo-distribution-1-2026-11-22-11-00-00.gz         |
|                            |  n KB · 22 Nov 2026 11:00 UTC · gzip, JSON Lines    |
+----------------------------+-----------------------------------------------------+
```

- When every child of a prefix is a 4-digit year, then 2-digit months, days, hours, the pane shows a date strip instead of four folder levels (design 01 finding 1, S3 step 4). "Latest" jumps to the newest hour. The tree still shows the real folders, so nothing is hidden.
- The breadcrumb is an editable path: click "edit path", type or paste a prefix, Enter.

### 2.3 Desktop: a log file as a table (`#/files/<logs>/cloudfront/2026/11/22/11/<file>`)

```
+----------------------------+-----------------------------------------------------+
| (tree, scrolled to file)   |  demo-distribution-1-2026-11-22-11-00-00.gz  [Down] |
|                            |  n KB gzip -> n KB · JSON Lines · n rows            |
|                            |  [Table] [JSON] [Raw]                               |
|                            |                                                     |
|                            |  sc_status  200: 25  404: 31  403: 9  400: 5        |
|                            |  network    198.51.100.0/24: n  (n others)          |
|                            |                                                     |
|                            |  timestamp  network          country path  status  |
|                            |  11:00:41   198.51.100.0/24  NL   /.env       404  |
|                            |  11:01:07   203.0.113.0/24   GB   /index.html 200  |
|                            |  ...                                                |
+----------------------------+-----------------------------------------------------+
```

- Counts per column above the table (top values); clicking a count filters the table. With the attack pack this is how a first-time user sees the scanner in one look, which is the demo.
- The counts in this sketch are illustrative of the attack pack's shape (one scanner, mostly 403 and 404); the real numbers come from the file.
- Every cell is set as text. Link mode (memo 22) later turns known types (IP, bucket, key, vault id) into links by a fixed pattern only (design 01 S3 step 3; R-002).

### 2.3a What the file's header line says (Decode on dev, site/api/decode.js, 461d422)

The header line under the file name is built from what Decode returns, field by field, so it never claims more than the decoder saw:

| Part of the line | From | Example |
|---|---|---|
| `n KB gzip -> n KB` | `Decode.gunzip`: `packed`, `unpacked` | `n KB gzip -> n KB` (from the file) |
| format | `Decode.sniff` | `JSON Lines` (CSV, JSON, text and zip likewise) |
| `n rows` | the table's `rows.length` | `n rows` |
| `n lines could not be read` | `errors.length`, with a [Show] that lists `line` and `message` as text | shown only when n > 0 |

When Decode stops at a limit it says so, and the console says it in the same place, plainly:

- `truncated.bytes` (from gunzip or the text cap, default 50 MB unpacked): "Showing the first 50 MB. The file is larger." When the cut came from gunzip, the last, cut-off line is dropped by Decode (`partial`), not shown as an error.
- `truncated.rows` (default 50 000 rows): "Showing the first 50,000 of at least `rowsRead` rows."
- `truncated.columns` (over 500 columns): "Showing the first 500 columns."
- `json()` over the cap throws `TooLarge`: "Too large to show as JSON here (over 50 MB). [Raw] shows the start." The Table and JSON buttons are disabled with that sentence as their description.

The top-values counts above the table use the same rows, so they carry the same note ("counts from the first 50,000 rows"). This meets the cap that section 6 asks of security.

**Column hints** (`columns[].hint`, from the first 200 rows):

- `number`: right-aligned, tabular figures, sorted as numbers;
- `time`: shown in UTC with the zone written ("11:00:41 UTC" in the header cell, times in the rows), sorted as time;
- `text`: left-aligned, sorted as text.

A hint is a guess from a sample, so a value that does not fit its column's hint is shown as text, as it is, and never coerced. Sorting puts values that do not fit last.

### Privacy (Dinis Cruz, 23 Nov 2026 ~11:15 UTC, in data.aws.a's session: keep only the network, and city and country where available)

The table, the top-values counts and anything kept or written out show the network (/24 for IPv4, /48 for IPv6) and the country. Opening one row in the page shows the line as the log holds it, full address included (as data.aws.a's investigation view does), but the console never copies a raw address out of the file: not into a link, Copy, an export or a screenshot. The addresses and networks in these sketches are from the documentation ranges and illustrative.

### 2.4 Phone, 390 px

```
+------------------------------+     +------------------------------+
| Twin · Normal day v · Leave  |     | < cloudfront / 2026/11/22/11 |
+------------------------------+     +------------------------------+
| Files v              [/]     |     | ...-11-00-00.gz              |
+------------------------------+     | n KB · JSON Lines · n rows   |
| [Newest log as a table]      |     | [Table] [JSON] [Raw]  [Down] |
|                              |     |                              |
| demo-site                    |     | status 200:25 404:31 403:9   |
| n objects · n KB             |     |                              |
| demo-cloudfront-logs         |     | 11:00:41 198.51.100.0/24 NL  |
| n objects · n KB             |     |   /.env               404    |
| demo-lambda-deps             |     | 11:01:07 203.0.113.0/24  GB  |
| n objects · n KB             |     |   /index.html         200    |
+------------------------------+     +------------------------------+
        arrival                              a log file
```

- One column. Opening anything pushes a screen with its own address; Back returns to the same scroll place (design 01 S3 step 2).
- Rows are two-line list items; the table becomes stacked cards with the two most telling columns on the first line (time, IP) and path and status on the second.
- The console switcher is a menu ("Files v"), not five tabs.

## 3. Moves

| Move | Desktop | Phone |
|------|---------|-------|
| Open | click, or arrows / j k then Enter | tap |
| Up one level | Backspace, or the breadcrumb | Back |
| Filter this list | `/` then type | the search icon |
| Edit the path | "edit path", or `g` | tap the path |
| Switch console | Ctrl+K, or the console row | the console menu |
| Copy link to this place (twin only, design 02 rule 5) | the twin bar | the twin bar |

Focus is always visible, the tree is an ARIA tree, the right pane is a region labelled by the selected key, and nothing needs a mouse.

## 4. Addresses

`#/files` (arrival), `#/files/<bucket>`, `#/files/<bucket>/<prefix>/`, `#/files/<bucket>/<key>` (a trailing slash means a prefix), with `?view=table|json|raw` after the key only when it is not the default. Bucket and key are percent-encoded in the hash and matched against the listing before use; an address to a key that does not exist shows "Not in this bucket" and the nearest existing prefix. In the twin these are shareable with `?twin&pack=`; in real mode they stay in the browser (design 02 section 6).

## 5. What it needs (requests, not edits)

| Need | From | Exists today |
|------|------|--------------|
| ListObjectsV2 with prefix and delimiter; GetObject with a range | S3Api (site/api/s3-api.js) | Yes, not yet loaded by a page |
| Bucket list with region, object count, size | S3Api plus the twin | List yes; count and size need a ListObjectsV2 walk or S3 Storage Lens later, shown as "about" until known |
| gzip, JSON Lines, CSV, zip decoders as a library | site/api/decode.js (zip.js for zips) | Yes, on dev since 461d422: sniff, gunzip with sizes, JSON, JSON Lines, CSV, tables with hints, limits and `truncated` (section 2.3a) |
| Relations ("written by Firehose") | ontology.aws.c's twin graph | In docs/ontology/; not in the page yet |
| Hash routes | s3.aws.c (S3 step 1) | No |

## 6. Prototype

A clickable prototype on the twin only, built from S3Api, at a path aws.c and architect.aws.c agree (proposed: site/consoles/files/). Before any HTML lands under site/, R-010 (same-origin pages share the sealed store) needs an answer from aws.c and security.aws.c: either the prototype is a view inside index.html loaded as a script the keeper reviews, or it lives on its own origin. My recommendation: a view inside index.html (no new page, no new origin, the CSP unchanged).

## 7. Security check of this note

Design only; no code changed. Data from buckets is untrusted and is only ever set as text; addresses are matched against listings, never fetched as typed; Copy link exists only in the twin; no new origin, storage or cookie. For security.aws.c: the date-strip detection and the top-values counts run in the page over file content, so they must cap work on very large files (for example, the first 5 MB or 50,000 rows, with "showing the first N rows" said plainly).

## 8. Next wake

Wireframes for Timeline (the second console), from the twin's CloudTrail records and the log hours; then Map once ontology.aws.c's graph is in the page.
