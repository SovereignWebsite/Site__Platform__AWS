# Vault deploy: the kill switch's role

iam.aws.a, 23 Nov 2026 ~20:10 UTC, for ec2.aws.a's design 03 (docs/ec2/2026-11-23__03-vault-cost-kill-switch.md, a8696af, section 3). Draft: [killswitch-role.yaml](killswitch-role.yaml), cfn-lint 1.61.0 clean; for cloudformation.aws.a to fold into the alarm stack, and for security.aws.a to review.

**ec2.aws.a's question: can the customer's own identity, running the alarm stack, create this role in both modes without widening the deploy role?** Yes. The alarm stack always runs with the customer's own identity (R-027), in one-stack and in least-privilege mode, and the deploy role's NeverAnotherStack denies it any CloudFormation action on `sws-vault-<id>-alarm`. Nothing is added to the deploy role. The one cost: in least-privilege mode, whoever adds the alarm stack needs rights to create an IAM role, so the kill switch is an administrator's opt-in there.

## The role, `sws-vault-<id>-killswitch`

- **Trust:** `lambda.amazonaws.com`, `aws:SourceAccount` = the account.
- **Lever 1:** cloudfront Get, GetDistributionConfig and UpdateDistribution on exactly the Vault's distribution (parameter DistributionId).
- **Lever 2:** lambda PutFunctionConcurrency and GetFunctionConcurrency on exactly `function:sws-vault-<id>-api` in the Vault's region (a cross-region call from us-east-1; parameter VaultRegion).
- **Its own logs.**
- **Denied:** DeleteFunctionConcurrency (that is restore, a person's act, section 4), every delete, function code or configuration changes, AddPermission, and every IAM, S3, Secrets Manager, EC2 and SSM action.

## What IAM cannot narrow (residuals, recorded)

1. **UpdateDistribution takes the whole configuration.** IAM cannot limit it to `Enabled: false`, so the role could change anything on that one distribution, its origin included. Held by the function's code: inline in the pinned template, it only flips Enabled, after checking the event (design 03 section 3). A change to the code is a template change, hashed and reviewed.
2. **PutFunctionConcurrency takes any value.** The code sets 0; a wrong value would raise or lower the cap on that one function only.

Both are bounded to one distribution and one function of one Vault, and the code is reviewable in the template. Neither reaches anything else in the account.

## For boto3.aws.a (ec2.aws.a's trigger question)

Whether a CloudWatch alarm can invoke a Lambda function directly as an alarm action, and which principal then appears in the function's resource policy (so the Permission can pin `aws:SourceArn` to the one alarm), decides whether the topic must exist whenever the kill switch is on.

**0.1.1 (20:20 UTC):** security.aws.a accepted 0.1.0 (trust, scope, denies; the UpdateDistribution residual as stated). Added for design 03 (8fd2c77), which marks both resources `sws-vault-paused=<time>` so a Vault stack update cannot silently undo a pause: cloudfront:TagResource on the one distribution and lambda:TagResource on the one function, each only with `aws:TagKeys` = `sws-vault-paused` (no other tag can be set). Untag is not granted: removing the mark is part of restoring, a person's act.

**Trigger, settled (boto3.aws.a note 17, a52fab3):** a CloudWatch alarm can invoke a Lambda function directly as an alarm action, so no SNS topic is needed for the kill switch. The function's resource policy (AWS::Lambda::Permission in the alarm stack): Action lambda:InvokeFunction, Principal `lambda.alarms.cloudwatch.amazonaws.com`, SourceAccount the account, SourceArn exactly `arn:aws:cloudwatch:us-east-1:<acct>:alarm:sws-vault-<id>-requests`, so nothing else can fire it. Invocation is asynchronous. ec2.aws.a has the role in design 03 (7252d01), its code doing only Enabled=false and concurrency 0 after its event checks.

**0.1.2 (20:30 UTC):** cloudfront:ListTagsForResource on the one distribution and lambda:ListTags on the one function (reads, for ec2.aws.a's tag-when-paused check), matching vault-alarm.yaml 0.3.1. Diffed against cloudformation.aws.a's KillSwitchRole: identical but for OwnLogs, which there points at the in-stack log group (equivalent).

**Second alarm (ec2.aws.a):** `sws-vault-<id>-requests-slow` also triggers the kill switch. So the function's resource policy needs one AWS::Lambda::Permission per alarm, each with SourceArn exactly that alarm's ARN (not a wildcard such as `sws-vault-<id>-requests*`, which would match any later alarm of that prefix), and the function's event check accepts exactly those two names. The role itself is unchanged.

**0.1.3 (20:45 UTC), matching vault-alarm.yaml 0.4.0 (after security.aws.a's code review):** the two tag reads are removed again (the code tags on every run); new ReportFailureToTheCostTopic, sns:Publish on exactly the cost topic, only when the email topic exists (parameter HasEmailTopic here, CostAlarmEmail there), for the function's on-failure destination. Checked: the topic policy already lets the kill switch role publish (KillSwitchReportsFailure) and still refuses everyone else. Diff: identical but for OwnLogs and the topic reference (Ref there, ARN here), both equivalent.
