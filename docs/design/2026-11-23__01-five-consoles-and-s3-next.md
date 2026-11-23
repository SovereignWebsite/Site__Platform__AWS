# Design 01: five consoles, and the S3 browser's next level

ux.aws.c@SovereignWebsite.dinis, 23 Nov 2026, first wake. A first sketch for review by Dinis, design.c, architect.aws.c, s3.aws.c and sherpa.aws.c. Everything here runs on the twin first (account 111122223333) and over one API layer (docs/architecture/2026-11-23__01-one-transport-two-back-ends.md).

## 1. What a first-time user sees today (walk-through on the twin, dev 4433914)

Walked at 1280 px and 390 px in Chromium, from the home page through "Try the twin" to a CloudFront log file. These are mine; sherpa.aws.c's walk 1 (451bc42) arrived after and agrees on finding 10 (its item 8: at phone width "Try the twin" is below the fold). Its shell findings (b) to (f) are rows 11 to 15; its S3 findings went to s3.aws.c. From now on sherpa.aws.c and ux.aws.c keep one ranked list. Ranked by how much they hurt a first visit.

| # | Screen | Problem | Fix | Owner |
|---|--------|---------|-----|-------|
| 1 | S3 browser | Reaching one CloudFront log takes 8 clicks: bucket, Approve, cloudfront, 2026, 11, 22, 11, file. Date folders are the normal shape of log buckets. | Detect date-partitioned prefixes (yyyy/mm/dd/hh) and offer "Latest" and a date strip; make the breadcrumb an editable path. | s3.aws.c |
| 2 | S3 browser | No address for where you are: reload, Back and sharing a place all lose it. | Hash routes, for example `#/s3/<bucket>/<prefix>` and `#/s3/<bucket>/<key>`; Back walks up. The hash never leaves the browser. | s3.aws.c, architect.aws.c |
| 3 | S3, file view | A 25-line log is shown as 300 lines of pretty JSON. The data is a table. | JSON Lines and CSV open as a sortable table with per-column filter and counts (status, IP, path); "JSON" stays one click away. This is the start of link mode (memo 22). | s3.aws.c, data.aws.c |
| 4 | S3 tab, twin | After "Try the twin" the S3 tab is empty until you pick the only account and press "List buckets". | In the twin, list buckets on arrival; everywhere, remember the last account and place. | s3.aws.c |
| 5 | S3, status | "JSON Lines (25), formatted." appears above the bucket list, far from the file it describes. | Put status next to the thing that changed; use a quiet loading row in the table while a listing runs. | s3.aws.c |
| 6 | S3, buckets | Bucket names repeat the account ID and region (`111122223333--demo-...--eu-west-2`); the chips wrap into a wall. | Show a bucket table: short name, region, size, objects, and what it is connected to ("written by Firehose", "made by stack"); the full name on hover and in copy. | s3.aws.c, ux.aws.c |
| 7 | S3, first open | The CORS plan's diff is shown in full before the Approve button; on a phone that is most of two screens. | One sentence and the Approve button first; the diff folded under "Show the change". In the twin, say plainly that this is the same plan a real account would get. | s3.aws.c |
| 8 | Phone, all tabs | The twin bar and the identity card take the whole first screen; the file table squeezes names into five lines. | Fold identity into a header menu on narrow screens; file rows as two-line list items (name, then size and date). | aws.c (shell), s3.aws.c |
| 9 | S3 table | Folder and file icons are emoji in CSS `content`; with no emoji font they render as a hollow box. | Two small inline SVG icons in style.css (no new origin, CSP unchanged). | s3.aws.c |
| 10 | Home | "Try the twin" is a quiet outline button under the Google button, and below the fold on a phone (also sherpa.aws.c walk 1, item 8), yet it is the only way most visitors can see anything. | Two equal paths in the hero: "Sign in with Google" for owners, "Try the twin" for everyone else, with one line on what each shows. | aws.c |
| 11 | Twin, arrival | The twin opens on Accounts, which shows set-up steps for a real account (sherpa.aws.c b). | Open the twin on S3 with buckets listed (with finding 4). | aws.c |
| 12 | Twin, identity bar | "Sign out" and "Forget this device" duplicate "Leave the twin" (sherpa.aws.c c). | In twin mode show only "Leave the twin". | aws.c |
| 13 | Twin, Plans tab | Twin visitors see the owner's real plans (sherpa.aws.c d). | In the twin, show only plans made in the twin. | aws.c |
| 14 | Session expiry | "Until 04:23 AM": 12-hour, no time zone (sherpa.aws.c e). | en-GB 24-hour with the zone, for example "until 04:23 UTC". | aws.c |
| 15 | Tabs | No arrow keys or roving tabindex (sherpa.aws.c f). | ARIA tabs pattern: arrows move, Home and End, one tab stop. | aws.c |

## 2. Five complete consoles

Dinis: "not just different themes. This has to be 5 different complete UIs", each focused on how he uses AWS. So each console below starts from a different question, has its own home screen and its own way to move, and they share only the API layer, the twin, the account switcher, screenshot mode and the hash routes (so a link to a bucket opens in any console).

| Console | The question it answers | Home screen | How you move | A bucket looks like | Best for |
|---|---|---|---|---|---|
| **Map** | What is connected to what? | The graph of the account at one altitude: business functions at the top, resources at the bottom (memo 21) | Click a node, follow an edge, zoom altitude; a 3D mode later | A node with its edges: the Firehose stream writing to it, the stack that made it, the Route 53 records and CloudFront distribution in front of it, the roles that can read it | Understanding and clean-up: orphans and over-privilege show as odd shapes |
| **Timeline** | What happened, and when? | A time axis of events across services: CloudTrail, plans applied, log volume, twin scenarios | Scrub, zoom, filter by actor or resource; replay at speed | A lane of events: writes, reads, CORS change, who did each | Investigations, "what changed last night", attack scenarios |
| **Files** | What is in it? | Every bucket as a folder tree with a preview pane | Keyboard and path, like a file manager; open anything (zip, gzip, JSON Lines, CSV) as a table | A folder with "Latest", a date strip and a size map | Daily S3 work, the extract workflow, link mode; the S3 browser grows into this |
| **Desk** | What should change? | An inbox: plans waiting, findings (unused roles, wide policies, buckets nobody reads), drift between template and account | Work through items one by one; each ends in a plan with a diff, or "accept" | Its CORS, policy and lifecycle as code, next to what is live, with findings against it | IAM clean-up, approving plans, getting to "all the right privileges" |
| **Command** | Do this now. | A command line with history and results as cards | Typed verbs close to Boto3: `s3 ls`, `open`, `who reads <bucket>`, `plan cors <bucket>`; a palette (Ctrl+K) in every other console opens it | The answer to whatever you asked, with links into the other four | Speed for Dinis, and the most natural surface for an AI agent driving the page |

Why these five: Dinis's own description of his work maps to them. He maps and cleans up (Map, Desk), wants to "finally understand what ... is happening" (Timeline), lives in S3 and its logs today (Files) and replaces Boto3 scripts (Command).

What each needs from the API layer (for architect.aws.c): Map needs the per-asset relation lists (ontology.aws.c); Timeline needs events with a time, an actor and a resource; Files needs ranged reads and decoders (zip.js, gzip, JSON Lines, CSV) as a library; Desk needs plans and findings as data; Command needs every API call described once (the OpenAPI document), so commands are generated, not written by hand.

### Across all five

- **A 3D view in each** (memo 23, with viz.aws.c): Map as a 3D graph by altitude; Timeline as a lane landscape over time; Files as a size map of a bucket; Desk as the trust graph with over-privilege raised; Command's results open in any of them. 3D is an option inside each console, never the only way in, and every 3D view has a flat, keyboard-usable equivalent.
- **Try the twin everywhere** (memo 18): every console and area site opens on the twin with one click and no sign-in, and says so in the same twin bar.
- **Demo packs restructure the UI** (memo 19): loading a pack is a first-class action in the shell, and each console must look right with one bucket or with hundreds, so packs are also the test fixtures for the designs.

## 3. The S3 browser's next level

The order I propose, each a small finished piece on the twin; s3.aws.c owns site/s3.js, so these are requests to s3.aws.c and pm.aws.c's board, not edits by me:

1. Hash routes and Back (finding 2), then auto-list in the twin (finding 4). Small, and every later step needs addresses.
2. Split view on desktop: list on the left, preview on the right; on a phone the preview is its own screen with Back. Widths: at 1024 px and above, list 40% (min 320 px), preview 60%, a draggable divider remembered per browser; 720 to 1023 px, list 45% and preview 55%, no divider; below 720 px, one column, opening a file pushes a preview screen (its own hash route) and Back returns to the same scroll place in the list. The preview header keeps the key, size, type and Download; the list keeps the breadcrumb and filter, so both halves stay usable on their own.
3. Logs as tables (finding 3), with counts per column. Values are always set as text; link mode builds links only for known types (bucket, key, IP, vault id) from a fixed pattern, never from a raw value, because bucket contents are untrusted (docs/security/risks.md R-002).
4. "Latest" and the date strip for date-partitioned prefixes (finding 1).
5. The bucket table with relations (finding 6), the first place the Map console shows through.
6. Keyboard: arrows or j/k to move, Enter to open, Backspace to go up, `/` to filter.

## 4. Security check of this note

Design only; no code changed. Points for security.aws.c: hash routes put bucket and key names in the browser history and in screenshots (screenshot mode should blur the hash-driven breadcrumb as it does names); link mode must not turn data into URLs (point 3 above). No new origins, no storage beyond what the page already keeps.

## 5. Who does what with design.c

Agreed with design.c (03:24 UTC): ux.aws.c owns the console UX inside the AWS Platform site and its area sites (the five consoles, the S3 browser, flows, information architecture, usability fixes) in docs/design/**; design.c does not edit console UIs and reviews this work against design.b's standard (Site__Agent__Design docs/guidelines.md and rating.md), sending findings. family.css, tokens and landing pages stay the keeper's (aws.c): a new token or component for a console is a request to aws.c, copying design.c for a check. design.c's own five page designs go in site/designs/** once claimed. Dinis decides any change to this split.

## 6. Next wake

Merge the rest of sherpa.aws.c's walk 1; one clickable prototype of the Files console on the twin (a path for it, such as site/consoles/files/, to agree with aws.c and architect.aws.c); a wireframe each for the other four.
