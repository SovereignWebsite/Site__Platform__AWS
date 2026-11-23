# EC2 design 03: the Vault cost kill switch

Written by ec2.aws.a@SovereignWebsite.dinis, 23 November 2026 ~18:20 UTC. Status: **reviewed by security.aws.a** (docs/security/reviews/2026-11-23__ec2-design-03-kill-switch.md on work/security.aws.a: sound, fit for pm.aws.a with its points, all folded in below), **twin only**. Owner of the design: ec2.aws.a (conductor.aws.a, 18:01 UTC); iam.aws.a owns its narrow role, cloudformation.aws.a wires it into the templates. Nothing here runs outside the twin until Dinis has answered V5 and approved the automatic part as its own decision (section 7). No agent calls AWS.

## 0. Why, and the inputs

- **The cost of a flood** (billing.aws.a, docs/billing/flood.mjs on work/billing.aws.a, run here at a4fd7d8 or later, list prices, eu-west-2, before free tiers): through CloudFront every request is billed at the edge, whatever the Lambda behind it does. At 10,000 requests a second the stack as written costs about **45.89 to 46.65 USD an hour**, almost all of it CloudFront's request line (43.20). Reserved concurrency caps only the Lambda line (0.84). Only **time** limits the bill, so the switch has to act in minutes.
- **WAF does not help the bill:** a rate rule adds about 21.61 USD an hour at that rate (billing.aws.a, cfe70fb), so it is availability protection, off by default (cloudformation.aws.a's flood-guard note).
- **Budgets are too slow and cannot act on CloudFront:** cost data reaches Budgets up to three times a day, and a budget action can only apply an IAM policy or SCP or stop EC2 or RDS instances (boto3.aws.a's note 15, in cloudformation.aws.a's flood-guard note). A budget stays a slow, second signal.
- **The fast signal exists:** stack `sws-vault-<id>-alarm` in us-east-1 (docs/cloudformation/vault/vault-alarm.yaml, f75842a on work/cloudformation.aws.a). Alarm `sws-vault-<id>-requests`: CloudFront `Requests`, Sum over 300 s, threshold chosen by the customer; optional SNS topic `sws-vault-<id>-cost` that only this alarm may publish to. The customer runs it with their own console identity in **both** deploy modes, because the deploy role may never create alarms (security.aws.a, R-027). So the kill switch's per-Vault trigger is that stack's alarm in either mode.
- **A suggested threshold:** 45,000 requests in 5 minutes, about 1 USD an hour (billing.aws.a, b58bb8e).
- **What a flood costs with the switch on** (billing.aws.a, docs/billing/killswitch.mjs on land/billing.aws.a 27911d0; stack as written, a 401 per request, eu-west-2 list prices, before free tiers; billed until the edge stops serving, so one or two 5-minute periods plus the propagation time P):
  - at 10,000 requests a second: 3.82 to 7.65 USD if P is 5 minutes, 11.47 to 15.30 if 15, 22.95 to 26.77 if 30;
  - just over the threshold (151 a second): 0.17 to 0.68 USD;
  - **the gap:** just under it (149 a second) the 5-minute alarm never trips: 1.01 USD an hour, 24.31 a day, about 729 in 30 days. Hence the second, slow alarm (section 3).
  - Not measured: P, and whether a disabled distribution stops billing requests (boto3.aws.a, note 17: implied, not stated). billing.aws.a recomputes when they are known.

## 1. The three levels, and how they fit the ones already designed

| Level | What it does | Undone by | Trigger | Where defined |
|---|---|---|---|---|
| **Pause one Vault** (this design) | stops the Vault serving: the distribution disabled, then the function throttled to zero | an explicit restore only (section 4) | the Vault's request alarm, or a click | here |
| **Stop new** | no new deployment starts | a plan Dinis approves | one click, or the monthly cap (V5 page, G6 (ii)) | design 01, 6b; V5 page G6, G7 |
| **End all** | deletes every managed deployment, DNS first | not undone | a plan Dinis approves | design 01, 6b; V5 page G7 |

Pausing **never deletes**: not the stack, not the bucket, not the token. It turns the meter off and leaves everything in place.

## 2. The two levers, in order

1. **Disable the distribution:** `GetDistributionConfig`, set `Enabled: false`, `UpdateDistribution` with the `IfMatch` ETag. This is the lever that stops the CloudFront request line, the one that matters. boto3.aws.a (note 17): once disabled, "CloudFront stops accepting traffic for that domain name", and the change "might take a few minutes" to reach every edge location; that billing stops is implied, not stated. `UpdateDistribution` is confirmed to need the whole config ("not merged"): `GetDistributionConfig`, keep the ETag for `IfMatch`, send the config back with only `Enabled` changed and `CallerReference` untouched. The twin uses a pack delay of a few minutes.
2. **Throttle the function:** set reserved concurrency of `sws-vault-<id>-api` to 0. Every invocation, through CloudFront or straight to the Function URL, is throttled at once. This stops the Lambda and log lines and closes the Function URL path, which skips CloudFront (flood.mjs: edge req/s 0). Reserved concurrency 0 throttles every invocation (boto3.aws.a, note 17, confirmed). Whether throttled calls are billed as requests is **not stated** on Lambda's pricing page (note 17), so this design does not lean on lever 1 for cost: its job is to stop the function's duration and logs and close the Function URL path; lever 2 is the cost lever.

**Order, after security.aws.a's code review (vault-alarm.yaml 0.4.0, cloudformation.aws.a):** disable the distribution first, because it is the lever that stops the bill; then throttle the function. Each lever runs on its own, so a failure of one does not stop the other; a failure is raised, so Lambda retries the asynchronous invocation twice, then sends it on failure to the cost topic (the customer's email). Lever writes happen once (each skipped if already in place); both `sws-vault-paused` tags are written on every ALARM run, so a pause made by hand is tagged too. A third alarm, `sws-vault-<id>-killswitch-errors`, watches the switch's own errors.

## 3. Who pulls them: one small function beside the alarm

- **Where:** in the alarm stack `sws-vault-<id>-alarm`, us-east-1, so it is made by the customer's own identity like the alarm (R-027), and nothing new is asked of the deploy role in either mode.
- **What:** `sws-vault-<id>-killswitch`, a Lambda with its code inline in the template (short, reviewable, pinned by the template version; no package to fetch; inline code is limited to about 4 KB, cloudformation.aws.a). It takes `VaultRegion` (the cross-region `PutFunctionConcurrency` call from us-east-1) and the `DistributionId` the alarm stack already has. It is custom code in the customer's account, which cloudformation.aws.a flagged; it is opt-in (section 7).
- **Two alarms, both in the alarm stack** (conductor.aws.a, security.aws.a, after billing.aws.a's gap): the fast `sws-vault-<id>-requests` (Sum over 300 s) and a slow `sws-vault-<id>-requests-slow` (Sum over 6 hours, recommended in K3 over 1 day; named by security.aws.a; cloudformation.aws.a to draft; boto3.aws.a, note 17 addendum: a period of 86400 s is valid and Period x EvaluationPeriods may reach 7 days, so 6 hours is a choice, not a limit: a whole-day period can fire up to a day late). The slow one bounds a flood held just under the fast threshold. The function accepts an event from **either alarm by exact name, and nothing else** (security.aws.a).
- **How it is triggered:** each alarm's action. Two ways: (a) the alarm invokes the function directly (confirmed by boto3.aws.a, note 17: `AlarmActions` takes a Lambda ARN; asynchronous; the function's resource policy names `lambda.alarms.cloudwatch.amazonaws.com` with the source account and the two alarms' ARNs), which needs no topic; **recommended now**; (b) through the topic `sws-vault-<id>-cost`, which then exists whenever the kill switch is on, not only with an email. With (a) confirmed, the topic is only for the customer's email. Either way the function's resource policy allows invoke only by the principal `lambda.alarms.cloudwatch.amazonaws.com` with `aws:SourceArn` = the alarm's ARN, or `sns.amazonaws.com` with `aws:SourceArn` = the topic's ARN, so nothing else in the account can fire it. It has no reserved concurrency (dropped in 0.4.0: new accounts have little spare concurrency); a second run at the same time finds the levers already in place and only rewrites the tags.
- **What it may do** (iam.aws.a's role, drafted: docs/iam/vault-deploy/killswitch-role.yaml and 05-killswitch-role.md on work/iam.aws.a, `sws-vault-<id>-killswitch`, trusting `lambda.amazonaws.com` with `aws:SourceAccount` = the customer's account; made by the customer's own identity in the alarm stack in both modes, nothing added to the deploy role; in least-privilege mode the person running the alarm stack needs rights to create IAM roles, so there it is an administrator's opt-in):
  - `cloudfront:GetDistribution`, `GetDistributionConfig` and `UpdateDistribution` on exactly `distribution/<DistributionId>`;
  - `lambda:PutFunctionConcurrency` and `GetFunctionConcurrency` on exactly `function:sws-vault-<id>-api` in `VaultRegion` (the client's region set to the target, boto3.aws.a confirmed);
  - `cloudfront:TagResource` on that distribution and `lambda:TagResource` on that function, only with `aws:TagKeys` = `sws-vault-paused`, and no Untag (iam.aws.a, killswitch-role 0.1.1, 9e565fd; accepted by security.aws.a);
  - its own logs.
  - Nothing else: exactly these rights.
  - **Denied explicitly:** `lambda:DeleteFunctionConcurrency` (restore is a person's act), any delete, code or configuration change, `AddPermission`, and every IAM, S3, Secrets Manager, EC2 and SSM action.
- **The code is the guard:** IAM cannot limit `UpdateDistribution` to the `Enabled` field (the role could change that one distribution's origin) nor `PutFunctionConcurrency` to the value 0 (iam.aws.a's residuals). So the inline code is pinned by the template version, kept tiny (after the event checks: read the config, set `Enabled: false`, write it back with `IfMatch`; set concurrency 0; tag both; nothing else), and reviewed as security-relevant (security.aws.a).
- **What it checks before acting:** the alarm named in the event is exactly `sws-vault-<id>-requests` or `sws-vault-<id>-requests-slow` and its state is ALARM; the distribution's id matches the one the stack was given. Anything else: log and do nothing.
- **It tells the customer:** each pause sends an email through the topic `sws-vault-<id>-cost` (when the customer gave an address), saying which Vault, when, which levers, and how to restore (security.aws.a).
- **What it records:** one log line per lever with the alarm's time and the before and after state, so plan step 9's audit view (cloudtrail.aws.a) can show "paused by the cost alarm at T". CloudTrail records the two API calls with the function's role as the actor.

## 4. Restoring: deliberate, never automatic

- The alarm going back to OK does **not** restore. A flood that pauses for five minutes would otherwise toggle the Vault on and off, and every toggle is a CloudFront deployment.
- **A pause and a later stack update** (security.aws.a, cloudformation.aws.a): CloudFormation sends only properties whose template value changes, so the pause is drift outside the stack. An update that leaves concurrency and `Enabled` alone keeps the pause, but any update that touches the function or the distribution resends the template's reserved concurrency 10 or `Enabled: true` and would quietly un-pause the Vault. So the function tags the function and the distribution `sws-vault-paused=<ISO time>` when it pauses, and the update path (the deploy page's update link, and our own plans) checks for the tag and refuses, or warns that the update re-enables the Vault and asks for an explicit "restore and update", while it is there. This is cloudformation.aws.a's option (b), with the tag as the check. Its option (a), a `Paused` parameter in vault.yaml so pause and restore are real stack updates, stays for later if customers ask: clean for drift, but slower and not automatic.
- **Restore is the two explicit calls, never a plain stack update** (cloudformation.aws.a: an update that does not change the template's values does not reset drift): put the function's reserved concurrency back to the template's value (`PutFunctionConcurrency` 10), re-enable the distribution, and remove the two `sws-vault-paused` tags. On the deploy page (no credential in the customer's account, D3) these are console links the customer follows (the function's concurrency page and the distribution's page), with the steps written out.
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
  1. A flood above the threshold: within one evaluation period plus the pack's propagation delay, the distribution is disabled first and then the function's concurrency is 0 (the journal shows that order); the twin's cost meter (billing.aws.a's model fed by the twin's counts) stops growing.
  2. A flood below the threshold: nothing happens.
  3. Twice: a second alarm makes no lever write (only the tags are rewritten).
  4. The alarm returns to OK: nothing is restored.
  5. Nothing is deleted: the stack, bucket, secret and function all remain.
  6. A publish to the topic from anything but the alarm, or an invoke from anything but the alarm or topic, is refused and recorded as refused.
  7. Restore by the explicit calls (concurrency back to 10, distribution enabled, tags removed) brings the Vault back; a plain stack update with unchanged values does not restore it; removes the `sws-vault-paused` tags, and `/health` answers again. A stack update while the tags are there is refused (or warns and needs "restore and update"); it never silently re-enables the Vault.
  9. The pause sends one email through the topic per pause, none on a second alarm.
  10. A flood held just under the fast threshold for a twin day trips the slow alarm, and the switch pauses; an event naming any other alarm is ignored and logged.
  11. If disabling the distribution fails, the throttle still happens; the run is retried twice, then reaches the cost topic, and `sws-vault-<id>-killswitch-errors` goes to ALARM. If throttling fails, the distribution is still disabled.
  12. A pause made by hand (levers already in place) gets both tags on the next ALARM run, with no lever write.
  8. Same history however it is read (design 01, 2h.9): the journal of a flood run with one big `tick` equals the one with reads in between.

## 7. Decisions this raises (for pm.aws.a, after V5)

- **K1. Offer the automatic pause at all?** (a) no: the alarm only emails, the customer pauses by the page's link; (b) yes, opt-in per Vault (a parameter of the alarm stack, default off); (c) yes, on by default. Recommended **(b)**, agreed by security.aws.a: a flood then costs at most about one evaluation period plus propagation, and the customer chooses cost over availability knowingly. It is one pause per flood, not a loop (no restore on OK). The page says the trade-off in one sentence. The trade-off to say plainly: anyone who can send enough requests can switch a Vault off. That is a denial of service the customer accepts in exchange for a bounded bill.
- **K2. Which levers?** (security.aws.a agrees with K2 b, K3 and K4.) (a) throttle only; (b) throttle and disable the distribution. Recommended **(b)**: throttling alone leaves CloudFront's request line, which is about 94% of the flood's cost (43.20 of 45.89 USD an hour).
- **K3. The suggested thresholds, two of them:** the fast one, billing.aws.a's 45,000 requests in 5 minutes (about 1 USD an hour); and the slow one, billing.aws.a's **44,121 requests in 6 hours**, worked back from a budget of 10 USD a month (killswitch.mjs, land/billing.aws.a 7621a65; the formula takes any monthly figure the customer prefers). With it, a flood held under both thresholds costs at most about 10 USD a month; one just over the slow threshold costs up to 12.41 USD before the switch acts with a 6-hour period, or 48.88 USD with a 24-hour one (caught within two slow periods plus 15 minutes' propagation, billing.aws.a's assumption). The same 10 USD a month is 176,486 requests a day or 44,121 per 6 hours. Without the slow alarm, a flood held just under the fast threshold costs about 24 USD a day. Recommended: both alarms, the slow one over **6 hours** (it bounds the just-over case four times tighter than a day), billing.aws.a's figures suggested, the customer decides.
- **K4. Our own Vaults and deployments:** the same switch, on, as part of V5's guard rails. Recommended yes, with restore as a plan Dinis approves.

## 8. Asks

- **boto3.aws.a:** answered (docs/boto3/2026-11-23__17-cost-kill-switch.md): (3), (4) and (5) confirmed, (2) partly, (1) not stated. Still open: whether throttled calls and requests to a disabled distribution are billed; only AWS's own answer or a bill settles it.
- **iam.aws.a:** role drafted (killswitch-role.yaml); one addition asked: `cloudfront:TagResource` and `lambda:TagResource` on the same one distribution and function, for the `sws-vault-paused` tag (section 4; security.aws.a agreed the tag carries no access).
- **cloudformation.aws.a** (read a8696af; iam.aws.a's role is ready, 0.1.1): the slow alarm `sws-vault-<id>-requests-slow` (security.aws.a asked it too), the direct alarm actions on both alarms, the function, its role and its invoke permission in `vault-alarm.yaml`, behind a `KillSwitch` parameter (off, or throttle-and-disable), default off; the topic when the switch is on; the Vault stack's update path checking the `sws-vault-paused` tag (section 4).
- **security.aws.a:** reviewed, folded in.
- **billing.aws.a:** answered (killswitch.mjs, 27911d0); and the slow alarm's figures (7621a65), in K3.
- **dev.1.aws.a:** section 6, after deploy step 4 and the EC2 twin.
- **dev.2.aws.a and ux.aws.a:** the page's "Pause this Vault" and "Restore" links, and the plain statement of K1's trade-off.
