# Review: EC2 design 03, the Vault cost kill switch (ec2.aws.a a8696af)

security.aws.a@SovereignWebsite.dinis, fresh session, 23 Nov 2026 ~19:50 UTC. Design review only, twin only. It covers sections 3, 4 and 7, as asked, and builds on R-026 and R-027.

Verdict: sound, and fit for pm.aws.a's batch once the points below are in. Pausing never deletes, there is no automatic restore, and it lives in the alarm stack under the customer's identity. That keeps the deploy role untouched (R-027).

## Section 3: who can fire it, and what it may do

1. **Invoke permission.** If the alarm invokes the function directly, the only AddPermission is for principal `lambda.alarms.cloudwatch.amazonaws.com`, with SourceArn = the alarm's ARN and SourceAccount = the account. If it goes through SNS, the principal is `sns.amazonaws.com` with SourceArn = the topic, and the topic policy already lets only that alarm publish. There is no Function URL, no other trigger and no event source mapping. Test 6 should cover each refusal.
2. **The role.** It trusts `lambda.amazonaws.com` with aws:SourceAccount only. The inline policy is exactly the three rights listed plus its own log group. It has no managed-policy attach and holds no secret in its environment. Its reserved concurrency is 1, so a storm of alarms cannot fan out.
3. **A residual to state plainly.** IAM cannot limit UpdateDistribution to the Enabled field. The role could change any part of the one distribution, such as origins or behaviours, if its code were changed. The code is inline and pinned with the template's hash, so that is the guard, as everywhere else. Keep the function short: under 60 lines, no dependencies, no network call except the two AWS APIs.
4. **What it checks** is right: the alarm name and the ALARM state. The distribution id comes from the stack's own parameter, never from the event. An unexpected event is logged and does nothing.
5. **Tell the customer.** Each pause sends one email through the cost topic ("Vault <id> paused by the cost alarm at T; to restore, ..."), so a pause is never silent.

## Section 4: no restore on OK

Agreed. An automatic restore would let a flood toggle the Vault on and off, and each toggle is a CloudFront deployment.

**One accidental restore path to close.** The Vault stack's template sets ReservedConcurrency (10) and the distribution's Enabled = true. Any later update of the Vault stack therefore puts both back, silently undoing a pause, for example an image bump. So:
- the kill switch tags the distribution and the function `sws-vault-paused = <time>`;
- the page, and the update path in design 06 (change set only), refuses or warns on an update while that tag is present;
- restore is the explicit two calls and then removing the tag.
Test 7 should include "a Vault stack update during a pause does not restore it without the explicit step".

## Section 7, K1: the denial-of-service trade-off

With the switch on, anyone who can send more requests than the threshold can pause the Vault, cheap /health requests included. That is a deliberate trade: cost over availability. Because there is no automatic restore, the attacker gets one pause, not a loop.

Recommendation: **(b), opt-in per Vault, default off**, as the design says. The page states the trade in one sentence beside the switch: "With this on, a flood pauses your Vault until you restore it, so you are not billed for it." For our own Vaults (K4): on, with restore as a plan Dinis approves.

K2 (b), both levers: agreed, because throttling alone leaves about 94% of the cost. K3: agreed.

## Asks
- cloudformation.aws.a: points 1 and 2 in vault-alarm.yaml behind KillSwitch (default off); the pause tag; the email.
- iam.aws.a: the role exactly as point 2.
- dev.2.aws.a and ux.aws.a: the trade-off sentence; the paused-tag check on updates; Restore as the explicit two steps.
- dev.1.aws.a: tests 6 and 7 as extended above.
