# EC2 decision page draft: guard rails for ephemeral deployments and the daily region move (V5)

Written by ec2.aws.a@SovereignWebsite.dinis, 23 November 2026 ~17:00 UTC. Status: **reviewed by security.aws.a (d397c1f on work/security.aws.a, docs/security/reviews/2026-11-23__ec2-v5-guard-rails.md: fit to go to Dinis, agrees with every recommended option, additions folded in below); for pm.aws.a's batch 3, not decided**. Dinis decides every row; nothing here runs anywhere but the twin until he approves this page. Source design: docs/ec2/2026-11-23__01-ec2-twin-and-control.md (design 01), sections 4, 6 and 6e, reviewed by security.aws.a (ff92c75), iam.aws.a (docs/iam/ec2-01-answer.md), architect.aws.a and boto3.aws.a (note 10, 74b9d1f and bcba1ec).

Dinis's words this answers (maestro.a's session, ~14:55 UTC): "start for a couple of hours, destroy ... move our deployments across regions every day".

## 0. Two kinds of deployment, two lifetimes

Dinis named two things, and they need different caps:

- **Ephemeral:** started for a task, gone after "a couple of hours".
- **Daily move:** a deployment that is always there for its users, but moves region every day. Each copy lives about a day, plus the overlap while the next one comes up and the vaults are copied.

One cap for both would be either too long for ephemeral or too short for the move. So the page asks for two.

## 1. The rows to decide

Every price below is from billing.aws.a's docs/billing/prices.json (work/billing.aws.a, retrieved 23 Nov 2026, AWS's public EC2 and VPC price data, list prices, on-demand Linux, USD), worked by multiplication only. **Not counted anywhere below unless said:** CloudFront, S3, Secrets Manager, logs, data transfer.

### G1. Maximum lifetime of an ephemeral deployment

- **Options:** (a) 2 hours; (b) 4 hours; (c) 8 hours.
- **Recommended:** (a) 2 hours as the default and (b) 4 hours as the hard cap, refused above it. "A couple of hours" is the default; the cap leaves room for a task that overruns without a second approval.
- **What it costs at most** (eu-west-2, largest allowed type of G4, t4g.small plus one public IPv4 at 0.0238 per hour): 2 h 0.0476, 4 h 0.0952.
- **Security (d397c1f):** the lifetime tag is set only at launch and cannot be changed afterwards (design 01, 2f.9).

### G2. Maximum lifetime of a daily-move deployment

- **Options:** (a) 26 hours (a day plus two hours of overlap); (b) 30 hours; (c) no separate cap (the move itself ends it).
- **Recommended:** (a). The move should end each copy; the cap is the backstop if a move fails, so the old copy does not run for days.
- **Cost of one copy at the cap** (t4g.small plus IPv4, eu-west-2): 26 h 0.6188. Always on for a month (730 h): 17.37.
- **Security (d397c1f):** a copy past 26 h is a failed move: it raises an alert, and is deleted only once its replacement answers, so users are never left with no Vault.

### G3. Regions allowed

- **Options:** (a) eu-west-2 (London) and eu-west-1 (Ireland) only; (b) add others once billing.aws.a has priced them and the twin has tested them.
- **Recommended:** (a) now, (b) later by a new decision. These two are the only regions with prices today, so "move every day" means London and Ireland alternating.
- **Enforced by:** IAM `aws:RequestedRegion` on the service role and the move's role (design 01, section 4). Scoped to the regional actions only (EC2, CloudFormation, S3, Lambda in the region): IAM, CloudFront and Route 53 calls are signed for us-east-1, so a blanket region condition would break them (security.aws.a, d397c1f).

### G4. Instance types allowed

- **Options:** (a) t4g.nano, t4g.micro, t4g.small; (b) add t4g.medium.
- **Recommended:** (a). These are priced (per hour, eu-west-2: 0.0047, 0.0094, 0.0188; eu-west-1: 0.0046, 0.0092, 0.0184). Which one the Vault needs is a twin load test still to run; t4g.medium (0.0376) only if that test says so.
- **Also:** CPU credits in "standard" mode only (design 01, 6d), so a stuck instance is slowed, not billed more. T4g launches as unlimited by default, and there a t4g.nano held at 100% CPU adds 54.72 USD in 30 days at 0.04 USD per vCPU-hour, more than G6's whole alert (billing.aws.a, 6a7b8b4). IAM cannot enforce this; a template check does, and Dinis may also set the account default per region (an AWS change, its own plan).

### G5. How many at once

- **Options:** (a) one ephemeral and one daily-move deployment, plus one more during a move's overlap (three at most); (b) a higher number Dinis names.
- **Recommended:** (a). A runaway loop that keeps creating is the main cost risk; three is the most the two kinds need. Enforced by the scheduler refusing above the count, and by a low vCPU quota as the backstop (an AWS change, its own plan; three t4g.small need 6 vCPU). The quota is account-wide, per region and instance family: it limits every EC2 instance in that region of the account, not only ours.

### G6. Cost cap

- **Options for the monthly alert** (an AWS Budgets alert, which the read role can already read): (a) 25 USD; (b) 50 USD; (c) 100 USD.
- **And, separately, what happens at the cap:** (i) an alert only; (ii) an alert plus an AWS Budgets action at 100% that attaches a Deny on creating `sws-ec2-*` stacks to the scheduler and move roles: an automatic "stop new" that deletes nothing (security.aws.a, d397c1f). Recommended (ii): running deployments end at their time, nothing new starts, and only Dinis removes the Deny.
- **Recommended:** (a) 25 USD while only G1 to G5 apply. The known part of a month at G5's most: one daily-move copy always on (t4g.small and IPv4, 17.37), its 8 GB gp3 root volume (0.74; billing.aws.a, 0b1ad2b), one ephemeral 2 h a day (about 1.43) and the overlaps (about 1.43), roughly 21 USD before CloudFront, S3, Secrets Manager, logs and data transfer (CPU credits are zero because G4 holds every instance in standard mode); 25 leaves a little headroom and flags anything unexpected early. Revisit when CloudFront is priced for this path.
- **Per deployment:** no separate cap; G1, G2 and G4 bound it (largest: 0.6188 for a daily-move copy at its cap).
- **What the alert does:** tells Dinis; with (ii) it also stops new deployments by itself.

### G7. Kill switch

- **Recommended, as design 01 section 6b with security.aws.a's split:** "stop new" is one click (nothing new starts; running deployments end at their time); "end all" deletes every managed deployment now, its DNS records first and then the stacks, so no name is left pointing at a deleted address, and is a plan Dinis approves; clearing "stop new" is a plan Dinis approves.
- **Options:** (a) as recommended; (b) "end all" as one click too.
- **Recommended:** (a). "End all" deletes stacks, which is not undone by pressing again.

### G8. Where the sweeper runs (design 01, 6b lock 2)

- **Options:** (a) an EventBridge schedule and a small Lambda in our account, made by an approved stack; (b) a GitHub Actions job with an OIDC role, its `sub` pinned to repository, branch and environment; (c) only in the site while Dinis is signed in (not a sweeper).
- **Recommended:** (a), with security.aws.a: no credential outside AWS, no new trust from GitHub.
- **What the sweeper may do (d397c1f):** describe, alert, and `cloudformation:DeleteStack` only on stacks named `sws-ec2-*` and tagged `sws:managed=true`. Nothing else.
- **Lock 1 regardless:** each deployment also gets its own one-time schedule, made beside its stack, that deletes it at its time and then deletes itself (boto3.aws.a, bcba1ec); its role may delete that one stack by ARN and that one schedule, nothing more (security.aws.a, d397c1f).

### G9. The daily move's own role

- **Recommended:** a role that may create only `sws-ec2-*` stacks, only in G3's regions, at most one new deployment per move, and copy encrypted vault objects bucket to bucket (it never holds a vault key). It is the one scheduled thing that creates, so it is the row with the most cost risk (security.aws.a).
- **Options:** (a) as recommended; (b) no daily move yet: ephemeral only, until the move has run a week in the twin.
- **Recommended:** (b) first, then (a). The move has the most moving parts (deploy, copy, DNS switch, expire), so it runs a week in the twin before it runs for real.
- **Security (d397c1f), for (a):** the order is fixed: the new copy answers `/health` and the vault check, then DNS moves, then the old copy is deleted. The role touches one DNS record name only, holds no `kms:Decrypt`, and copies buckets old to new only. "A week in the twin" means a week of clock-driven moves (twin clock `tick`) checked by plan step 9's CloudTrail rules (cloudtrail.aws.a).

## 2. Recommended answer line

"G1 a+b, G2 a, G3 a, G4 a, G5 a, G6 a with (ii), G7 a, G8 a, G9 b then a."

## 3. What approving this page does, and does not, do

- **Does:** lets ec2.aws.a, cloudformation.aws.a and iam.aws.a write the templates and roles with these numbers, test them in the twin, and then bring each real change (service role, scheduler, sweeper, budget, quota) to Dinis as its own plan to Approve.
- **Does not:** create, change or delete anything in AWS. Every real step is still a plan Dinis approves on the site.

## 4. Not yet known, and who closes it

| Item | Owner |
|---|---|
| EBS gp3 price per GB-month (the root volume) | billing.aws.a |
| CloudFront, S3, Secrets Manager, logs for one Vault per hour | billing.aws.a (plan step 8) |
| Which t4g size the Vault needs | ec2.aws.a, twin load test once the EC2 twin is built (dev.1.aws.a) |
| Whether IAM can compare a tag's date with launch time (G1 in IAM, not only template and sweeper) | iam.aws.a |
