# Review: vault-alarm.yaml 0.2.0, the kill switch as code

Reviewer: security.aws.a@SovereignWebsite.dinis, 23 Nov 2026. A review of the code only, with no AWS calls.
Subject: cloudformation.aws.a ade3a5d on work/cloudformation.aws.a (vault-alarm.yaml, test_killswitch.py, note vault-killswitch-01).
Method:
- Signature verified against cloudformation.aws.a's bundle on dev.
- test_killswitch.py and test_vault_template.py both pass here, and cfn-lint is clean.
- I read the code myself, and an adversarial sub-agent read it separately.

Verdict: **not yet accepted.** The design is right and the IAM matches iam.aws.a's role 0.1.1. Four changes are needed before the twin build: S1, S2, S3 and S4 below.

## Must change

- **S1 (High): one failed lever stops both, and the failure is silent.**
  - The throttle runs first and its errors are not caught. If `VaultRegion` is wrong, the `-api` function is missing or the throttle call fails, `UpdateDistribution` never runs. Disabling the distribution is the lever that stops CloudFront billing.
  - CloudWatch invokes the function asynchronously. Lambda retries twice, then drops the event.
  - An alarm acts only when its state changes, so a failed pause is never tried again while the flood lasts.
  - Fix:
    - Disable the distribution first.
    - Run each lever in its own try, and raise at the end if either failed.
    - Add an `AWS::Lambda::EventInvokeConfig` with an on-failure destination: the cost topic when there is one.
    - Add an alarm on the switch's own `Errors` that emails the customer.
- **S2 (High, deploy): `ReservedConcurrentExecutions: 1` can make the stack fail.**
  - New accounts often have a total concurrency of 10, and Lambda refuses a reservation that takes unreserved concurrency below 10.
  - The Vault's customers are likely to have new accounts.
  - The reservation adds no safety, because the actions are idempotent. Fix: remove it, and change the template test to match.
- **S3 (Medium): a pause can be left without its tag.**
  - The code tags only when it has just written. If the write succeeds and `TagResource` then fails, the retry finds the Vault already paused and skips the tag.
  - The restore steps and the page's stack-update guard both depend on that tag.
  - Fix: write both `sws-vault-paused` tags on every run that acts on ALARM, whatever state it finds. The tag-key-limited TagResource right already allows this.
- **S4 (Medium): an ETag race is not handled.** A Vault stack update at the same moment gives `PreconditionFailed` and falls into S1's silent path. Fix: re-read the config and retry up to 3 times within the handler.

## Should change

- **S5 (Low):** line 240 builds `arn:aws:cloudfront::...` by hand. Pass the distribution ARN in an environment variable built with `${AWS::Partition}`, as the role already does.
- **S6 (Low):**
  - Anyone in the account with `cloudwatch:SetAlarmState` can set the alarm to ALARM and so fire the switch, whatever `KillSwitchPermission` says.
  - Anyone with `lambda:InvokeFunction` on `*` can invoke it directly with a made-up event. Same-account identity policies do not need the resource policy.
  - Both are inside the customer's account. State them next to the K1 trade-off; no code change.
- **S7 (Nit):** give `CostAlarm` a `DependsOn` on `KillSwitchPermission`, so the alarm cannot fire before it may invoke the switch.
- **S8 (twin CHECK):** confirm in the twin that Lambda's assumption of the execution role satisfies the trust policy's `aws:SourceAccount` condition. The sub-agent was not sure, and nor am I. If it fails, the function cannot be created.

## Confirmed

- The event fields `alarmData.alarmName` and `alarmData.state.value` match the CloudWatch event documented for Lambda alarm actions. The other top-level fields are `source`, `alarmArn` and `time`. A different shape fails safe.
- The permission names only `lambda.alarms.cloudwatch.amazonaws.com`, with SourceAccount and the alarm's SourceArn.
- The role:
  - its TagResource rights are limited to the key `sws-vault-paused`, with no Untag;
  - the explicit Deny covers delete and restore;
  - its log rights are on the log group's ARN, which ends in `:*`.
- The `UpdateDistribution` over-grant is the residual already documented (iam.aws.a).
- It is off by default and needs `VaultRegion` (Rule). It runs in us-east-1 only (Rule) and under the customer's own identity (R-027).

## Missing

- The second alarm, `sws-vault-<id>-requests-slow`: Period 21600, Sum, its own threshold parameter.
  - When it is added, the function must accept exactly the two names.
  - The topic policy and `KillSwitchPermission` must name both alarm ARNs.
- Tests to add:
  - the throttle raises, and the distribution is still disabled;
  - `PreconditionFailed` once, then success;
  - the tag fails after the write, then a rerun tags;
  - an assertion on the region of the Lambda client: `lam_region` is computed but never checked.

R-026 stays Medium and open. This review does not change Dinis's K1 to K4.
