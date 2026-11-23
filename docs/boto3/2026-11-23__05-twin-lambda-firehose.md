# The twin's Lambda and Firehose read calls against AWS's API references

Written by boto3.aws.a@SovereignWebsite.dinis, 23 Nov 2026, 10:42 UTC wake. Lambda and Firehose come next in Dinis's order after S3. Read from site/twin.js (lambda.aws.a's read calls) and test/twin/lambda-firehose.test.mjs at dev 6985180, checked against AWS's public API references (sources at the end). No AWS endpoint was called.

## Lambda

| # | Twin today | AWS | Effect | Severity |
|---|---|---|---|---|
| L1 | `ListFunctions` returns every function with `State` and `LastUpdateStatus` | `ListFunctions` "returns a subset of the FunctionConfiguration fields"; `State`, `StateReasonCode`, `StateReason`, `LastUpdateStatus` (and its reasons) and `RuntimeVersionConfig` are not in it [1] | A list view built on the twin can show each function's state from one call; live, those fields are missing and the view shows nothing or "unknown" | Medium |
| L2 | `NextMarker: null` always present | `NextMarker` is "included if more results are available" [1] | Code that tests `"NextMarker" in r` would loop or stop wrongly live; harmless for code that tests the value | Low |
| L3 | `MaxItems` and `Marker` ignored | Up to 50 functions a response whatever `MaxItems` says; `Marker` pages [1] | Paging untested; three synthetic functions never page | Low |
| L4 | A qualified name or ARN (`demo-handler:1`, `...:function:demo-handler:prod`) and `?Qualifier=` are not understood: 404 | `FunctionName` takes a name, ARN or partial ARN of the function, a version or an alias; `Qualifier` picks a version or alias [2] | Matters once versions or aliases are shown | Low |
| | Good: 404 `ResourceNotFoundException` with `x-amzn-errortype` for an unknown function [2]; `CodeSha256` is the base64 SHA-256 of the zip; `LastModified` in Lambda's `...T..:..:...000+0000` form | | | |

For lambda.aws.a's page design (docs/lambda/2026-11-23__01-page-design.md): the Functions list shows health per row. Live, `ListFunctions` does not carry `State`, so each row needs a `GetFunctionConfiguration` call (one per function), which does carry it as part of `FunctionConfiguration` [2]. That keeps the read role on `lambda:GetFunctionConfiguration` and still without `lambda:GetFunction`, as lambda.aws.a proposed.

## Firehose

| # | Twin today | AWS | Check |
|---|---|---|---|
| F1 | `ListDeliveryStreams`: `DeliveryStreamNames`, `HasMoreDeliveryStreams` | Same shape; `Limit` default 10, paging by `ExclusiveStartDeliveryStreamName` [3] | Matches; paging untested with one stream |
| F2 | Unknown stream: `ResourceNotFoundException`, HTTP 400 | `ResourceNotFoundException`, HTTP 400 [4] | Matches |
| F3 | `BufferingHints`: 5 MiB, 900 s | `IntervalInSeconds` 0 to 900, default 300; `SizeInMBs` and `IntervalInSeconds` given together [5] | Within range. The twin's own note (one file per hour, where Firehose writes one per buffer interval of at most 900 s) is consistent with this |
| F4 | One destination, `ExtendedS3DestinationDescription` | `DestinationDescription` has `DestinationId` (required) and one description per destination type [6] | Matches as far as the reference goes. Whether a live answer also carries `S3DestinationDescription` beside the extended one is not in the reference; not assumed |

## Patch for aws.c (L1, L2)

docs/boto3/patches/2026-11-23__twin-lambda-list-subset.patch, for site/twin.js and test/twin/lambda-firehose.test.mjs:

- `ListFunctions` drops `State` and `LastUpdateStatus` from each entry and leaves `NextMarker` out (no more functions follow);
- `GetFunctionConfiguration` is unchanged and the test now checks it carries `State` and `LastUpdateStatus`;
- the test no longer expects `State` or `NextMarker` in the list, and fails if they come back.

Checked: `git apply --check` is clean at dev 6985180; the new test fails without the twin change and passes with it; s3-fidelity still passes. lambda.aws.a wrote these twin calls, so the patch goes to aws.c with a copy of this note to lambda.aws.a.

## Sources

1. AWS Lambda API Reference, ListFunctions: https://docs.aws.amazon.com/lambda/latest/api/API_ListFunctions.html (read 23 Nov 2026)
2. AWS Lambda API Reference, GetFunctionConfiguration: https://docs.aws.amazon.com/lambda/latest/api/API_GetFunctionConfiguration.html (read 23 Nov 2026)
3. Amazon Data Firehose API Reference, ListDeliveryStreams: https://docs.aws.amazon.com/firehose/latest/APIReference/API_ListDeliveryStreams.html (read 23 Nov 2026)
4. Amazon Data Firehose API Reference, DescribeDeliveryStream: https://docs.aws.amazon.com/firehose/latest/APIReference/API_DescribeDeliveryStream.html (read 23 Nov 2026)
5. Amazon Data Firehose API Reference, BufferingHints: https://docs.aws.amazon.com/firehose/latest/APIReference/API_BufferingHints.html (read 23 Nov 2026)
6. Amazon Data Firehose API Reference, DestinationDescription: https://docs.aws.amazon.com/firehose/latest/APIReference/API_DestinationDescription.html (read 23 Nov 2026)
