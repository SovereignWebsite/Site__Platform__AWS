# Review: EC2 V5 guard rails decision draft (ec2.aws.a 21ed4a1)

security.aws.a@SovereignWebsite.dinis, fresh session, 23 Nov 2026 ~17:50 UTC. This is a design review only (Vault deploy plan step 11), with no AWS call. It builds on docs/security/reviews/2026-11-23__ec2-design-01.md (ff92c75). Verdict: **fit to go to Dinis**, with the additions below written into the rows. Each addition narrows a row or makes it testable; none changes a recommended option.

| Row | Position | Addition |
|---|---|---|
| G1 | Agree: a default of 2 h with a hard cap of 4 h | The lifetime tag is set only at launch, and no role can change it afterwards (design 01's rule: no tag rights after create). So overrunning the cap needs a new deployment, not an edit. |
| G2 | Agree (a), 26 h | Same tag rule. The sweeper treats a daily-move copy past 26 h as a failed move: it alerts first, and deletes the copy only once its replacement answers. If there is no replacement, it alerts and stops; it never leaves zero copies on its own judgement. |
| G3 | Agree (a) | `aws:RequestedRegion` must apply to the regional actions only. IAM, CloudFront and Route 53 calls are signed for us-east-1, so a blanket condition either breaks them or forces us-east-1 onto the list. Scope the condition per statement. |
| G4 | Agree (a) | The template check (standard credits, allowed types) runs in the test suite and again in the plan read-back before Dinis approves. |
| G5 | Agree (a) | The vCPU quota is account-wide, so it also caps any other EC2 use in that account. Say so on the quota plan. |
| G6 | Agree (a), USD 25 alert | Offer Dinis an option (b): a Budgets action at 100% that attaches a Deny on creating `sws-ec2-*` stacks to the scheduler and move roles. That is an automatic "stop new" that deletes nothing and is undone by detaching the policy. Notify-only stays the recommended option. |
| G7 | Agree (a) | "End all" deletes the DNS records of the managed deployments first, then the stacks, so no name is left pointing at a released address. |
| G8 | Agree (a) | The sweeper's role may only describe, alert, and DeleteStack on stacks that are both named `sws-ec2-*` and tagged as managed. It has no create or update rights and no iam:*. Lock 1's per-deployment schedule role may delete its one stack by ARN, and itself, and nothing else. |
| G9 | Agree (b) then (a) | When (a) comes, the move's role: creates only `sws-ec2-*` stacks in G3's regions, one per run; copies from the old copy's bucket to the new copy's only; holds no kms:Decrypt (vault objects are encrypted on the client, so no key is needed to copy them); and changes only the one record name of that deployment. The order is fixed: the new copy answers, then the DNS record moves to it, then the old copy is deleted. The record never points at a deleted target. "A week in the twin" means a week of daily moves with the clock (a7d93d2), each checked by the CloudTrail rules of step 9. |

Things the page should state plainly to Dinis:
- Every number is a list price before EBS, CloudFront, S3, logs and transfer, so the cost lines are lower bounds.
- Approving the page creates nothing. Each real change (service role, scheduler, sweeper, budget, quota) comes back as its own plan.
