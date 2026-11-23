# CloudTrail with CloudWatch: what the twin has, and the first three steps

Written by cloudtrail.aws.c@SovereignWebsite.dinis, 23 Nov 2026, first wake. Read from site/twin.js at dev 4433914 and AWS's public description of CloudTrail log files. No live AWS. Points marked *to check* go to boto3.aws.c to confirm against AWS's documentation before anyone builds on them.

The aim, in Dinis's words: "finally understand what ... is happening", open source, so anyone can drop in their own CloudTrail dump.

## What the twin has today

One bucket, `aws-cloudtrail-logs-111122223333-demo`, with one log file:

`AWSLogs/111122223333/CloudTrail/eu-west-2/2026/11/22/111122223333_CloudTrail_eu-west-2_20261122T1000Z_demo.json.gz`

It holds `{ "Records": [...] }` with two records:

| Time (UTC) | Who | What | On |
|---|---|---|---|
| 22 Nov 10:01:02 | assumed-role `sws-aws-platform-read` | s3 `GetObject` | `111122223333--demo-site--eu-west-2` / `data/vaults.json` |
| 22 Nov 10:04:40 | assumed-role `sws-aws-platform-change` | iam `UpdateAssumeRolePolicy` | role `demo-dns-role` |

The key layout and file name follow the documented pattern (`AccountID_CloudTrail_Region_YYYYMMDDTHHmmZ_Unique.json.gz`), and the S3 browser already opens it as formatted JSON. There is no CloudTrail API (`LookupEvents`) and nothing for CloudWatch (Logs or alarms) in the twin.

## Where the twin differs from a real trail

These matter because the views must work on a real dump, not only on ours.

1. **Records are thin.** Real records also carry `eventVersion`, `eventID`, `eventType` (`AwsApiCall`, `AwsConsoleSignIn`, ...), `requestID`, `recipientAccountId`, `userAgent`, `readOnly`, `managementEvent`, `eventCategory`, `responseElements`, `errorCode` / `errorMessage` on failures, and `userIdentity.sessionContext` (who assumed the role, when, MFA). The second record has no `sourceIPAddress`. The views key on `eventID` (to drop duplicates), `readOnly` (to hide noise) and `errorCode` (denied calls are the interesting ones), so the twin needs them.
2. **One region folder holds a us-east-1 event.** IAM is global and its events are recorded in us-east-1, which the record gets right; but a real trail writes them into the `us-east-1/` folder, not the `eu-west-2/` file. *To check.*
3. **`GetObject` is a data event.** A trail logs it only if S3 data events are switched on (they are charged separately; no price here, billing.aws.c owns that). Fine to keep, but the twin should say which kind each record is (`managementEvent`, `eventCategory`), so the view can show "management" and "data" apart.
4. **The comment says "digest-style".** It is a log file. Digest files are separate (`CloudTrail-Digest/`, used to prove log files were not changed). Worth a later step: checking digests in the browser would be better than the console.
5. **The page's own changes leave no trail.** In the twin, `CreateChangeSet`, `ExecuteChangeSet`, `UpdateAssumeRolePolicy` and the CORS updates change state but add no record. So a first-time user who just approved a plan cannot see it appear in the timeline. This is the single change that would make the twin feel real.
6. **Names do not match.** The record names role `demo-dns-role`; the twin's IAM has `sovereignwebsite-factory-dns`. The graph (ontology.aws.c) will want them to link.

## What a first-time user should see

Usability first: someone who has never read a CloudTrail record should, in one screen, see who did what to which thing, and what looks wrong.

- **Timeline**: one line per event, newest first, in plain words ("the change role updated who may assume demo-dns-role"), with the raw record a click away. Group bursts; read-only calls folded by default; failures (`errorCode`) marked.
- **Per-asset activity**: click a bucket, role or stack anywhere in the site and see every event that touched it. This is the link into the graph.
- **Alarms view**: a short list of events worth a look, from rules written as data, not code. The first rules come from security.aws.c's R-008 (c): any `ExecuteChangeSet`, and any IAM policy or trust change on `sws-aws-platform-*`. The twin's second record would already fire the "trust policy changed" rule, which makes a good first demo.
- **Drop in your own dump**: a file picker (and drag and drop) that reads `.json` and `.json.gz` in the page. Nothing is uploaded: the site is static, with no server, so the dump never leaves the browser, and the page says so in one line. Formats, in order: CloudTrail log files (`{ "Records": [...] }`, one or many, or a zip of a downloaded folder, read with zip.js), then `LookupEvents` output (`Events[].CloudTrailEvent`, a JSON string per event) and a CloudWatch Logs export (one record per line). *To check:* the exact shape of each.

## The first three steps

1. **Twin records that look real** (needs aws.c, keeper of site/twin.js): fill out the two records as in point 1 above, move the us-east-1 event to its own region file, add a few days of ordinary activity plus two or three denied calls, and append a record for every change the page makes in the twin (point 5). I will send aws.c the record shapes as a patch.
2. **A reader and its tests** (code path to agree with aws.c and architect.aws.c, likely site/api/ or a new site/cloudtrail.js): parse the formats above into one event list, drop duplicates by `eventID`, sort by time; tests with fixtures in test/cloudtrail/. No UI yet.
3. **Timeline and alarms on the twin**, one screen, five UIs later with ux.aws.c. Then per-asset activity once the graph schema exists.

CloudWatch follows the same path: alarms first (they answer "is anything wrong"), then log groups read with filters, then metrics. The twin needs `logs` and `monitoring` endpoints before any of that; their wire formats go to boto3.aws.c first.

## For security.aws.c

A dropped-in dump is untrusted input from the user's own file. The reader must show it through `textContent` only (as the S3 browser does), cap the size it will unzip, and never fetch anything a record names. No new network calls, no change to the CSP.

## Update on account A (cloudtrail.aws.a, 23 Nov ~04:40 UTC)

The role moved to account A as cloudtrail.aws.a@SovereignWebsite.dinis. I wrote a second first note before this one reached dev; this section folds in what it added, so there is one note. Read against dev 003976e.

### Done since this note

- aws.c (787735b) fixed points 1, 2, 4 (the comment) and 6: full records, one file per region, IAM under us-east-1, the role named `sovereignwebsite-factory-dns`.
- Point 5 (the page's changes leave no trail), the first twin task aws.c gave this role: patch ready, `docs/cloudtrail/patches/2026-11-23__01-live-trail.patch`, for aws.c to apply to site/twin.js with a new test, test/twin/cloudtrail-live.test.mjs. Every sign-in (AssumeRoleWithWebIdentity, refused ones with `errorCode` AccessDenied), trust change (UpdateAssumeRolePolicy), CreateChangeSet, ExecuteChangeSet and Cloud Control UpdateResource now writes a record into the trail bucket at once, one `.json.gz` per region and five minutes (`..._twin-live.json.gz`), global services under us-east-1. Reads add nothing; `reset()` clears them. Real CloudTrail delivers a few minutes late; the twin does not, so a user sees the change they just made. With the patch, the twin's own tests (twin S3 fidelity, s3-api, twin e2e, the five pure modules) and the new test all pass.

*To check* (boto3.aws.c): whether CloudTrail records CreateChangeSet's template body or hides it, and whether a Cloud Control UpdateResource also leaves a record from the service it calls (here, S3 PutBucketCors with `invokedBy`). The patch records neither.

### Added to the plan

- **A trail per demo pack**, seeded so it is the same every time, over the same three days as the CloudFront logs: *baseline* (sign-ins, reads, Firehose writing logs, one stack update through a change set, the odd AccessDenied); *attack* (the same, plus R-008 played as a story: CreateChangeSet with a template that adds `PutRolePolicy`, ExecuteChangeSet, then UpdateAssumeRolePolicy on the DNS role (R-005), from an address and user agent never seen before, so the alarm view has something real to catch); *surge* (the trail barely changes: "the site is busy but nobody changed anything" is itself an answer).
- **More alarm rules** beside R-008 (c): CloudTrail itself changed (StopLogging, DeleteTrail, PutEventSelectors); a call from an address or user agent not seen in the earlier days; a burst of AccessDenied from one identity; policy changes beyond trust (PutRolePolicy, AttachRolePolicy, CreatePolicyVersion). Each rule written in words, each showing the records that fired it; the same rules are what aws.c can later plan as EventBridge rules or CloudWatch alarms, at Dinis's word.
- **The timeline**: filters as chips (read or change, failed only, service, who, asset), a small bar chart of events per hour as a time brush, and every state in the address (`#from=...&who=...`) so a link shows the same view. No cookie.
- **Large dumps**: stream records, index by time, asset and identity, render only what is on screen, show counts first ("41,233 events over 9 days, 3 alarms").
- **Fixtures** use documentation ranges only (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and account 111122223333.
- **Views 4 and 5**, after the first three: a map (who connects to what over the period, from ontology's graph) and a story (one session from sign-in to its last call, as a narrative).
