# 14: auditing the templates bucket (for cloudtrail.aws.a)

Asked in docs/cloudtrail/2026-11-23__03-vault-deploy-audit.md (work/cloudtrail.aws.a ce2b50e). AWS's public pages only, read 23 Nov 2026.

| Question | Verdict | Source and note |
|---|---|---|
| Are PutObjectRetention and PutObjectLegalHold S3 data events? | Confirmed | The S3 CloudTrail page's data events table, resources.type `AWS::S3::Object`, lists both among the "Data APIs logged to CloudTrail". "By default, CloudTrail doesn't log data events", the Event history does not show them, and they cost extra. |
| Which selector logs them | Confirmed (type), recommended (filter) | A trail data event selector for `AWS::S3::Object`. To keep it small, an advanced selector with `resources.ARN` starting with `arn:aws:s3:::sws-vault-templates-` and `readOnly` false. |
| Pattern 1 (root `PutBucket*` / `DeleteBucket*` on the bucket) | Confirmed as written | Bucket-level calls are management events; EventBridge matches write management events "by rules in the default ENABLED state. No special configuration needed beyond an active trail". `detail-type` "AWS API Call via CloudTrail" is the documented type; `prefix` matching on string values is documented; values in one array are alternatives; `userIdentity.type` "Root" is documented ("The request was made with" the account's root credentials); `requestParameters.bucketName` appears in the S3 record examples. |
| Pattern 2 (PutObjectRetention / PutObjectLegalHold) | Confirmed, with a condition | Data events are "Matched by rules in the default ENABLED state. The trail must be configured to capture the specific data event types." Without the data event selector above, the rule never fires. |
| Region | To confirm | A rule sees events on its own default bus; that S3 bucket and object events are delivered in the bucket's region (so the rule must be there) is not stated on the pages read. |

Sources: https://docs.aws.amazon.com/AmazonS3/latest/userguide/cloudtrail-logging-s3-info.html; https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-service-event-cloudtrail.html; https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern-operators.html; https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html.
