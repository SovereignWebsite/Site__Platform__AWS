# Decisions for Dinis: AWS Platform

Kept by pm.aws.a (took over from pm.aws.c on account A, 23 Nov 07:30 UTC). Updated 23 Nov 2026, 15:30 UTC. Every open question for Dinis from the aws.* agents, in one place, most urgent first. Answer by number in pm.aws.a's session (https://claude.ai/code/session_018yvwtLfieUut6hSirZ6W9B), for example: "1 a, 2 a, 3 a, 4 a, 5 a, 6 a, 8 a".

This batch as a presentation (docs/board/brief/decisions-brief.html, https://claude.ai/artifact/Vpk7NnqQ3sz9MgkC2aDmVP) and a decision video in the studio's format (docs/board/brief/decision-video.html, https://claude.ai/artifact/FEaZ96X1APbEPmke5J6ido); both private to Dinis.

Nothing here stops the team: the agents are building on the twin. Decision 3 holds dev.2.aws.a's code (site/api/**, test/api/**) on its branch.

## Waiting on you now

### 1. The agents publish their keys
- **Asks:** factory.c (account C), for the account A agents
- **What:** 20 account A agents have each prepared a signed commit adding their key to the Factory's team/keys.json (all on Factory dev 885f150), as docs/team/keys/<role>.aws.a.iac-commit.txt on their work branches: architect, billing, boto3, cloudformation, cloudtrail, conductor, data, dev.1, dev.2, journalist, lambda, ontology, pm, s3, security, sherpa, swarm, ux, vaults, video. None has landed: Factory dev (02cab38) lists no .aws.a key, and factory.c's session asks your word for every push. Not yet prepared: iam.aws.a (needs the Factory attached in its session) and viz.aws.a (its session cannot make a signing key). The earlier eight .aws.c commits are moot: those roles moved to account A.
- **Options:** (a) a standing word in factory.c's session (https://claude.ai/code/session_01Kw9UwFQ86g2ZeXQ2edTAjh): "land every verified agent key commit"; (b) a word per landing, as now.
- **Recommended:** (a). factory.c rebuilds each commit byte for byte and runs the five checks before it lands; your word adds a wait, not a check.
- **Blocks:** every account A agent pushing to dev: the names are in the policy now (6ab7233), but the deploy's signer check refuses a commit whose key is not live on the Factory, and stops the deploy for everyone.

### 2. Security R-009 (High): the deploy's signer check can be bypassed
- **Asks:** security.aws.c (03:28 review), through conductor.aws.c
- **What:** anyone who can push to dev can get past the check: an "Owner override:" line in a commit, GitHub-verified web commits, and the checker running from the very commit it checks. Fixing it changes .github/**, which is yours.
- **Options:** (a) run the checker from main or a pinned commit, and drop the override line; (b) leave as is for now.
- **Recommended:** (a), first of the two.
- **Blocks:** trust in what deploys from dev, with 22 agents now pushing.

### 3. Security R-010 (High, widened): team code on the hub's own origin
- **Asks:** security.aws.a (72f4cee on work/security.aws.a, 14:08 UTC)
- **What:** with the .aws.a names in the policy (6ab7233), agents other than the keeper hold paths to code the hub's page loads beside your sealed session: site/s3.js (dev.1.aws.a, s3.aws.a, and s3.aws.c) and site/twin*.js (dev.1.aws.a, dev.2.aws.a); site/api/** (architect, dev.2) and site/decisions/** (pm) are not loaded by any page yet. The deploy checks who signed a commit, not which paths it touches, so the paths in the policy are a promise, not a control.
- **Options:** (a) add a CI step in .github/ci/ that refuses a commit touching files outside its signer's paths in abp.json, before the .aws.a keys go live on the Factory; until then aws.c reviews every site/*.js change before it lands; (b) keep the paths as a promise and rely on aws.c's review; (c) narrow the code paths back to the keeper. Moving team pages to their own area sites (decision 5) stays the longer-term fix.
- **Recommended:** (a). It changes .github/**, which needs your yes, like decision 2; the two can land together.
- **Blocks:** safe deploys by the account A agents once their keys are live.

### 4. Approve template v2.1 on the site
- **Asks:** aws.c
- **What:** Plans, the stack plan "Waiting for you": the R-001 fix (the change role can no longer make itself admin) and the description change. security.aws.c reviewed it.
- **Options:** (a) approve when next signed in; (b) leave it.
- **Recommended:** (a). No work waits on it: everything is built on the twin.
- **Blocks:** real AWS changes only.

### 5. The nine area sites: merge factory.c's requests
- **Asks:** factory.c (you said yes to the nine areas in aws.c's session)
- **What:** the requests are on work/factory.c-aws-areas in the Factory, waiting for your merge.
- **Options:** (a) merge all nine; (b) only s3 for now.
- **Recommended:** (a).
- **Blocks:** each area's own site and its "Try the twin" link.

### 6. Security R-008 (High): a permissions boundary on the change role
- **Status: ready.** iam.aws.a's v2.5 (ee7f7b9 on work/iam.aws.a; the template to apply: docs/iam/proposals/P-IAM-001-v2.5-draft.yaml there) adds the 13 IAM, Lambda and Firehose reads dev.2.aws.a's API layer needs; security.aws.a cleared it on paper (ba0afa0, replacing v2.4's clearance).
- **One thing to weigh:** with v2.5 the read role can read Lambda environment variables (GetFunctionConfiguration), so any secret kept there becomes readable from the page. Accept it, and keep secrets in Secrets Manager or SSM rather than in function environments.
- **Asks:** iam.aws.a (P-IAM-001), through conductor.aws.a; cleared by security.aws.a
- **What:** even after v2.1, a script in the page can make the change role admin through a change set (R-008). iam.aws.a's draft, now v2.5 (ee7f7b9 on work/iam.aws.a; v2.4 2107fe5, v2.3 2b8ceab), adds permissions boundaries that mirror today's scopes, with a custom read boundary. security.aws.a cleared v2.5 on paper (ba0afa0 on work/security.aws.a; v2.4 0cfa69f; v2.3 47b48c3, after three gaps in v2.2, a1d2057), and the DNS condition is met inside it.
- **Before and after the apply:** no open security condition left (security.aws.a, 12:18 UTC): v2.5 keeps its Deny on iam:UpdateRole, since a failure there is loud and recoverable in the console while dropping it would allow a silent 12-hour session. Right after your apply, one harmless tag change set on the read role confirms it, with you watching the stack events. The first apply is your own act in the console.
- **Options:** (a) one console apply of v2.5: both boundaries, and console-only trust for sovereignwebsite-factory-dns (the change role loses GetRole and UpdateAssumeRolePolicy on it); aws.c retires the two DNS-trust plans in site/plans/ in the same release; (b) not recommended by iam.aws.a or security.aws.a: as (a) but keep DNS trust edits from the page, which leaves R-005 open, since whoever controls that role's trust controls the site's name; (c) v2.1 through the page now (decision 4), boundaries later; (d) no boundary, rely on splitting off the change page (R-002).
- **Recommended:** (a), by iam.aws.a and security.aws.a (4b7271d on work/security.aws.a): remove TheDnsRoleTrustPolicy from the change role and its boundary in the same apply. A boundary on the DNS role would not make (b) safe, since that role's own rights (the Factory's docs/aws-oidc.md) can repoint the site's CNAME. DNS-trust edits are rare. If (a) or (b), decision 4 folds into it. R-008 stays Open until applied.
- **Blocks:** R-008 closing. A change to AWS, so yours.

### 8. vaults.aws.a reads the SG/Send browser vault library
- **Asks:** vaults.aws.a (designs 01 to 03, 88588c6 on work/vaults.aws.a)
- **What:** the vault twin should answer batches exactly as SG/Send's browser vault library does (vault UI v0.2.3, in the SGraph-AI__App__Send repository). vaults.aws.a's session refused attaching that repository (11:38 UTC), so it cannot read the library.
- **Options:** (a) yes in vaults.aws.a's session (https://claude.ai/code/session_018yvwtPEp1ze9LonhajhRdg) to attach SGraph-AI__App__Send read-only, pinned to one commit; (b) let it fetch the twelve published library files from dev.vault.sgraph.ai instead (unversioned); (c) no: it designs from sgit.ai's published description only.
- **Recommended:** (a). Read only, and a pinned commit is what design 01 already proposes copying into site/ for the CSP.
- **Blocks:** the per-operation result shape and the batch-wide conflict rule in the vault twin (design 02 section 2); nothing else.

## Batch 2: deploy a Vault into a customer's AWS account, EC2, ephemeral deployments
From your word at ~14:55 UTC (maestro.a's session); plan and owners in docs/team/plan-vault-deploy.md (work/conductor.aws.a, ea9f61d). First drafts: step 1 the Vault design (vaults.aws.a, eec9d24), step 2 the stack (cloudformation.aws.a, 42677c7), step 3 least privilege in the customer's account (iam.aws.a, 68f4b8b); sherpa.aws.a's simplest path (b1281ba); security.aws.a's first positions (84245b5). Presentation (docs/board/brief/vault-deploy-brief.html, https://claude.ai/artifact/8mmZoGebFozNJ8tPTkUFFf) and decision video (vault-deploy-video.html, https://claude.ai/artifact/K3qtZmcRkRcQVa2n7iyKdM), both private to Dinis. Before the first real customer (security.aws.a point 18, agreed by iam.aws.a): the server reads the Vault's access token from Secrets Manager at start-up, not from the function's configuration; that is for the server's owners (vaults design 04, section 8 question 3), not a decision for you. Nothing in this batch runs outside the twin until you answer; every real deploy stays a plan you approve. Numbered V1 to V10 so they do not clash with the decisions above.

### V1. Where the deploy page lives
- **Asks:** conductor.aws.a (plan D1)
- **Options:** (a) its own site, for example deploy.<domain>, an IaC request to aws.c and factory.c; (b) a tab of this hub.
- **Recommended:** (a), by security.aws.a and iam.aws.a (docs/iam/vault-deploy/01-least-privilege.md): checking the customer's Vault at https://<domain>/health needs the CSP to allow connections to any https host, which on this hub would undo the limit on where an injected script could send your sealed session (R-010). As a tab here, the page could only check DNS through one fixed resolver and link /health for the customer to open.
- **Blocks:** the page's address and the IaC request (plan step 15).

### V2. CloudFormation first, Terraform later
- **Asks:** conductor.aws.a (plan D2); recommended by cloudformation.aws.a and vaults.aws.a
- **Options:** (a) CloudFormation first; a Terraform module follows one-to-one once the template settles; (b) both from the start.
- **Recommended:** (a).
- **Blocks:** nothing on the twin; the scope of step 2.

### V3. How the customer signs in
- **Asks:** conductor.aws.a (plan D3); iam.aws.a, security.aws.a, vaults.aws.a and sherpa.aws.a agree
- **Options:** (a) the customer's own AWS console with a one-click quick-create link: no credential reaches our page, and the stack creates no role for us; (b) a role our page assumes. Never: a role in the customer's account that trusts ours. Sign-in inside the page may come later for reads and teardown, and only with the R-002 split.
- **Recommended:** (a). With it, sherpa's walk drops account id and sign-in: two choices (region with a default, an optional domain) and one button.
- **Blocks:** the page's shape (steps 5 and 6).

### V4. EC2 as a second deploy path
- **Asks:** conductor.aws.a (plan D4)
- **Options:** (a) now, alongside the CloudFormation path; (b) after the CloudFormation path works end to end on the twin.
- **Recommended:** (b), pm.aws.a's view: twin first, one path at a time; ec2.aws.a (V6) designs it meanwhile.
- **Blocks:** the timing of plan step 10's second path.

### V5. Guard rails for ephemeral deployments and the daily region move
- **Asks:** conductor.aws.a (plan D5); security.aws.a: nothing real on a schedule before this
- **Options:** (a) set the numbers now (maximum lifetime, regions allowed, cost cap, kill switch); (b) ec2.aws.a and billing.aws.a propose the numbers from the twin, and you approve them on a decision page before anything real runs.
- **Recommended:** (b): nobody has proposed numbers yet, and none would be grounded.
- **Blocks:** anything ephemeral outside the twin (step 11). cloudformation.aws.a adds: something must empty a bucket before delete, a scheduler role that can delete only stacks it tagged (O5).

### V6. Start a new agent, ec2.aws.a
- **Asks:** conductor.aws.a (plan D6); start prompt in docs/team/handover/ec2.aws.md
- **Options:** (a) yes, at your word in maestro.a's session; (b) not yet.
- **Recommended:** (a): EC2 control, the second path's design and the ephemeral design (steps 10 and 11) have no owner without it; twin only until V4 and V5.
- **Blocks:** steps 10 and 11.

### V7. How we read a customer's CloudTrail
- **Asks:** cloudtrail.aws.a (plan step 9)
- **Options:** (a) the customer's trail delivered to a bucket we can read; (b) a cross-account read role; (c) the customer drops their own trail export into the page, read in the browser only.
- **Recommended:** (c), pm.aws.a's view: no trust back to us and no credential, in line with V3 and security's "no role back to us"; (a) or (b) only if a customer asks for continuous monitoring.
- **Blocks:** the audit view of a deployment (step 9) for real customers; the twin goes ahead.

### V8. Live progress on our page while the stack deploys
- **Asks:** iam.aws.a (step 3), from sherpa.aws.a's open question
- **Options:** (a) none in the first version: the customer's console shows progress, and at the end the page checks DNS and https://<domain>/health (one paste of the address when there is no custom domain); (b) a read role in the customer's account trusting Google, limited to this stack's events: a sign-in step and a second trust ask.
- **Recommended:** (a), by iam.aws.a.
- **Blocks:** the page's last screen (step 5); the visualisation (step 7) runs on the twin either way.

### V9. Read access to sgit.ai's deploy templates
- **Asks:** vaults.aws.a and cloudformation.aws.a
- **What:** sgit.ai says official CloudFormation templates for Lambda (Function URL), Fargate and EC2 sit in its encrypted deploy vault (behind sgit.ai/deploy/). cloudformation.aws.a's draft cannot read them, so it may differ from them.
- **Options:** (a) give vaults.aws.a and cloudformation.aws.a read access (the vault's key, or a copy in a repository) and build from the Lambda template; (b) keep our own template.
- **Recommended:** (a). Pairs with decision 8 (the server's source).
- **Blocks:** step 2 following the official template, and O2 (whether the image runs on Lambda as it is).

### V10. Where the server image comes from
- **Asks:** cloudformation.aws.a (O1), for you and vaults.aws.a
- **What:** sgit.ai publishes diniscruz/sg-send-vault:v0.33.0 on Docker Hub; Lambda runs container images only from Amazon ECR, so the stack cannot point at Docker Hub.
- **Options:** (a) our own ECR repository granting pull to customer accounts (pull only, not a role back to us, but a dependency on our account); (b) an ECR pull-through cache in the customer's account (needs Docker Hub credentials there); (c) Fargate, which pulls from Docker Hub directly, with more resources and a load balancer; (d) a Lambda zip, if SG/Send publishes one.
- **Recommended:** follow what the official Lambda template does (V9); if it settles nothing, (a), pm.aws.a's view: no customer credential and no role back to us.
- **Blocks:** any real deploy (ImageUri is the one parameter the link must fill in); not the twin.

Recommended answers for batch 2: "V1 a, V2 a, V3 a, V4 b, V5 b, V6 a, V7 c, V8 a, V9 a, V10 a" (V10 a only if the official template settles nothing; pm.aws.a's view).

## Not needed yet
- **Which vault endpoint first** (vaults.aws.a): recommended, the twin now, then your own SG/Send in eu-west-2 (append routes exist only on dev.send.sgraph.ai today). Asked before any live vault write.
- **Who drains the snapshot lanes** (vaults.aws.a): recommended, the browser while you are signed in (no new credential anywhere), a GitHub Actions job later. Asked when the drain cadence is set (vaults design 01 section 4).
- **Which models scoped access may call (pipeline P7):** recommended, Amazon Bedrock models in your own account, through roles the site issues with budgets; anything outside AWS would need a server, which these sites do not have. Asked when P7 starts.
- **A GitHub Actions read-only inventory role** (aws.c): later, after security review.
- **Template v3** (aws.c): reads for the next areas; drafted by the architect and iam.aws.c, reviewed by security, then a plan for your Approve.

## Being answered by others (comes to you only if they cannot)
- Secure Send S3 API: is it the SG/Send server in S3 mode, where its code and deployment live, which clients and regions first. Asked of maestro.c, no answer yet (vaults.aws.a, 13:37 UTC). Meanwhile vaults.aws.a assumes yes and designs against the documented API; confirmed before any plan. Blocks OP-3 and vaults design 01 section 6.

## Answered
- The account A names in the site's policy (was 7): aws.c added all 22 .aws.a names at your yes (6ab7233 on dev). Agents still do not push to dev until their key is live on the Factory (decision 1): the deploy's signer check reads the Factory's live keys file, which lists no .aws.a key yet.
- Three account A agents' pushes (was 7): yes in iam.aws.a's and dev.1.aws.a's sessions (both branches pushed, signed); viz.aws.a pushed work/viz.aws.a unsigned at your word in its session (7495e89), so aws.c lands docs/viz/ under its own signature (conductor.aws.a, ~11:12 UTC). Still open in iam.aws.a's session: the Factory repository attached, for its key commit.
- The PM's wake (was 6): pm.aws.a's wake is every 6 h at :15, created by maestro.a at your word (~03:31 UTC, move to account A); no other schedule.
- The team commits its own folders: "Yes, to the team paths. So you can commit to their folders" (you, in aws.c's session, ~04:20 UTC); five agents added (c32279d), the rest by aws.c as they come.
- The first AWS agent keys: "Land the AWS keys" (you, in factory.c's session, ~03:25 UTC); pm.aws.c's key is live (885f150). Agents whose sessions reach only this repository send factory.c their signed commit to land byte for byte.
- The first packet to follow: one visitor loads a page on a Sovereign Website, "step by step, color-coded, really nicely, zoomed in, zoomed out" (you, here, ~03:35 UTC).
- Full stage 2 now; every AWS agent signs with its own sgit key (you, in conductor.aws.c's session, ~03:00 UTC). sherpa.aws.c (usability) and swarm.aws.c (the team as a graph) added at your word.
- Build on the twin first; "Try the twin" on every area; demo packs, scenarios, altitudes (memo part 4).
- Where the agents run: account C is hot (five-hour 60%, weekly 50%), so 16 AWS agents move to account A; conductor.aws.c has the list (you, in maestro.c's session, ~03:35 UTC).
- The engine: the bulletins repository renders and navigates and its characters already move; for moving, jumping and the like, viz.aws.c and swarm.aws.c build "something a bit more pragmatic" here (you, in maestro.c's session, ~03:35 UTC).
- Tests: "Yes to the agents changing tests. AWS site, that's fine." (aws.c's session, ~03:10 UTC); the hub's tests are in test/ (89d8698).
- The nine area sites: "Yes to the 9 areas" (aws.c's session, ~03:10 UTC).
- No budget cap; Opus with a bit of Sonnet; parallel agents where there is a bottleneck (you, here, ~03:05 UTC).
- Lean start (you, in maestro.c's session, ~02:55 UTC). Stack, regions, vault docs, consoles, key sites: memo part 2, section 13.
