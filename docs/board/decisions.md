# Decisions for Dinis: AWS Platform

Kept by pm.aws.a (took over from pm.aws.c on account A, 23 Nov 07:30 UTC). Updated 23 Nov 2026, 12:20 UTC. Every open question for Dinis from the aws.* agents, in one place, most urgent first. Answer by number in pm.aws.a's session (https://claude.ai/code/session_018yvwtLfieUut6hSirZ6W9B), for example: "1 a, 2 a, 3 c, 4 a, 5 a, 6 a, 7 a".

This batch as a presentation (docs/board/brief/decisions-brief.html, https://claude.ai/artifact/Vpk7NnqQ3sz9MgkC2aDmVP) and a decision video in the studio's format (docs/board/brief/decision-video.html, https://claude.ai/artifact/FEaZ96X1APbEPmke5J6ido); both private to Dinis.

Nothing here stops the team: the agents are building on the twin. Decision 3 holds dev.2.aws.a's code (site/api/**, test/api/**) on its branch.

## Waiting on you now

### 1. The agents publish their keys
- **Asks:** factory.c (account C), for the account A agents
- **What:** 20 account A agents have each prepared a signed commit adding their key to the Factory's team/keys.json (all on Factory dev 885f150), as docs/team/keys/<role>.aws.a.iac-commit.txt on their work branches: architect, billing, boto3, cloudformation, cloudtrail, conductor, data, dev.1, dev.2, journalist, lambda, ontology, pm, s3, security, sherpa, swarm, ux, vaults, video. None has landed: Factory dev (02cab38) lists no .aws.a key, and factory.c's session asks your word for every push. Not yet prepared: iam.aws.a (needs the Factory attached in its session) and viz.aws.a (its session cannot make a signing key). The earlier eight .aws.c commits are moot: those roles moved to account A.
- **Options:** (a) a standing word in factory.c's session (https://claude.ai/code/session_01Kw9UwFQ86g2ZeXQ2edTAjh): "land every verified agent key commit"; (b) a word per landing, as now.
- **Recommended:** (a). factory.c rebuilds each commit byte for byte and runs the five checks before it lands; your word adds a wait, not a check.
- **Blocks:** every account A agent's commits being checked as signed on dev.

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
- **Status: ready.** iam.aws.a's v2.5 (ee7f7b9 on work/iam.aws.a) adds the 13 IAM, Lambda and Firehose reads dev.2.aws.a's API layer needs; security.aws.a cleared it on paper (ba0afa0, replacing v2.4's clearance).
- **One thing to weigh:** with v2.5 the read role can read Lambda environment variables (GetFunctionConfiguration), so any secret kept there becomes readable from the page. Accept it, and keep secrets in Secrets Manager or SSM rather than in function environments.
- **Asks:** iam.aws.a (P-IAM-001), through conductor.aws.a; cleared by security.aws.a
- **What:** even after v2.1, a script in the page can make the change role admin through a change set (R-008). iam.aws.a's draft, now v2.5 (ee7f7b9 on work/iam.aws.a; v2.4 2107fe5, v2.3 2b8ceab), adds permissions boundaries that mirror today's scopes, with a custom read boundary. security.aws.a cleared v2.5 on paper (ba0afa0 on work/security.aws.a; v2.4 0cfa69f; v2.3 47b48c3, after three gaps in v2.2, a1d2057), and the DNS condition is met inside it.
- **Before and after the apply:** no open security condition left (security.aws.a, 12:18 UTC): v2.5 keeps its Deny on iam:UpdateRole, since a failure there is loud and recoverable in the console while dropping it would allow a silent 12-hour session. Right after your apply, one harmless tag change set on the read role confirms it, with you watching the stack events. The first apply is your own act in the console.
- **Options:** (a) one console apply of v2.5: both boundaries, and console-only trust for sovereignwebsite-factory-dns (the change role loses GetRole and UpdateAssumeRolePolicy on it); aws.c retires the two DNS-trust plans in site/plans/ in the same release; (b) not recommended by iam.aws.a or security.aws.a: as (a) but keep DNS trust edits from the page, which leaves R-005 open, since whoever controls that role's trust controls the site's name; (c) v2.1 through the page now (decision 4), boundaries later; (d) no boundary, rely on splitting off the change page (R-002).
- **Recommended:** (a), by iam.aws.a and security.aws.a (4b7271d on work/security.aws.a): remove TheDnsRoleTrustPolicy from the change role and its boundary in the same apply. A boundary on the DNS role would not make (b) safe, since that role's own rights (the Factory's docs/aws-oidc.md) can repoint the site's CNAME. DNS-trust edits are rare. If (a) or (b), decision 4 folds into it. R-008 stays Open until applied.
- **Blocks:** R-008 closing. A change to AWS, so yours.

### 7. The account A names in the site's policy, in one word
- **Asks:** conductor.aws.a (and pm.aws.a, whose board waits on it)
- **What:** an agent can land on dev only once its name is in site/policy/abp.json, which needs your yes. data.aws.a's landed at your word in its session (518b114, with its own work). The other 21 .aws.a names still wait, each with the same paths as its .c name (docs/team/schedule.json maps .c to .a), so their work piles up on branches.
- **Options:** (a) one yes in aws.c's session (https://claude.ai/code/session_01Kw9UwAzhau7Us55PugP2V2): "add all 21 .aws.a names, each with its .c name's paths"; (b) a yes per agent, as for data.aws.a.
- **Recommended:** (a). The paths are the ones you already said yes to (c32279d); only the names change.
- **Blocks:** 21 agents landing on dev, this board among them.

## Not needed yet
- **Which models scoped access may call (pipeline P7):** recommended, Amazon Bedrock models in your own account, through roles the site issues with budgets; anything outside AWS would need a server, which these sites do not have. Asked when P7 starts.
- **A GitHub Actions read-only inventory role** (aws.c): later, after security review.
- **Template v3** (aws.c): reads for the next areas; drafted by the architect and iam.aws.c, reviewed by security, then a plan for your Approve.

## Being answered by others (comes to you only if they cannot)
- Secure Send S3 API: where its code and deployment live, which clients and regions first. vaults.aws.c with maestro.c.

## Answered
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
