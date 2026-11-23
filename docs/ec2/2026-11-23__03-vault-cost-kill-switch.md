# EC2 design 03: the Vault cost kill switch

Written by ec2.aws.a@SovereignWebsite.dinis, 23 November 2026 ~18:20 UTC. Status: **first draft, proposed, twin only**. Owner of the design: ec2.aws.a (conductor.aws.a, 18:01 UTC); iam.aws.a owns its narrow role, cloudformation.aws.a wires it into the templates. Nothing here runs outside the twin until Dinis has answered V5 and approved the automatic part as its own decision (section 7). No agent calls AWS.

## 0. Why, and the inputs

- **The cost of a flood** (billing.aws.a, docs/billing/flood.mjs on work/billing.aws.a, run here at a4fd7d8 or later, list prices, eu-west-2, before free tiers): through CloudFront every request is billed at the edge, whatever the Lambda behind it does. At 10,000 requests a second the stack as written costs about **45.89 to 46.65 USD an hour**, almost all of it CloudFront's request line (43.20). Reserved concurrency caps only the Lambda line (0.84). Only **time** limits the bill, so the switch has to act in minutes.
- **WAF does not help the bill:** a rate rule adds about 21.61 USD an hour at that rate (billing.aws.a, cfe70fb), so it is availability protection, off by default (cloudformation.aws.a's flood-guard note).
- **Budgets are too slow and cannot act on CloudFront:** cost data reaches Budgets up to three times a day, and a budget action can only apply an IAM policy or SCP or stop EC2 or RDS instances (boto3.aws.a's note 15, in cloudformation.aws.a's flood-guard note). A budget stays a slow, second signal.
- **The fast signal exists:** stack `sws-vault-<id>-alarm` in us-east-1 (docs/cloudformation/vault/vault-alarm.yaml, f75842a on work/cloudformation.aws.a). Alarm `sws-vault-<id>-requests`: CloudFront `Requests`, Sum over 300 s, threshold chosen by the customer; optional SNS topic `sws-vault-<id>-cost` that only this alarm may publish to. The customer runs it with their own console identity in **both** deploy modes, because the deploy role may never create alarms (security.aws.a, R-027). So the kill switch's per-Vault trigger is that stack's alarm in either mode.
- **A suggested threshold:** 45,000 requests in 5 minutes, about 1 USD an hour (billing.aws.a, b58bb8e).

## 1. The three levels, and how they fit the ones already designed

| Level | What it does | Undone by | Trigger | Where defined |
|---|---|---|---|---|
| **Pause one Vault** (this design) | stops the Vault serving: the function throttled to zero, then the distribution disabled | an explicit restore only (section 4) | the Vault's request alarm, or a click | here |
| **Stop new** | no new deployment starts | a plan Dinis approves | one click, or the monthly cap (V5 page, G6 (ii)) | design 01, 6b; V5 page G6, G7 |
| **End all** | deletes every managed deployment, DNS first | not undone | a plan Dinis approves | design 01, 6b; V5 page G7 |

Pausing **never deletes**: not the stack, not the bucket, not the token. It turns the meter off and leaves everything in place.

## 2. The two levers, in order

1. **Throttle the function:** set reserved concurrency of `sws-vault-<id>-api` to 0. Every invocation, through CloudFront or straight to the Function URL, is throttled at once. This stops the Lambda and log lines and closes the Function URL path, which skips CloudFront (flood.mjs: edge req/s 0). *Check* (boto3.aws.a): throttled invocations are not billed as invocations (flood.mjs already assumes it, marked to confirm).
2. **Disable the distribution:** `GetDistributionConfig`, set `Enabled: false`, `UpdateDistribution` with the `IfMatch` ETag. This is the lever that stops the CloudFront request line, the one that matters. *Check* (boto3.aws.a): that a disabled distribution stops serving and stops billing requests, and how long the change takes to reach the edge (CloudFront deployments take minutes; the twin uses a pack delay).

Lever 1 first because it is instant and cheap to undo; lever 2 because it is the one that stops the bill. Both run on every trigger; each is skipped if already in place, so a second trigger changes nothing.

## 3. Who pulls them: one small function beside the alarm

- **Where:** in the alarm stack `sws-vault-<id>-alarm`, us-east-1, so it is made by the customer's own identity like the alarm (R-027), and nothing new is asked of the deploy role in either mode.
- **What:** `sws-vault-<id>-killswitch`, a Lambda with its code inline in the template (short, reviewable, pinned by the template version; no package to fetch). It is custom code in the customer's account, which cloudformation.aws.a flagged; it is opt-in (section 7).
- **How it is triggered:** the alarm's action. Two ways, for boto3.aws.a to settle: (a) CloudWatch alarms can invoke a Lambda directly as an alarm action (*check*), which needs no topic; (b) through the topic `sws-vault-<id>-cost`, which then exists whenever the kill switch is on, not only with an email. Either way the function's resource policy allows invoke only from that one alarm (`aws:SourceArn`) or that one topic, so nothing else in the account can fire it.
- **What it may do** (for iam.aws.a's role, `sws-vault-<id>-killswitch`):
  - `cloudfront:GetDistributionConfig` and `cloudfront:UpdateDistribution` on the Vault's one distribution ARN;
  - `lambda:PutFunctionConcurrency` on `function:sws-vault-<id>-api` in the Vault's region (a cross-region call from us-east-1);
  - its own logs.
  - **Never:** any delete, `lambda:DeleteFunctionConcurrency` (that is restore), any IAM, S3 or Secrets Manager action.
- **What it checks before acting:** the alarm named in the event is `sws-vault-<id>-requests` and its state is ALARM; the distribution's id matches the one the stack was given. Anything else: log and do nothing.
- **What it records:** one log line per lever with the alarm's time and the before and after state, so plan step 9's audit view (cloudtrail.aws.a) can show "paused by the cost alarm at T". CloudTrail records the two API calls with the function's role as the actor.

## 4. Restoring: deliberate, never automatic

- The alarm going back to OK does **not** restore. A flood that pauses for five minutes would otherwise toggle the Vault on and off, and every toggle is a CloudFront deployment.
- Restore is two calls, the levers reversed: delete the function's reserved-concurrency setting (back to the template's value through a stack update, not by hand), and re-enable the distribution. On the deploy page (no credential in the customer's account, D3) it is a link: a pre-filled stack update, or the console page of the distribution (cloudformation.aws.a's option (c)).
- For our own deployments, restore is a plan Dinis approves.

## 5. Our own deployments (EC2 path and ephemeral)

- The same switch fits the EC2 variant of the Vault (design 01, section 5): CloudFront still bills every request, so lever 2 is the same; lever 1 becomes "stop the instance" instead of "throttle the function" (`ec2:StopInstances` on the instance tagged `sws:managed=true`, design 01 4.3). The instance's own cost is already bounded by its type and lifetime (V5 page G1, G2, G4).
- For a deployment on a schedule (ephemeral or the daily move), a pause also tells the scheduler to start no replacement for that Vault until Dinis clears it, so a flood cannot make the daily move create copy after copy.

## 6. The twin

Built on what the twin has: the CloudWatch twin (monitoring host, work/dev.2.aws.a.cfn-journal, now in work/dev.1.aws.a), the clock (a7d93d2), the journal, and the customer-account world of deploy step 4.

- **A flood pack:** visitor generators at a set rate, clock-driven, so the distribution's `Requests` metric rises.
- **The alarm in the twin:** evaluates on the clock every 300 s of twin time; on breach records `cloudwatch.setAlarmState` (actor `aws:cloudwatch`), then the action.
- **The function in the twin:** records `lambda.putFunctionConcurrency` and `cloudfront.updateDistribution` with actor `role:sws-vault-<id>-killswitch`, why `alarm.sws-vault-<id>-requests`.
- **Tests** (for the twin's builder, dev.1.aws.a):
  1. A flood above the threshold: within one evaluation period plus the pack's propagation delay, the function's concurrency is 0 and the distribution is disabled; the twin's cost meter (billing.aws.a's model fed by the twin's counts) stops growing.
  2. A flood below the threshold: nothing happens.
  3. Twice: a second alarm changes nothing and records no new write.
  4. The alarm returns to OK: nothing is restored.
  5. Nothing is deleted: the stack, bucket, secret and function all remain.
  6. A publish to the topic from anything but the alarm, or an invoke from anything but the alarm or topic, is refused and recorded as refused.
  7. Restore by the explicit two calls brings the Vault back; `/health` answers again.
  8. Same history however it is read (design 01, 2h.9): the journal of a flood run with one big `tick` equals the one with reads in between.

## 7. Decisions this raises (for pm.aws.a, after V5)

- **K1. Offer the automatic pause at all?** (a) no: the alarm only emails, the customer pauses by the page's link; (b) yes, opt-in per Vault (a parameter of the alarm stack, default off); (c) yes, on by default. Recommended **(b)**: a flood then costs at most about one evaluation period plus propagation, and the customer chooses cost over availability knowingly. The trade-off to say plainly: anyone who can send enough requests can switch a Vault off. That is a denial of service the customer accepts in exchange for a bounded bill.
- **K2. Which levers?** (a) throttle only; (b) throttle and disable the distribution. Recommended **(b)**: throttling alone leaves CloudFront's request line, which is about 94% of the flood's cost (43.20 of 45.89 USD an hour).
- **K3. The suggested threshold:** billing.aws.a's 45,000 requests in 5 minutes (about 1 USD an hour), or another the customer types. Recommended: suggest billing.aws.a's figure, the customer decides.
- **K4. Our own Vaults and deployments:** the same switch, on, as part of V5's guard rails. Recommended yes, with restore as a plan Dinis approves.

## 8. Asks

- **boto3.aws.a:** the *checks* of sections 2 and 3: throttled invocations unbilled; a disabled distribution stops serving and billing, and how long it takes; alarm actions invoking Lambda directly; `UpdateDistribution` needing the full config and `IfMatch`; a us-east-1 function calling `PutFunctionConcurrency` in another region.
- **iam.aws.a:** the `sws-vault-<id>-killswitch` role (section 3), and whether the customer's own identity running the alarm stack can create it in both deploy modes without widening the deploy role.
- **cloudformation.aws.a:** the function, its role and its invoke permission in `vault-alarm.yaml`, behind a `KillSwitch` parameter (off, or throttle-and-disable), default off; the topic when the switch is on.
- **security.aws.a:** sections 3, 4 and 7 (the denial-of-service trade-off, who can fire the function, no restore on OK).
- **billing.aws.a:** the cost of a flood with the switch on: one evaluation period plus propagation, at the suggested threshold and at 10,000 requests a second.
- **dev.1.aws.a:** section 6, after deploy step 4 and the EC2 twin.
- **dev.2.aws.a and ux.aws.a:** the page's "Pause this Vault" and "Restore" links, and the plain statement of K1's trade-off.
