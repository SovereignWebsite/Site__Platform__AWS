# Note 03: recent invocations, from CloudWatch Logs

lambda.aws.a@SovereignWebsite.dinis, 23 Nov 2026, 16:40 UTC. Material for dev.1.aws.a, dev.2.aws.a, ux.aws.a, boto3.aws.a, iam.aws.a and security.aws.a. Twin first; nothing here touches AWS.

## What the view answers

On a function's page (design 01), below the charts: "what did this function do just now, and did any call fail?" A list of the latest invocations, newest first, each one line: time, duration, billed duration, memory used out of memory size, and a red mark if the invocation logged an error. Opening a line shows its log lines. A filter box takes a CloudWatch Logs filter pattern (for example `"[ERROR]"`). The chart's hour, when clicked, sets the time window, so a spike in Errors leads straight to the failing calls.

## API calls (read only)

- `DescribeLogGroups` with `logGroupNamePrefix: "/aws/lambda/"`: which functions have logs, retention, stored bytes.
- `FilterLogEvents` on `/aws/lambda/<function>` with `startTime` and `endTime` (epoch ms), an optional `filterPattern`, `limit`, and `nextToken` for more. One invocation is the events between `START RequestId: <id>` and `REPORT RequestId: <id>`, grouped by request id; the REPORT line carries Duration, Billed Duration, Memory Size and Max Memory Used.
- Protocol: JSON 1.1, `X-Amz-Target: Logs_20140328.<Action>`, host `logs.<region>.amazonaws.com`, signed with SigV4 like the others.

Permissions the read role would need: `logs:DescribeLogGroups` and `logs:FilterLogEvents` on `arn:aws:logs:<region>:<account>:log-group:/aws/lambda/*`. A plan for aws.c and iam.aws.a when wanted; an AWS change, so Dinis approves.

CORS: the same SDK v2 table note 02 used marks CloudWatch Logs (AWS.CloudWatchLogs, 2014-03-28) as allowing it (boto3.aws.a, note 11). Documentation in the SDK repository, not a service guide and not a test.

The list asks with `startFromHead: false`, newest first (AWS supports it for startTime on or after 1 Jan 2024, note 11).

## The twin (patch for dev.1 or dev.2)

- docs/lambda/patches/2026-11-23__twin-cloudwatch-logs.patch, against work/lambda.aws.a (dev c87dc92 plus the earlier Lambda, Firehose and CloudWatch patch).
- docs/lambda/patches/2026-11-23__twin-cloudwatch-logs.on-dev1-91166d6.patch, the same change against work/dev.1.aws.a at 91166d6 (packs as data: it reads the hours through `hoursOf(w)` and keeps its cache on the world, not enumerable, as `hoursOf` does). There, every twin and API test passes, and so does the twin e2e test.

What it does: `DescribeLogGroups` and `FilterLogEvents` for the three Lambda log groups, built from the same hourly CloudFront log files as the metrics. So the three views agree: demo-handler has one invocation per vault API request, REPORT Duration is that request's `time_taken`, and an `[ERROR]` line marks each request answered 4xx or 5xx (the metric's Errors, so the attack pack shows them on 22 Nov). demo-log-enricher runs four times an hour with an `[INFO] Enriched <n> records` line, the four adding up to the hour's lines. demo-nightly-report has no events in these daytime hours. One log stream per function and hour, named as Lambda names them (`2026/11/21/[$LATEST]<32 hex>`).

Filter patterns for unstructured logs, as CloudWatch Logs reads them: plain terms all must appear, `?terms` at least one, `-terms` none, `"quoted phrases"` whole, case-sensitive. JSON (`{...}`), space-delimited (`[...]`) and regex (`%...%`) patterns answer InvalidParameterException "not in the twin yet". An unquoted `[ERROR]` is space-delimited syntax in CloudWatch Logs too, so the page must quote it.

Errors named as AWS names them: ResourceNotFoundException for an unknown group, InvalidParameterException for name and ARN together, a limit outside 1 to 10000, or a bad nextToken; UnknownOperationException for any other action (writes included); 403 when unsigned. Group lookups go through a list of names, so `constructor` and `__proto__` are unknown groups (test included).

Test: test/twin/logs.test.mjs (in the patch), Node only. dev.1.aws.a applied it on work/dev.1.aws.a (4d86107), adding one line: a put to the logs bucket drops the cached log events with the hours.

### Revision 02, after boto3.aws.a's note 11 (docs/boto3/2026-11-23__11-twin-cloudwatch-logs.md, work/boto3.aws.a ba7ce61)

Patch docs/lambda/patches/2026-11-23__twin-cloudwatch-logs-02.on-dev1-4d86107.patch, against dev.1's 4d86107. Fixed: UnknownOperationException is HTTP 404; ?terms combined with other terms are ignored; startFromHead false gives newest first; DescribeLogGroups takes logGroupNamePattern (three fields back), refuses prefix with pattern and an empty prefix, pages with limit 1 to 50 and nextToken; FilterLogEvents returns searchedLogStreams as an empty list, refuses a request naming no group with InvalidParameterException, and gives 56-digit event ids. Tests added for each; all twin and API tests and the twin e2e pass on 4d86107.

Gaps, not done: no 1 MB page cap and never an empty page with a nextToken; ties broken by timestamp only; no Init Duration or Status lines and no JSON log format; `interleaved` and `unmask` ignored; nextToken is the twin's own form. To confirm, as AWS does not document them: the exact error messages, whether terms match whole words (the twin matches substrings), a pattern of only -terms, and whether `__type` comes bare or #-prefixed (the page should split on ':' then '#', as botocore does).

## The browser API (patch for dev.2)

docs/lambda/patches/2026-11-23__logs-api.on-dev2-9daf26e.patch, against work/dev.2.aws.a at 9daf26e, in the shape of LambdaApi and FirehoseApi (design 03, part 1): site/api/logs-api.js, its contract site/api/logs.openapi.json, and test/api/logs-api.test.mjs.

- `LogsApi(send).groups(region, { prefix, next, max })`: DescribeLogGroups, one page `{ items, next }`; limit at most 50; no empty prefix sent.
- `LogsApi(send).events(region, group, { start, end, pattern, newest, next, max })`: FilterLogEvents; group by name or ARN; start and end as ISO or epoch ms; `newest` sends `startFromHead: false`.
- `LogsApi.invocations(events)`: no request. Groups START, END and REPORT, plus the runtime's tab-separated `[ERROR]` and `[INFO]` lines, by request id, into `{ requestId, start, end, durationMs, billedMs, memoryMb, maxMemoryMb, initMs, errors, complete, lines }`. An invocation whose REPORT is not in the page is `complete: false`.
- Errors as the other APIs give them; `__type` cut at ":" then "#" (note 11).

Test: 36 checks over the twin through the real transport and SigV4. Invocations equal the vault API requests, and their mean REPORT Duration equals the metric's Average. In the attack pack the [ERROR] count equals the metric's Errors. Also covered: request shapes, errors, bad arguments making no request, and the contract (one operation per method, exactly logs:DescribeLogGroups and logs:FilterLogEvents). It needs the twin's Logs, so it passes on work/dev.1.aws.a, or on dev.2's branch once that twin is in; dev.2's existing tests all pass with the patch.

## Security

Log messages carry request paths, and in the attack pack those are the attacker's strings (`../../etc/passwd`, SQL fragments). The page must render every message as text (textContent, never innerHTML), as it does for the CloudFront logs. No new host beyond `*.amazonaws.com`, which the CSP already allows. For a narrowed connect-src later, `logs.<region>.amazonaws.com` joins lambda, firehose and monitoring.
