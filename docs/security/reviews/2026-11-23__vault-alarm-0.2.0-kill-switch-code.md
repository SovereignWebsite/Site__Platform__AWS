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

## Follow-up: 0.3.0 (ef0a1a0) and 0.3.1 (133e4dc), 20:50 UTC

Both signatures verified, both tests pass, cfn-lint is clean.

- **The slow alarm is accepted.** `sws-vault-<id>-requests-slow` is a Sum over 21600 s with its own `SlowRequestThreshold` (0 means off).
  - It has the same AlarmActions as the fast alarm, and neither alarm has OK or insufficient-data actions.
  - The topic policy's Allow and Deny both name exactly the two alarm ARNs. With a list, ArnNotEquals denies any ARN that matches neither.
  - The second invoke permission is for the slow alarm's SourceArn only.
  - The function accepts exactly the two names, and the test rejects look-alikes.
- **S3 is closed:** the code tags whenever the end state is paused and the tag is missing. The new ListTags and ListTagsForResource rights are read-only and on the one function and the one distribution.
- **S5 is closed:** `DISTRIBUTION_ARN` is built with `${AWS::Partition}`.
- **Still open:** S1 (levers ordered and isolated, failure destination, errors alarm), S2 (`ReservedConcurrentExecutions: 1` is still at line 242), S4, S7, S8 and the extra tests. Not yet accepted until S1 and S2 land.

## Follow-up: 0.4.0 (d3af4de), 21:00 UTC: accepted for the twin

The signature is verified, both tests pass (test_killswitch.py now has every case I asked for), and cfn-lint is clean.

- **S1 is closed.**
  - The distribution is disabled first, each lever has its own try, and the handler raises at the end.
  - `EventInvokeConfig` allows 2 retries, then sends the failure to the cost topic. The destination publishes with the execution role, which has `sns:Publish` on that topic only, and only when there is an email.
  - `sws-vault-<id>-killswitch-errors` only notifies.
  - The topic policy is checked. Its Deny has two keys in one block, so both must hold:
    - SourceArn is none of the three alarms (a missing key counts as not equal);
    - PrincipalArn is not the switch's role.
  - So a publish from the alarms or from the role is allowed, and anything else in the account is denied.
- **S2 is closed:** there is no reservation, and the test asserts it. Two alarms at once are safe, because both levers are idempotent and the ETag retry covers the race.
- **S3 is closed:** both tags are written on every ALARM run, so the List rights are gone and the role is smaller again.
- **S4 is closed:** PreconditionFailed is retried, 3 attempts in all, then raised into S1's path.
- **S7 is accepted as a residual:**
  - The window is the few seconds between the alarm and its permission being created.
  - The first possible ALARM comes at least 300 s after creation, and a missed invoke still emails the customer.
  - No split per mode.
- **S6** goes beside K1 on the page. **S8** is for dev.1.aws.a's twin.

**Verdict: the kill switch code is accepted for the twin.** Whether it is offered at all is still Dinis's (K1 to K4). R-026 stays Medium and open until then.
