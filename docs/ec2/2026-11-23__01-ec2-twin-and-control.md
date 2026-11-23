# EC2 design 01: EC2 in the twin, EC2 control, a second deploy path, ephemeral deployments

Written by ec2.aws.a@SovereignWebsite.dinis, 23 November 2026 ~15:30 UTC. Status: **first draft, proposed**. Plan steps 10 and 11 (docs/team/plan-vault-deploy.md), from Dinis's word relayed by maestro.a (~14:55 UTC): "we need to add EC2 control to our environment ... this will be another one of the deployments that we can do ... start for a couple of hours, destroy ... move our deployments across regions every day". For dev.1.aws.a and dev.2.aws.a (they build the twin), architect.aws.a (journal and world), iam.aws.a and security.aws.a (sections 4 to 6), billing.aws.a (costs), vaults.aws.a and cloudformation.aws.a (section 5). Twin first; nothing here touches AWS, and no agent calls AWS.

Read before this: vaults design 04 (work/vaults.aws.a, 23f8b03), iam.aws.a's step 3 (work/iam.aws.a, 68f4b8b), pm.aws.a's batch 2 (V4, V5, V6 on work/pm.aws.a), the twin journal (work/dev.2.aws.a.cfn-journal, site/twin.js "design 02, step 1").

## 0. Sources, and what is not known

- AWS facts below are AWS's documented behaviour as I know it, marked *check* where boto3.aws.a should confirm against AWS's own documentation before code depends on them. No prices are given here: every cost comes from billing.aws.a's docs/billing/prices.json, which has no EC2 rows yet (ask in section 8).
- The SG/Send server facts (image, port 8080, `s3` storage, four settings) are from vaults design 04 section 0, which cites sgit.ai.
- Not known: the EC2 template in sgit.ai's encrypted deploy vault (vaults design 04, question 1). If it is readable, section 5 starts from it rather than from this draft.

## 1. Scope, in the order to build

| # | Piece | Where | Gate |
|---|---|---|---|
| 1 | EC2 in the twin: instances, AMIs, security groups, key pair names, start, stop, terminate, every change a journal entry | site/twin.js (dev.1 or dev.2), tests in test/twin/ | Dinis's yes for test/** (as for every twin patch) |
| 2 | EC2 read page: what runs, where, what it costs, for our own account | a view in the site, keeper-reviewed (R-010) | none beyond review: reads only, with the read role the site already has |
| 3 | EC2 actions as plans Dinis approves | site plan flow | a template change (v3) to give the change role any EC2 right: a plan, then Dinis's Approve |
| 4 | EC2 as a second way to deploy the Vault | a CloudFormation template beside cloudformation.aws.a's Lambda one | V4 (recommended: after the Lambda path works on the twin) |
| 5 | Ephemeral deployments and the daily region move | design and twin only | V5: a decision page with the guard rails, approved by Dinis, before anything real runs on a schedule |

## 2. EC2 in the twin

### 2a. Wire format

The page calls EC2 as the browser would call AWS: `POST https://ec2.<region>.amazonaws.com/`, form body `Action=<name>&Version=2016-11-15&...`, SigV4 signed, XML answers in the `http://ec2.amazonaws.com/doc/2016-11-15/` namespace, errors as `<Response><Errors><Error><Code>..</Code><Message>..</Message></Error></Errors><RequestID>..</RequestID></Response>` (*check*). The twin adds one line to `handle()`:

```js
else if (/^ec2\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = ec2(new URLSearchParams(body), init, host);
```

The region is the host's second label, as Cloud Control already does. Lists use EC2's numbered form (`InstanceId.1`, `Filter.1.Name`, `Filter.1.Value.1`) (*check*).

### 2b. Actions in v1

| Action | Twin answer | Notes |
|---|---|---|
| DescribeRegions | the twin's region list, with `OptInStatus` | the read page's region sweep starts here |
| DescribeInstances | reservations and instances in that region, filters `instance-state-name`, `tag:<k>`, `tag-key`, `instance-id` | paginated with `NextToken` past 50 (the real default and maximum differ, *check*); the twin pages at a small size so the page's paging is tested |
| DescribeInstanceStatus | state and checks, `IncludeAllInstances` | optional in v1 |
| DescribeImages | `Owner.1=self` only, plus the AMIs the instances use | no public catalogue in the twin |
| DescribeSecurityGroups | groups and rules in that region | the read page flags any rule open to 0.0.0.0/0 or ::/0 |
| DescribeKeyPairs | name, id, fingerprint, type | **never key material**; see 2e |
| DescribeTags | tags of instances | |
| RunInstances | one or more new instances in `pending` | refuses what section 2f refuses |
| StartInstances, StopInstances, TerminateInstances | state change lists (`currentState`, `previousState`) | |
| CreateTags, DeleteTags | | how a stack or the scheduler marks what it owns |

Anything else answers `InvalidAction` (HTTP 400), so a page that strays from the list fails loudly in the twin, not silently.

### 2c. The world and the journal

One world per account (architect.aws.a, agreed with vaults.aws.a for the vault deploy): `w.ec2[region]` lives inside each account's world, account 111122223333's seed is that account's alone, and a twin customer account starts with an empty EC2 world unless its stack creates instances. Maps are `Object.create(null)`, as the journal's `map()`:

```
w.ec2[region] = { instances: map(), images: map(), groups: map(), keyPairs: map() }
```

An instance: `{ id, type, image, state, launched, stateChanged, stateReason, tags, groups: [id], profile: arn|null, vpc, subnet, keyName|null, publicIp|null, privateIp, az, metadataOptions, creditMode, rootVolume: { sizeGiB, encrypted } }`. `profile` is the instance profile's role, so the graph gets `instance runs_as role` as it does for Lambda and Firehose; v1 seeds one default VPC and subnet per region.

New journal operations, one small function each (the OPS table). Writes made by a call have the caller as actor (`actorOf(init)`) and `why` `plan.approve`, `pack.seed` or `schedule.<name>`; settles (2d) have actor `aws:ec2` and why `clock.settle`:

| op | target | data |
|---|---|---|
| `ec2.createSecurityGroup` | `arn:aws:ec2:<region>:<account>:security-group/<id>` | name, description, vpc, rules |
| `ec2.registerImage` | `...:image/<id>` | name, architecture, created |
| `ec2.importKeyPairName` | `...:key-pair/<id>` | name, fingerprint, type (no material, ever) |
| `ec2.runInstance` | `...:instance/<id>` | every field of the instance, state `pending`, and its `settles` (2d) |
| `ec2.setState` | `...:instance/<id>` | `{ from, to, reason, settles: { to, at } or none }` |
| `ec2.forget` | `...:instance/<id>` | none: a terminated instance leaves the answers |
| `ec2.setTags`, `ec2.removeTags` | any taggable ARN (instance, security group, image) | tags |

**Ids are made once, at write**, and stored in the entry's target ARN (and data); a fold only reads them, never derives them. They are drawn from a named stream (`rng("ec2.ids")`, design 02) so entries elsewhere do not shift them, and golden tests stay stable.

**Addresses** (architect.aws.a, design 03): private addresses from 10.0.0.0/16; public IPv4 from 198.51.100.240/28, reserved from the visitor generator (dev.1.aws.a excludes it from its network split); IPv6 from 2001:db8:ec2::/48. None collide with the twin's client networks (visitors 198.51.100.0/24 and 192.0.2.0/24, attacker 203.0.113.0/24, operator 192.0.2.7).

### 2d. States and the twin's clock

EC2's states: `pending` to `running`; `stopping` to `stopped`; `shutting-down` to `terminated`; a terminated instance stays visible for a while, then disappears (*check* the period).

**A read never writes** (architect.aws.a): the journal must not depend on whether or when someone looked, replay of an export must equal the live session, and design 02 step 3 needs every role-actor entry to match exactly one CloudTrail record. So settles are clock-driven, design 02's mechanism for timed steps:

- The transition entry carries its settle: `ec2.setState { from: "running", to: "stopping", settles: { to: "stopped", at: t + 30000 } }` (RunInstances: `pending`, settles to `running`).
- When the twin clock passes `at`, the twin emits `ec2.setState { from: "stopping", to: "stopped" }` with actor `aws:ec2` and why `clock.settle`. CloudTrail derives nothing from it (AWS logs no API call for a settle).
- "Terminated stays visible, then goes" is a settle too: an `ec2.forget` entry at the end of the period.
- The twin's one clock (dev.1.aws.a's, shared with stack events) gives `now()` and `tick(ms)`. When it is paused, as in tests, nothing settles until `tick`.
- The delays (proposed: running after 20 s, stopped after 30 s, terminated after 15 s, forgotten after a period to *check*) are twin choices, not AWS figures, and live in the pack, not in code.

Stopped instances keep their tags, private address and root volume, and lose a public address that was not an Elastic IP (*check*); the twin does the same so the read page shows what Dinis would see.

### 2e. Key pairs: names only

`CreateKeyPair` returns the private key in its answer (*check*). The twin answers it with `UnsupportedOperation` and a message that says why: no private key passes through the page, the twin or an agent. `ImportKeyPair` is accepted with a public key only, and the twin keeps the name, id and fingerprint, never the key. Section 5 recommends no key pair at all for our instances (no SSH; Session Manager if a shell is ever needed, *check*).

### 2f. What the twin refuses, so the guard rails are testable

The twin enforces the same rules the real path would, so a test proves the page cannot get past them:

1. `RunInstances` without the tags `sws:managed=true`, `sws:owner=<stack or plan>` and `sws:expires-at=<ISO time>` fails `UnauthorizedOperation` (in AWS this is an IAM condition on `aws:RequestTag`, section 4; *check*).
2. A region not in the allowed list fails the same way (an IAM `aws:RequestedRegion` condition, *check*).
3. `sws:expires-at` more than the maximum lifetime after launch fails (number from V5).
4. A public SSH rule (port 22 from 0.0.0.0/0 or ::/0) in a security group made through the twin fails.
5. `MetadataOptions.HttpTokens` other than `required` fails (IMDSv2 only).
6. Start, Stop and Terminate on an instance without `sws:managed=true` fail `UnauthorizedOperation` (an `ec2:ResourceTag` condition, *check*).
7. (from 6d) `CreditSpecification.CpuCredits=unlimited` on a t4g instance fails.
8. An AMI not in the allow list fails (security.aws.a).
9. CreateTags or DeleteTags on an `sws:*` key after launch fails, so an expiry cannot be pushed back (security.aws.a).

DescribeInstanceAttribute and ModifyInstanceAttribute are not in 2b, so they answer `InvalidAction`: the page cannot read or change user data.

### 2g. Seed data (pack baseline)

Synthetic and labelled as such, in account 111122223333 like the rest of the twin: one stopped instance `demo-ec2-vault` in eu-west-2 (tagged as managed, with an expiry in the past so the read page shows an overdue one), one security group with HTTPS from CloudFront only, no key pairs, one AMI owned by self, and nothing in other regions, so the region sweep shows empty regions as empty. The attack pack adds nothing to EC2 in v1.

### 2h. Tests (test/twin/ec2.test.mjs)

1. Signed calls only; an unsigned call is refused, as for the other services.
2. DescribeRegions, then DescribeInstances in each region: the seed appears in eu-west-2 only.
3. Paging: more instances than one page, every one returned once.
4. RunInstances with the three tags: `pending`; `tick(20000)`; `running`. The journal holds `ec2.runInstance` with the caller as actor and one `ec2.setState` with actor `aws:ec2`, why `clock.settle`. A Describe with the clock paused adds no entry.
5. Stop, Start, Terminate: the state lists match AWS's shape; a terminated instance disappears after its period.
6. Each refusal in 2f, one test each; nothing is recorded in the journal when a call is refused.
7. CreateKeyPair is refused; no answer from the twin ever contains `BEGIN` and `PRIVATE KEY`.
8. Fold: `AwsTwin.fold(AwsTwin.journal())` gives the same EC2 world as the live one, with the same ids, whatever reads came between.
9. Same history however it is read (architect.aws.a): run one stop and start sequence twice, once with a single `tick` past every `at`, once with Describes at random points while the clock runs. The two journals are equal: every settle has `t` equal to its `at`, in `at` order.
10. Golden: the baseline pack's EC2 answers are fixed in test/fixtures/twin-golden/.

## 3. The read page for our own account

**What it shows:** every region, the instances in it (name tag, type, state, age, `sws:expires-at` and whether it is overdue, public address, security group warnings), stopped instances' volumes still billed, and the cost so far and per hour from billing.aws.a's prices, labelled "list price, estimate" as billing.aws.a labels its others.

**Permissions (iam.aws.a, docs/iam/ec2-01-answer.md on work/iam.aws.a):** do not rely on the read role's `ViewOnlyAccess`. P-IAM-001 v2.5 (cleared, pending Dinis's console apply) caps the read role with a boundary that names its reads exactly, which caps ViewOnlyAccess's EC2 reads out. So the page's reads are added by name to the read role and its boundary: `ec2:DescribeRegions`, `ec2:DescribeInstances`, `ec2:DescribeSecurityGroups`, and `ec2:DescribeVolumes` and `ec2:DescribeAddresses` for billed volumes and addresses. That is a console apply, so a plan for Dinis. **Never** `ec2:DescribeInstanceAttribute`: it returns user data, and the page never fetches user data (security.aws.a).

**Calls:** DescribeRegions in one region, then DescribeInstances (and DescribeSecurityGroups) in each enabled region, in parallel with a small limit, from the browser with the read role, through the one transport (twin or AWS, docs/architecture/2026-11-23__01-one-transport-two-back-ends.md). Two calls per region; with about 17 default regions, about 35 signed calls per refresh (*check* the count of default regions). No polling: refresh on demand.

**CSP:** the page talks to `https://ec2.<region>.amazonaws.com`, already inside `connect-src https://*.amazonaws.com`. R-013 (c) suggests listing exact hosts; if the keeper does that, the EC2 hosts of the allowed regions join the list.

**Read API (design 03, architect.aws.a):** `Ec2Api(send)` gives one page `{ items, next }` (NextToken as an opaque `next`), an `arn` on every item (built, marked `arnDerived`, as EC2 answers carry none), errors as `Code: Message` with `.code` and `.status`; `ec2.openapi.json` lists the Describe actions in `x-aws-actions` (writes are not in the read API); `Graph.add.ec2` adds instance `in` account, `uses` image, `has` security group, `runs_as` role, and a rule open to 0.0.0.0/0 or ::/0 as `allows_from` to `urn:sws:actor-net:0.0.0.0/0`, all evidence api.

**Where it lives:** a view of the existing app, built by dev.2.aws.a with ux.aws.a, code reviewed by the keeper and security.aws.a (R-010: no agent adds a script under site/ outside review).

## 4. EC2 actions as plans

The change role has **no EC2 right today** (bootstrap.yaml:84-131). Any EC2 action on the real account first needs a template change, which is itself a plan and Dinis's Approve. Proposed shape for that change (for iam.aws.a and security.aws.a to weigh, not a request yet):

1. **Creating instances only through CloudFormation, with a service role** (security.aws.a's point 1): every EC2 deployment is a stack `sws-ec2-<fixed-length id>` made by the change set flow the site already has (diff, change set, two clicks). The stack runs as its own CloudFormation service role, as iam.aws.a's Vault deploy role does, so the change role holds only the change-set rights on `stack/sws-ec2-<id>/*` and `iam:PassRole` on that one service role, never RunInstances itself. P-IAM-002 drafts it once V4 is decided (iam.aws.a).
2. **What the service role may launch**, conditions per resource type (iam.aws.a checked the keys in cfn-lint's IAM data; boto3.aws.a confirms against the live reference):
   - `ec2:RunInstances` on `instance/*` and `volume/*` with `aws:RequestTag/sws:managed`, `sws:owner`, `sws:expires-at` and `aws:TagKeys`; `aws:RequestedRegion` in the allowed list; `ec2:InstanceType` in the short list; `ec2:MetadataHttpTokens=required`; `ec2:Encrypted=true` on volumes;
   - on `image/*`: an AMI allow list (`ec2:Owner` or exact ids);
   - exactly one passable instance role, with `iam:PassedToService=ec2.amazonaws.com`. User data can send that role's credentials anywhere, so the role holds only the bucket, the secret and logs;
   - a Deny on `key-pair/*` (no key pair, ever);
   - `ec2:CreateTags` only with `ec2:CreateAction=RunInstances`; otherwise a Deny on CreateTags and DeleteTags for `sws:*` keys, so nobody can tag-hijack an unmanaged instance or push back an `sws:expires-at`;
   - **never** `ec2:ModifyInstanceAttribute`: new user data plus a start is new code running under the instance role.
3. **Start and stop directly**, as a one-click plan, only with `ec2:ResourceTag/sws:managed=true`. These are reversible.
4. **Terminate only by deleting the stack**, so nothing is left behind (volumes, security groups, addresses) and the delete is visible in CloudFormation's events.
5. **What IAM cannot say, recorded as gaps:** a security group's CIDR (a template check plus an AWS Config rule), the number of instances (a low vCPU quota, an AWS change for Dinis), the maximum lifetime and the cost cap (twin refusals, a template check and the sweeper of 6b).
6. R-002 and R-008 still apply: a change-set right is reachable by a script in the page, so what the service role may launch is the real limit. EC2 adds cost risk on top of access risk.

## 5. EC2 as a second way to deploy the Vault

Recommended timing: V4 (b), after the Lambda path works end to end on the twin. Shape, to change as little of vaults design 04 as possible:

```
customer's account, chosen region (stack sws-vault-<id>, "ec2" variant)
  S3 bucket  <--  EC2 instance (SG/Send container, s3 mode, port 8080)  <--  CloudFront (HTTP origin on 8080, or HTTPS, *check*)
  Secrets Manager secret (token)    instance role (bucket, secret, logs)       /health: the same CloudFront Function
```

- **Same as the Lambda variant:** bucket (retained), secret (generated), CloudFront in front with `/health`, the domain phase, the names `sws-vault-<id>-<part>` and tags, the outputs. Only the compute differs, so the page, the `/health` check and iam.aws.a's deploy role change least.
- **The instance:** the smallest arm64 type the image runs well on (billing.aws.a and a twin load test to choose; no number here), the image `diniscruz/sg-send-vault` pinned by digest, started by user data that pulls the image and runs it with `SEND__STORAGE_MODE=s3` (*check* how the token reaches the process: the same server question as vaults design 04 question 3; the instance role can read the secret at start-up, which avoids putting the token in the template or user data). Docker Hub is reachable from an instance, so the ECR question of design 04 (question 4) does not arise for EC2.
- **No inbound SSH, no key pair**, IMDSv2 required, root volume encrypted, security group open to CloudFront's origin-facing addresses only (the AWS managed prefix list for CloudFront, *check*), so the instance is not reachable directly. This is stronger than the Lambda variant's public Function URL.
- **What EC2 adds:** a disk (`SEND__STORAGE_MODE=disk` becomes possible, but `s3` stays recommended: an ephemeral instance loses its disk), a predictable hourly cost instead of per request, no cold starts. **What it costs:** an instance billed while it runs, whether used or not, and patching (the image is fixed by digest; the operating system needs updates, so ephemeral instances replaced often are simpler than long-lived ones).
- **Why it matters for step 11:** a short-lived instance is the natural unit of "start for a couple of hours, destroy".

## 6. Ephemeral deployments and the daily region move (design and twin only)

### 6a. One deployment, start to end

1. A stack `sws-ec2-<id>` (or `sws-vault-<id>` in its EC2 variant) is created with the tags `sws:managed=true`, `sws:owner`, `sws:expires-at`.
2. It runs until `sws:expires-at`.
3. It is deleted by deleting the stack. The bucket is retained (vaults design 04), so data is never lost by expiry; emptying it is a separate, explicit step (cloudformation.aws.a's O5).

### 6b. Who deletes it: two locks, not one

- **Lock 1, inside each stack:** the stack carries its own one-time EventBridge Scheduler schedule at `sws:expires-at` that deletes the stack, with a role that may delete only that stack (*check* that a schedule can target `cloudformation:DeleteStack` through the universal target, and that a stack may hold the schedule that deletes it). The deployment ends on time even if everything else is down.
- **Lock 2, a sweeper:** something that lists stacks tagged `sws:managed=true` and deletes each at the **earlier** of `sws:expires-at` and its CreationTime plus the maximum lifetime (a tag is writable, the creation time is not; security.aws.a), and raises an alert for any instance not in a managed stack. Where it runs is a decision for Dinis: (a) an EventBridge schedule and a small Lambda in our account, made by an approved stack (recommended: no credential outside AWS); (b) a GitHub Actions job with an OIDC role (a new trust from GitHub to the account; if chosen, the OIDC `sub` pinned to repository, branch and environment); (c) the site when Dinis is signed in (no schedule at all, so not a sweeper).
- **Kill switch, in two parts** (security.aws.a): "stop new" is one SSM parameter (or one tag on the hub stack) that everything reads before creating anything, set with one click; "end all" deletes every managed stack at once and is a plan Dinis approves. Clearing "stop new" is a plan Dinis approves.

### 6c. The daily region move

Per vaults design 04 section 7, servers do not replicate, so a move is: create the deployment in the new region; copy the old bucket's encrypted objects to the new bucket, bucket to bucket, so no scheduled job ever holds a vault key (security.aws.a; *check* with vaults.aws.a that a server reads a copied bucket as its own); switch DNS with a role scoped like the Vault access stack's; let the old deployment expire through 6b. Order matters: the old one is deleted only after the new one passes `/health` and the vault check. **The move creates on a schedule**, so 7.2's "may delete, never create" does not hold for it: its role is V5's largest cost risk and gets its own line there, limited to the allowed regions, one deployment at a time and the stack names. In the twin this is a test that runs a whole day in `tick` steps and checks that at every moment exactly one deployment answers DNS.

### 6d. What one deployment costs, first figures

From billing.aws.a's rows (docs/billing/prices.json on work/billing.aws.a, retrieved 23 Nov 2026, AWS's public EC2 and VPC price data; list prices, on-demand Linux, USD), worked here by multiplication only:

| eu-west-2 (London) | per hour | 2 hours | 24 hours | 730 hours (a month) |
|---|---|---|---|---|
| t4g.nano + one public IPv4 (0.0047 + 0.005) | 0.0097 | 0.0194 | 0.2328 | 7.08 |
| t4g.small + one public IPv4 (0.0188 + 0.005) | 0.0238 | 0.0476 | 0.5712 | 17.37 |
| t4g.medium + one public IPv4 (0.0376 + 0.005) | 0.0426 | 0.0852 | 1.0224 | 31.10 |

eu-west-1 is a little lower for the instance (0.0046, 0.0184, 0.0368) and the same for the address. **Not counted:** the root volume (EBS gp3 is in billing.aws.a's not_priced_yet), CloudFront, S3, Secrets Manager, logs, data transfer, and t4g CPU credits above baseline. Two design points follow:

1. **CPU credits:** t4g instances start in "unlimited" credit mode by default, which bills credits above baseline (*check*). Ephemeral instances should launch in "standard" mode (`CreditSpecification`), so an instance pinned at full CPU (a bug, or a flood) is slowed, not billed more. The twin refuses `unlimited` as a seventh rule in 2f.
2. **The public address:** an instance behind CloudFront as a custom origin needs a public name, and so a public IPv4 billed by the hour, whether used or not (*check* whether CloudFront's VPC origins remove the need, which would also take the instance off the internet entirely). Counted above.

### 6e. Guard rails for V5, to propose with numbers from the twin

| Guard rail | Proposal | Grounded in |
|---|---|---|
| Maximum lifetime | a few hours, set per deployment, refused above the cap (2f.3) | Dinis: "start for a couple of hours, destroy"; the exact cap is his |
| Regions allowed | the regions billing.aws.a has priced and the twin has tested; today that is eu-west-2 and eu-west-1 | docs/billing/prices.json regions |
| Cost cap | per deployment and per month, from billing.aws.a's EC2 rows once they exist; an AWS Budgets alert at the monthly cap (the read role already reads budgets) | billing.aws.a, to come |
| Kill switch | 6b | |
| Instance types | a short list, refused otherwise | section 4.4 |
| The move's create role | its own line: allowed regions, one new deployment per move, `sws-ec2-*` names only | security.aws.a, 6c |
| Concurrent deployments | at most N at once (N from Dinis), refused above it | a runaway loop is the main cost risk |

No number is set here: V5 (b) says ec2.aws.a and billing.aws.a propose them from the twin, and Dinis approves them on a decision page before anything real runs.

## 7. Security notes (for security.aws.a)

1. Every EC2 right on the change role widens R-002 and R-008 with a cost risk; 2f's conditions and the instance type list limit it, they do not remove it. The R-002 split (a change page with its own client ID) helps here as for IAM.
2. The scheduler and sweeper roles of 6b may delete, never create, and only stacks tagged `sws:managed=true`: a bug in them can end deployments early, never start one. The daily move (6c) is the exception: it creates, so its role is listed on its own in 6e.
3. No SSH, no key material anywhere, IMDSv2 only, encrypted volumes, origin open to CloudFront only.
4. The read page shows public addresses and security group rules. They are our own account's, read with Dinis signed in, rendered as text only (as the S3 browser does). It never fetches user data.
5. Reviewed by security.aws.a: docs/security/reviews/2026-11-23__ec2-design-01.md on work/security.aws.a (ff92c75); its points are folded into 3, 4, 6b, 6c and 7 above.

## 8. Asks

- **dev.1.aws.a** (took it, 15:04 UTC; after its privacy change and deploy step 4): build section 2 as one twin patch with test/twin/ec2.test.mjs, on top of work/dev.1.aws.a (49db094 or later); I review it against this design, architect.aws.a against design 02. The settle (2d) uses the twin clock dev.1.aws.a brings forward for stack events: `now()` and `tick(ms)`, clock-driven, never on read.
- **architect.aws.a:** answered (15:06 UTC, docs/team/from-a/architect.aws.a.md); folded into 2c, 2d and 3. Later, not v1: a no-state `ec2.refused` entry so refused calls appear in the CloudTrail derivation.
- **boto3.aws.a:** every *check* above, most of all 2a, 2d, 2f and 6b.
- **iam.aws.a:** answered (docs/iam/ec2-01-answer.md); P-IAM-002 once V4 is decided.
- **billing.aws.a:** done for t4g and public IPv4 (15:05 UTC, section 6d); still open: EBS gp3 per GB-month.
- **security.aws.a:** reviewed (ff92c75), folded in.
- **cloudformation.aws.a:** the EC2 variant of the Vault stack (5) when V4 allows; the self-deleting schedule (6b lock 1).
- **pm.aws.a:** nothing new for Dinis yet; V4 and V5 already cover this. The sweeper's home (6b: a, b or c) joins V5 when the decision page is drafted.
