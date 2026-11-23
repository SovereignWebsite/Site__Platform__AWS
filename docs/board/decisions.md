# Decisions for Dinis: AWS Platform

Kept by pm.aws.a (took over from pm.aws.c on account A, 23 Nov 07:30 UTC). Updated 23 Nov 2026, 08:30 UTC. Every open question for Dinis from the aws.* agents, in one place, most urgent first. Answer by number in pm.aws.a's session (https://claude.ai/code/session_018yvwtLfieUut6hSirZ6W9B), for example: "1 a, 2 a, 3 c, 4 a, 5 a, 6 a, 7 a".

Nothing here stops the team: the agents are building on the twin. Decision 3 holds dev.2.aws.a's code (site/api/**, test/api/**) on its branch.

## Waiting on you now

### 1. The agents publish their keys
- **Asks:** factory.c and cloudtrail.aws.c
- **What:** factory.c has eight agents' signed key commits verified and waiting as one landing (lambda, dev.2, video, journalist, boto3, cloudformation, data .aws.c, and owasp.c), but its session asks your word for every push. cloudtrail.aws.c's session refuses even reading the Factory, so it cannot prepare its commit.
- **Options:** (a) a standing word in factory.c's session (https://claude.ai/code/session_01Kw9UwFQ86g2ZeXQ2edTAjh): "land every verified agent key commit"; plus yes in cloudtrail.aws.c's session (https://claude.ai/code/session_01Kw9UwCr3jpB8Chr1HszjPD) to read the Factory; (b) a word per landing, as now.
- **Recommended:** (a). Twenty more keys are coming tonight.
- **Blocks:** those agents' commits being checked as signed, and anything they push.

### 2. Security R-009 (High): the deploy's signer check can be bypassed
- **Asks:** security.aws.c (03:28 review), through conductor.aws.c
- **What:** anyone who can push to dev can get past the check: an "Owner override:" line in a commit, GitHub-verified web commits, and the checker running from the very commit it checks. Fixing it changes .github/**, which is yours.
- **Options:** (a) run the checker from main or a pinned commit, and drop the override line; (b) leave as is for now.
- **Recommended:** (a), first of the two.
- **Blocks:** trust in what deploys from dev, with 22 agents now pushing.

### 3. Security R-010 (High): team code on the hub's own origin
- **Asks:** security.aws.c, through conductor.aws.c
- **What:** the team's paths include pages on the hub's origin (pm: site/decisions/; architect: site/api/; s3: site/s3.js). A page there runs where the change role's session lives, so a bad change could reach it.
- **Options:** (a) keep the code paths, and security.aws.c reviews every site/ change before it deploys; (b) move team pages off the hub's origin (their own area sites); (c) both: review now, move as the area sites arrive.
- **Recommended:** (c).
- **Blocks:** safe team code on the hub; the decisions page on the site waits on this.

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
- **Asks:** iam.aws.a (P-IAM-001), through conductor.aws.a; cleared by security.aws.a
- **What:** even after v2.1, a script in the page can make the change role admin through a change set (R-008). iam.aws.a's v2.3 (c06d979, local to iam.aws.a: its branch push waits on decision 7) adds permissions boundaries that mirror today's scopes, with a custom read boundary. security.aws.a cleared v2.3 on paper (47b48c3 on work/security.aws.a), after finding three gaps in v2.2 (a1d2057) that v2.3 fixes.
- **Options:** (a) one apply in the AWS console of v2.1 plus the v2.3 boundaries, on three conditions: (1) the same apply bounds sovereignwebsite-factory-dns or makes its trust console-only, else R-005 keeps R-008 open; (2) iam.aws.a first finishes its two checks (read-boundary coverage, UpdateRole behaviour); (3) the first apply is your own act in the console; (b) v2.1 through the page now (decision 4), boundaries later; (c) no boundary, rely on splitting off the change page (R-002).
- **Recommended:** (a) with its three conditions (iam.aws.a and security.aws.a agree). If (a), decision 4 folds into it. R-008 stays Open until applied.
- **Blocks:** R-008 closing. A change to AWS, so yours.

### 7. Two account A agents cannot push their branches
- **Asks:** iam.aws.a and dev.1.aws.a, through conductor.aws.a
- **What:** each session refuses to push its work/<role>.aws.a branch (iam.aws.a also cannot reach the Factory) until you allow it in that session. Their work stays local until then.
- **Options:** (a) say yes in iam.aws.a's session (https://claude.ai/code/session_018yvwtLi5HNUo32ot6ApGm8) and in dev.1.aws.a's session; (b) leave it.
- **Recommended:** (a). Pushing a work branch is not dev or main.
- **Blocks:** the v2.2 draft reaching security review, and dev.1.aws.a's work.

## Not needed yet
- **Which models scoped access may call (pipeline P7):** recommended, Amazon Bedrock models in your own account, through roles the site issues with budgets; anything outside AWS would need a server, which these sites do not have. Asked when P7 starts.
- **A GitHub Actions read-only inventory role** (aws.c): later, after security review.
- **Template v3** (aws.c): reads for the next areas; drafted by the architect and iam.aws.c, reviewed by security, then a plan for your Approve.

## Being answered by others (comes to you only if they cannot)
- Secure Send S3 API: where its code and deployment live, which clients and regions first. vaults.aws.c with maestro.c.

## Answered
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
