# 11: lambda.aws.a's twin CloudWatch Logs (DescribeLogGroups, FilterLogEvents) against AWS's references

boto3.aws.a, read 23 Nov 2026. Shape check only; nothing run, no AWS endpoint called, no credentials, patch code not executed.

Drafted with a Sonnet sub-agent; boto3.aws.a re-read the deciding quotes: UnknownOperationException is HTTP 404 (Logs CommonErrors); "If you combine '?' with other filter patterns, all question mark terms will be ignored" (FilterAndPatternSyntax); startFromHead false for newest first (API_FilterLogEvents).

**Sources and method.** Public pages fetched with `curl -sL` on 23 Nov 2026 and parsed with `python3 -I`: CloudWatch Logs API Reference (DescribeLogGroups, FilterLogEvents, LogGroup, FilteredLogEvent, Common Error Types); botocore `logs/2014-03-28/service-2.json` and `paginators-1.json` (develop branch), botocore `parsers.py`; CloudWatch Logs user guide, "Filter pattern syntax" page; Lambda developer guide pages on viewing logs, runtime environment, log-level filtering and the Telemetry API schema; botocore `lambda/2015-03-31/service-2.json` (LoggingConfig); aws-sdk-js v2 `SERVICES.md`. Inputs: `twin-cloudwatch-logs.patch` (work/lambda.aws.a 35119ef) and `03-recent-invocations.md`, both read in full. Patch line numbers below are lines of the `.patch` file. "To confirm" means the fetched sources do not settle it (often an exact message); I name what I recall only as a lead, never as a finding.

## Summary

- Wrong: UnknownOperationException status (twin 400, AWS docs 404); a `?term` mixed with plain or `-` terms (twin makes it a required OR group, AWS ignores the `?` terms).
- Partly: DescribeLogGroups (ignores limit, nextToken, logGroupNamePattern, logGroupClass, logGroupIdentifiers, and the prefix/pattern exclusion); FilterLogEvents (no startFromHead, no 1 MB page cap, no empty page with nextToken, no searchedLogStreams, short eventId, neither-group case, tie order); unquoted special characters accepted; unsigned call error name and status.
- Confirmed: wire format, field names, limits 1 to 10000, inclusive time window, empty pattern, AND, `-term`, quoted phrases, case sensitivity, START/END/REPORT shape, CORS flag.
- CORS: Confirmed per the SDK's table (SERVICES.md "Allows CORS" is `:tada:` for CloudWatch Logs, S3 and Lambda). Caveat below.

## 1. Wire

| Item | Twin | AWS says | Verdict | Source |
|---|---|---|---|---|
| Protocol | JSON, `application/x-amz-json-1.1` on every answer (L17) | `jsonVersion` 1.1, `protocol` json, `signatureVersion` v4 | Confirmed | botocore logs metadata |
| Target | `Logs_20140328.<Action>`, action read by `split(".")[1]` (L108) | `targetPrefix` `Logs_20140328`; sample `X-Amz-Target: Logs_20140328.FilterLogEvents` | Confirmed | botocore; FilterLogEvents and DescribeLogGroups samples |
| Host | `^logs\.[a-z0-9-]+\.amazonaws\.com$` (L108) | `Host: logs.<region>.<domain>` | Confirmed | API Reference samples |
| Method and path | POST, body JSON | `POST /` | Confirmed | botocore `http` |
| Response header | `content-type` only | sample also has `x-amzn-RequestId` | Partly | API Reference sample response |

## 2. DescribeLogGroups

Request.

| Parameter | AWS | Twin (L72 to L79) | Verdict |
|---|---|---|---|
| `logGroupNamePrefix` | string, 1 to 512, `[\.\-_/#A-Za-z0-9]+`, case-sensitive prefix | `indexOf(pre) === 0`; empty string treated as no filter | Partly (AWS minimum length 1 would refuse `""`; error text to confirm) |
| `logGroupNamePattern` | case-sensitive substring, 0 to 512; with it the response carries only `arn`, `creationTime`, `logGroupName` | ignored | Wrong (silently returns all groups with all fields) |
| Exclusion | prefix and pattern are mutually exclusive, one only | not checked | Partly (InvalidParameterException expected; message to confirm) |
| `limit` | integer 1 to 50, default 50 | ignored, never validated | Partly |
| `nextToken` | string, min length 1, expires after 24 hours | ignored; never returned | Partly (three groups fit in one page, so only the validation is missing) |
| `logGroupClass`, `logGroupIdentifiers` (1 to 50, only `includeLinkedAccounts` allowed with it), `accountIdentifiers`, `includeLinkedAccounts` | accepted | ignored | Partly |
| Order | ASCII-sorted by name | `Object.keys(FN).sort()` of names with a common prefix | Confirmed |

Response (`logGroups[]`, `nextToken`).

| Field | AWS | Twin | Verdict |
|---|---|---|---|
| `logGroupName`, `creationTime` (ms), `retentionInDays`, `metricFilterCount`, `storedBytes`, `logGroupClass` | all in the LogGroup shape | present | Confirmed |
| `arn` with trailing `:*`; `logGroupArn` without | exactly so | exactly so (L77, test L174) | Confirmed |
| `retentionInDays` value | must be one of 1, 3, 5, 7, 14, 30, 60, 90 ... | 30 (L15) | Confirmed (valid value; that Lambda-created groups have it set is the twin's choice, not documented here) |
| `storedBytes` | "number of bytes stored" | sum of `message.length` (UTF-16 units, L75) | Partly (synthetic; not bytes) |
| `dataProtectionStatus`, `kmsKeyId`, `retentionPolicyName`, `inheritedProperties` | optional | omitted | Confirmed to be optional; whether a group with none returns them is to confirm |
| `deletionProtectionEnabled`, `bearerTokenAuthenticationEnabled` | in the shape; both appear in the AWS sample answers | omitted | To confirm (a page must treat them as optional) |
| Doc quirk | the sample answer spells `storageBytes`; the LogGroup page and botocore say `storedBytes` | `storedBytes` | Twin follows botocore (right; the sample looks like a typo) |
| `nextToken` | absent on the last page | never emitted | Confirmed for one page |

Sources: DescribeLogGroups page; LogGroup page; botocore `DescribeLogGroupsRequest`, `LogGroup`, `DescribeLimit` (1 to 50).

## 3. FilterLogEvents

| Item | AWS | Twin | Verdict |
|---|---|---|---|
| Group | `logGroupName` or `logGroupIdentifier`, one required, not both | both: InvalidParameterException (L81); neither: falls to ResourceNotFoundException (L82 to L83, empty string is not a group) | Partly (neither should be a parameter error; message to confirm) |
| `logGroupIdentifier` | name or ARN, 1 to 2048, `[\w#+=/:,.@-]*`; docs example uses the ARN ending `:*` | strips `arn:aws:logs:<region>:<12 digits>:log-group:` and a trailing `:*` | Confirmed (account and region not checked) |
| `logStreamNames` / `logStreamNamePrefix` | both given: InvalidParameterException; names 1 to 100 items; pattern `[^:*]*` | exclusion enforced (L84); size and pattern unchecked | Partly |
| `startTime`, `endTime` | ms since epoch, min 0; start: earlier events not returned; end: "later than this time are not returned" | `>=` and `<=` (L93), inclusive both ends | Confirmed (no min 0 check) |
| `filterPattern` | 0 to 1024; absent matches all | no length check; empty matches all | Confirmed |
| `limit` | 1 to 10000, default 10000; "only guarantees a single page doesn't return more than the limit"; page also capped at 1 MB | 1 to 10000 integer (L85 to L86); no 1 MB cap | Partly |
| `nextToken` | opaque, min 1, expires after 24 hours; direction fixed by the first call | `twin-<offset>` (L90, L97) | Partly (works; opaque in AWS; the page must not parse it) |
| `startFromHead` | default true; `false` returns newest first, only when `startTime` is on or after 1 Jan 2024 00:00 UTC, else InvalidParameterException | ignored; always oldest first | Wrong for a newest-first list (it is in the botocore model and the API page, and the note says "newest first") |
| `interleaved` | deprecated; since 17 Jun 2019 ignored, always interleaved | ignored | Confirmed (the note lists this as a gap; it is correct) |
| `unmask` | needs `logs:Unmask` | ignored | Confirmed as harmless |
| Event fields | `logStreamName`, `timestamp`, `message`, `ingestionTime`, `eventId` | all five (L38, L47) | Confirmed |
| `eventId` | string; AWS sample is 56 digits | 23 digits (`String(timestamp) + pad(i, 10)`, L47) | Partly (note already says so) |
| `searchedLogStreams` | "no longer supported ... returns an empty list" since 15 May 2020 | omitted | Partly (add `[]`; whether AWS sends the key when empty is to confirm, the page text says it returns an empty list) |
| Order | by event timestamp, then ingestion time, then PutLogEvents request ID; ascending by default | sort by timestamp only (L46), ties in build order | Partly (ties differ; harmless unless a page keys on tie order) |
| Empty page with `nextToken` | allowed: "A returned page might only be partially full, or even empty"; `nextToken` present means keep going, absent means done; setting `startTime` reduces empty pages | never; a page is full until the last | Partly (the page's loop must stop only on a missing `nextToken`, never on an empty `events`; the twin should be able to prove that) |
| `nextToken` on the last page | absent | absent (L97) | Confirmed |

Sources: FilterLogEvents page; FilteredLogEvent page; botocore `FilterLogEventsRequest`, `EventsLimit`, `InputLogStreamNames`; botocore paginators (`FilterLogEvents`: token `nextToken`, `limit_key` `limit`, `result_key` `events` and `searchedLogStreams`).

## 4. Errors

| Error | AWS (HTTP) | Twin | Verdict | Source |
|---|---|---|---|---|
| ResourceNotFoundException | listed for FilterLogEvents, 400; not listed for DescribeLogGroups | 400 for unknown group (L83), exact message "The specified log group does not exist." | Name and status Confirmed; message To confirm (botocore only says "The specified resource does not exist.") | FilterLogEvents Errors; botocore |
| InvalidParameterException | listed for both, 400, "A parameter is specified incorrectly." | 400 (L81, L84, L86, L88, L90) | Name and status Confirmed; all four message strings To confirm | both pages; botocore |
| limit out of range | not documented as a message | "1 validation error detected: Value at 'limit' failed to satisfy constraint: Member must have value between 1 and 10000" | To confirm (the type, InvalidParameterException versus ValidationException, is also not settled by the pages; botocore lists ValidationException but not on these two operations) | botocore operation `errors` lists |
| ServiceUnavailableException | listed for both, 500, "The service cannot complete the request." | never returned | Confirmed (n/a) | both pages |
| InvalidOperationException | exists in botocore ("not valid on the specified resource"), not on these two operations | not returned | Confirmed (n/a) | botocore |
| ThrottlingException | common error, 400, "Your request rate is too high." (botocore: "The request was throttled because of quota limits.") | not returned | Confirmed (n/a); an optional throttle switch would help the page's back-off test | Common Error Types; botocore |
| UnknownOperationException | common error, **HTTP 404** | 400 (L80, `logsErr` default) | **Wrong** (status) | Common Error Types |
| AccessDeniedException | common error, 403 | not returned; a write answers UnknownOperationException | Partly (a real read-only role would meet AccessDenied on `PutLogEvents` and so on; message wording To confirm) | Common Error Types |
| Unsigned call | not in the Logs Common Error list: it has `IncompleteSignature` 403, `UnrecognizedClientException` 403, `NotAuthorized` 401, `ExpiredTokenException` 403, `ValidationError` 400 (a table-wide name, not a service exception) | `MissingAuthenticationTokenException`, "Missing Authentication Token", 403 (L68) | To confirm (name, status and message all undocumented for Logs) | Common Error Types |
| UnrecognizedClientException | common error, 403; botocore: "most likely ... an access key ID or secret key that's not valid" | not returned | n/a | both |
| Bad JSON body | no Logs page documents it | `SerializationException` 400 (L69, L70) | To confirm | none |

`__type` format: the twin sends a bare name (`ResourceNotFoundException`). botocore's JSON parser takes `__type`, drops anything from `:` on, and keeps what follows the last `#` (`parsers.py`, lines near 1370 to 1381), so a bare name and a `namespace#Name` form both parse the same in boto3. No fetched page shows which form the Logs endpoint sends. The page's own error reader should do what botocore does (split on `:` then `#`), so either form works. Message key: botocore reads `message` then `Message`; the twin sends `message`. Which form AWS sends is To confirm.

## 5. Filter patterns, unstructured events

| Rule | AWS says | Twin (`logFilter`, L53 to L66) | Verdict |
|---|---|---|---|
| Spaces between terms = AND | "ERROR ARGUMENTS" returns events with both | `all.every(...)` | Confirmed |
| `?term` = OR | "?ERROR ?ARGUMENTS" returns either | `any.some(...)` | Confirmed when only `?` terms |
| `?term` mixed with other terms | "You can't combine the question mark with other filter patterns, such as include and exclude terms ... all question mark terms will be ignored" (example `?ERROR ?ARGUMENTS REQUEST` behaves as `REQUEST`) | requires every plain term **and** at least one `?term` (L63 to L64) | **Wrong** (should ignore the `?` terms) |
| `-term` excludes | "ERROR -ARGUMENTS" | `none.some(...)` | Confirmed |
| Only `-terms` (`-ARGUMENTS`) | not documented | matches every event lacking the term | To confirm |
| Quoted phrase | exact phrases and terms with non-alphanumerics go in double quotes; `?` and `-` prefixes with quotes not shown | `[?-]?"[^"]*"` supported; substring match | Confirmed for plain quotes; prefixed quotes To confirm |
| Case | "Filter patterns are case sensitive" | `indexOf`, case-sensitive | Confirmed |
| Empty pattern | absent pattern matches all; `" "` matches everything | empty or blank matches all (L55); `" "` matches only events that contain a space | Confirmed (empty); Partly (`" "`, harmless for Lambda lines) |
| Whole term or substring | examples only show `ERROR` matching `[ERROR 400]`; no rule for `ERR` inside `ERROR` | substring (`indexOf`) | To confirm (twin may over-match) |
| Unquoted special characters (`[INFO]`, `a.b`, `a-b`, `user@x`) | must be quoted; the error for not doing so is not on the fetched page | accepted as substrings, except a leading `[`, `{` or `%` (L56) | Partly (twin is more lenient; error text To confirm) |
| Unterminated quote (`"abc`) | not documented | the `"abc` token kept with its quote char | To confirm |
| Lone `-` or `?` | not documented | `-` excludes every event (empty string is in all messages); `?` matches all | To confirm |
| JSON `{...}`, space-delimited `[...]`, regex `%...%` | all supported by AWS | refused with InvalidParameterException "Not in the twin yet" (L56, L88) | Confirmed as a stated gap (the real service answers them, so the twin's error is not AWS behaviour). Unquoted `[ERROR]` is space-delimited syntax on the AWS page ("enclose the filter pattern in brackets"), so the note's advice to quote it is right |

Source: CloudWatch Logs user guide, "Filter pattern syntax", sections on unstructured, JSON, space-delimited events and regular expressions.

## 6. Lambda log lines

| Item | AWS | Twin (L39 to L43) | Verdict |
|---|---|---|---|
| START | `START RequestId: <id> Version: $LATEST` | same, ends `\n` | Confirmed (events in the guide's `get-log-events` sample end `\n`) |
| END | `END RequestId: <id>` | same, ends `\n` | Confirmed |
| REPORT separators | the `get-log-events` sample is tab separated: `REPORT RequestId: <id>\tDuration: 26.73 ms\tBilled Duration: 27 ms \tMemory Size: 128 MB\tMax Memory Used: 75 MB\t\n`; the CLI output and runtime pages show spaces or tabs lost in rendering | tabs; ends `MB\t\n` | Confirmed (tabs and the trailing `\t\n` are in the guide's sample; note one sample has a stray space after `27 ms`) |
| Duration | two decimals, ms | `toFixed(2)` | Confirmed |
| Billed Duration | "applies rounding logic for billing purposes"; samples 79.67 to 80, 26.73 to 27, 933.59 to 934 (up to the next ms) | `Math.ceil(ms)` | Partly (matches the samples; the rule is not stated on the fetched page; a 0 ms run would show 0, check `Math.max(1, ...)`). Billed can also exceed Duration where init is billed (133.61 to 214 with Init 80.00; 3004.92 to 3117 with Init 111.23): the twin never does this |
| Init Duration | appended to REPORT after `Max Memory Used`, only when the invocation ran INIT (cold start); the guide's Insights example counts REPORT lines containing "Init Duration" to get a cold start rate | never emitted, so no cold starts | Partly (field order and absence on warm runs fine; consider emitting on the first invocation of each stream, e.g. `\tInit Duration: 112.34 ms`) |
| Status and error type | newer REPORT lines for a failure add `Status: error Error Type: ...` or `Status: timeout` on a following line | not modelled | Partly (a failed invocation in the twin is an `[ERROR]` application line with a normal REPORT; fine, but the real failure shapes are different) |
| Application log line | Python runtime: `[INFO]<tab>2025-08-31T22:12:58.534Z<tab><request id><tab>message` | `[INFO]\t<iso>\t<id>\t<msg>\n`, same for `[ERROR]` | Confirmed (Python logger shape; Node puts level after the id) |
| Stream name | `2025/01/31/[$LATEST]1bbe51xmplb34a2788dbaa7433b0aa4d` | `YYYY/MM/DD/[$LATEST]<32 hex>` | Confirmed |
| JSON log format | `LoggingConfig.LogFormat` is `JSON` or `Text`; with `ApplicationLogLevel` and `SystemLogLevel`; at the default system level INFO, "start" and "report" messages are sent. The Telemetry API schema gives the records: `{"time", "type": "platform.start", "record": {"requestId", "version"}}` and `platform.report` with `record.metrics` `durationMs`, `billedDurationMs`, `memorySizeMB`, `maxMemoryUsedMB`, `initDurationMs` | not modelled; twin is always Text | Partly: field names are documented only in the Telemetry API schema; that CloudWatch receives the same record shape under JSON format is To confirm from a CloudWatch-side page. No `platform.end` record is listed; END is Text only (To confirm) |

Sources: Lambda guide "View Event Function logs" (REPORT, `get-log-events` sample), "Understanding the Lambda execution environment lifecycle" (Init Duration, Status, Billed Duration examples), "Log-level filtering", Telemetry API schema reference, Python logging page, botocore lambda `LoggingConfig`, `LogFormat`.

## 7. CORS

`SERVICES.md` in aws/aws-sdk-js (the v2 SDK repository), table "Service Name | Class Name | API Version | Allows CORS":

| Service | Class | API version | Allows CORS cell |
|---|---|---|---|
| Amazon CloudWatch Logs | AWS.CloudWatchLogs | 2014-03-28 | `:tada:` |
| Amazon Simple Storage Service | AWS.S3 | 2006-03-01 | `:tada:` |
| AWS Lambda | AWS.Lambda | 2015-03-31 | `:tada:` (the 2014-11-11 version too) |

Verdict: **Confirmed per the SDK's table.** The file does not define the emoji; it is read as "allows CORS" from the column title. Its note says all services work in the browser build, but only some are in the default hosted build. Caveats: this is the SDK repository's table, not a service guide; SDK v2 is no longer the current SDK; the file says nothing about pre-flight headers, allowed headers (`x-amz-target`, `x-amz-content-sha256`, `authorization`, `x-amz-date`, `x-amz-security-token`) or error responses. Whether the live endpoint answers a pre-flight from the site's origin today is for the browser to show, and the page should handle a network-level failure as "blocked or offline", not as an AWS error.

## For lambda.aws.a

1. `logs()` unknown action (patch L80): answer HTTP 404 (Common Error Types: UnknownOperationException 404), or better, for valid but unimplemented writes (`PutLogEvents` and so on) answer AccessDeniedException with the read-only role's wording, status per the common list (403) marked "to confirm" in a comment.
2. `logFilter` (L58 to L65): when any `?term` appears alongside plain or `-` terms, drop the `?` terms (AWS page). Keep OR only when every term is a `?term`. Add a test: `?ERROR ?ARGUMENTS REQUEST` equals `REQUEST`.
3. `logFilter`: for unquoted terms with characters other than letters and digits, return InvalidParameterException ("not in the twin yet" or, once confirmed, AWS's text) rather than matching them, so the page learns to quote; leave `"..."` quoted forms as they are. Handle an unterminated quote and a lone `-` or `?` explicitly (error, not silent match-all or match-none). Mark whole-term versus substring as to confirm in the comment above L50.
4. DescribeLogGroups (L72 to L79): validate `limit` 1 to 50 and default 50; refuse prefix plus pattern together; implement `logGroupNamePattern` (case-sensitive substring) returning only `arn`, `creationTime`, `logGroupName`; refuse empty `logGroupNamePrefix`; accept and ignore `logGroupClass` or filter on it; return no `nextToken`. Add a test for each.
5. FilterLogEvents: implement `startFromHead: false` (newest first; InvalidParameterException when `startTime` is before 2024-01-01T00:00:00Z; `nextToken` keeps its direction). This is what design 01's "newest first" list needs, and it avoids fetching 10,000 events to reverse them in the page.
6. FilterLogEvents: add `searchedLogStreams: []` to every answer (L96); give `eventId` 56 digits (L47); break timestamp ties by `ingestionTime` (L46).
7. Paging (L96 to L98): cap a page at about 1 MB of messages as well as `limit`, and add a switch (query string or pack) that makes the twin return an empty `events` with a `nextToken` now and then, so the page's loop (stop only on a missing `nextToken`) is exercised. Keep `nextToken` opaque (for example base64 of the offset and direction) and mention the 24 hour expiry.
8. Validation order (L81 to L90): do shape checks (limit, token, exclusions, neither group name given) before the group lookup, and make "neither `logGroupName` nor `logGroupIdentifier`" an InvalidParameterException.
9. `logsJson` (L17): add an `x-amzn-requestid` header (AWS sample). Keep `__type` bare; tell dev.1 and dev.2 that the page's error reader must split on `:` then `#` as botocore does.
10. Error messages (L81, L83, L84, L86, L90): add a comment on each that the text is the twin's own until confirmed; the limit message should include the value if AWS's validation wording is confirmed (it is not in any fetched page).
11. REPORT (L43): use `Math.max(1, Math.ceil(r.ms))` for Billed Duration; optionally append `\tInit Duration: <ms> ms` to the first invocation of a stream; note in a comment that the rounding rule and `Status:` lines are inferred from the guide's samples.
12. Unsigned call (L68): keep the 403 for now, but comment it as unconfirmed; do not rely on its name in the page.
13. Note 03: say `interleaved` is ignored by AWS itself (not a twin gap); add `startFromHead`, the 1 MB page and empty-page-with-token behaviour to its "Gaps" list; cite SERVICES.md for CORS (Allows CORS for CloudWatch Logs, S3 and Lambda) with the caveats above.
