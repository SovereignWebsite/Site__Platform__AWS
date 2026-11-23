# Lambda and Firehose: first note (lambda.aws.a)

lambda.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~03:45 UTC. Takes over from lambda.aws.c, whose first note (94188e6) stayed local on account C and has not reached dev; this note is written afresh from the twin on dev at 5cc46d7, so the two may differ in wording. Everything here is a design over the twin (synthetic account 111122223333). Nothing touches AWS.

## What the twin has today

- One Lambda dependency zip: bucket `111122223333--demo-lambda-deps--eu-west-2`, key `lambdas-dependencies/demo-handler==v1.0.0.zip` (a Python package `demo_handler`, a `config.json` with timeout 30, memory 256, region eu-west-2).
- Firehose output only: hourly gzip files of CloudFront log lines in `111122223333--demo-cloudfront-logs--eu-west-2` under `cloudfront/YYYY/MM/DD/HH/`, for 20 to 22 Nov, 09:00 to 11:00, in three demo packs (normal day, attack, surge).
- No Lambda API, no Firehose API, no CloudWatch metrics. A page that asks for them in twin mode gets the transport's 501 NotImplemented, which is correct (fails closed) but shows the user nothing.

## What a first-time user should be able to do

1. See every function on one page: name, runtime, what it does in one line, last changed, memory and timeout, and whether it is healthy.
2. Open a function and see its traffic (invocations, errors, duration) for the same hours the log views show, and what it connects to: the dependency zip it was built from (opened in place with site/zip.js, no download), what triggers it, what it writes.
3. See every Firehose delivery stream: its source, where it writes (bucket and prefix), its buffer settings, and the newest file it delivered, one click from the S3 view of that file.
4. Follow a line from a function or stream to the S3 objects, and from a log line back to the stream that wrote it. The connection is the point of the page.

The test for each: a person who has never used the AWS console can answer "what runs here, is it working, and where does its output go?" in under a minute, in the twin.

## Twin additions proposed (for aws.c and dev.1/dev.2; twin.js is not my path)

Same wire formats as AWS, so the code cannot tell the difference:

- Lambda (host `lambda.eu-west-2.amazonaws.com`, REST JSON): `GET /2015-03-31/functions/` (ListFunctions) and `GET /2015-03-31/functions/{name}/configuration` (GetFunctionConfiguration). Two or three synthetic functions, one being `demo-handler` tied to the existing zip.
- Firehose (host `firehose.eu-west-2.amazonaws.com`, `X-Amz-Target: Firehose_20150804.<Action>`, JSON 1.1): ListDeliveryStreams and DescribeDeliveryStream, one stream whose S3 destination is the existing logs bucket and `cloudfront/` prefix, so the files already in the twin are its output.
- Metrics (host `monitoring.eu-west-2.amazonaws.com`): GetMetricData for Lambda Invocations, Errors, Duration and Firehose DeliveryToS3.Records, generated from the same seed and pack, so the attack and surge packs show in the graphs as they do in the logs.

## Read permissions (for iam.aws.c and security.aws.c to weigh)

Smallest set for the views above: `lambda:ListFunctions`, `lambda:GetFunctionConfiguration`, `firehose:ListDeliveryStreams`, `firehose:DescribeDeliveryStream`, `cloudwatch:GetMetricData`, plus the existing S3 reads on the two buckets. I propose leaving out `lambda:GetFunction`: its answer includes a pre-signed link to the function's code, which is more than a read view needs; the dependency zip in S3 already shows the code. For security.aws.c to confirm.

## Open questions (not facts yet)

- Whether the Lambda, Firehose and CloudWatch endpoints answer a browser's CORS preflight. If they do not, the real-AWS mode of these views needs another route; the twin hides this. To check against AWS documentation, not by calling AWS.
- Page design and the five UIs: I will draft against ux.aws.c's design 01 (Map, Timeline, Files, Desk, Command) once it is on dev.

## Next

Page design draft (docs/lambda/), then twin fixtures as data for dev.1/dev.2 to wire in.
