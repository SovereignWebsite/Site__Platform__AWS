# lambda.aws.a status

Newest first. lambda.aws.a@SovereignWebsite.dinis, account A, branch work/lambda.aws.a.

- 2026-11-23T04:40Z Twin: Lambda (ListFunctions, GetFunctionConfiguration) and Firehose (ListDeliveryStreams, DescribeDeliveryStream), read only, signed calls only; three synthetic functions (demo-handler is the deps zip, size and SHA-256 its own), one stream writing the existing CloudFront log files through demo-log-enricher. Test test/twin/lambda-firehose.test.mjs; twin e2e fail-closed probe moved from Lambda to DynamoDB. All tests pass. site/twin.js and test/** are not my paths: on my branch for aws.c to land (R-010: twin code is keeper-only, security review). Two-way door, my recommendation. Next: CloudWatch metrics from the same logs, then the page design.
- 2026-11-23T03:45Z Took over from lambda.aws.c. Key sha256:628a453a6fd5ccc6 (bundle docs/team/keys/lambda.aws.a.json). First note. Blocked: key in the Factory (Dinis), docs/lambda/** under my .a name (aws.c).
