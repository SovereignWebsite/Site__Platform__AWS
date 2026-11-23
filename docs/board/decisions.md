# Decisions for Dinis: AWS Platform

Kept by pm.aws.c. Updated 23 Nov 2026, 02:55 UTC. Every open question for Dinis from the aws.* agents, in one place, most urgent first. Answer by number in pm.aws.c's session (https://claude.ai/code/session_01Kw9UwBZAwm6766jrG94uX1), for example: "1 yes, 2 a, 3 a, 4 a, 5 yes, 6 b, 7 a, 8 yes".

## Waiting on you now

### 1. Agents may use their own signing key for git
- **Asks:** conductor.aws.c (for the whole team)
- **What:** each agent installs sgit-ai, makes its key, and writes its own signing half to a 0600 file in its session so git signs with it (the Factory's convention; your words of 20 Nov: "we don't need to protect keys with passphrases (for now)"). Some sessions refuse without your yes.
- **Options:** yes / no.
- **Recommended:** yes. pm.aws.c already signs this way.
- **Blocks:** conductor.aws.c, security.aws.c and every new agent publishing a key and signing commits. Where a session still asks, one "yes" in that session clears it (security.aws.c: https://claude.ai/code/session_01Kw9UwDzABFfbMk8PV34a7J).

### 2. The change role is account admin (security R-001, Critical)
- **Asks:** security.aws.c, first review (7 risks)
- **What:** sws-aws-platform-change has iam:*, so one step from admin of the account.
- **Options:** (a) aws.c writes a plan that cuts it to the actions the plans need, for your Approve on the site; (b) leave as is for now.
- **Recommended:** (a).
- **Blocks:** safe use of every change plan, including 4.

### 3. The AWS team in this site's policy
- **Asks:** aws.c and conductor.aws.c
- **What:** only the keeper (aws.c) may commit here. Add, docs only for now: docs/team/** (conductor), docs/board/** (pm), docs/security/** (security), docs/architecture/** (architect), docs/s3/** (s3). site/policy/** needs your yes.
- **Options:** (a) yes, docs paths only, aws.c adds each agent as it starts; (b) no, everything goes through aws.c.
- **Recommended:** (a).
- **Blocks:** this board, the risk list and the designs being committed by their own authors; aws.c is the bottleneck meanwhile.

### 4. The waiting stack plan
- **Asks:** aws.c
- **What:** on the site, Plans: the stack plan "Waiting for you". Only the template's description lines (your name removed).
- **Options:** (a) wait, and approve it together with the R-001 fix (2a); (b) approve now; (c) leave it.
- **Recommended:** (a). The change is safe, but R-001 is about the same role.
- **Blocks:** nothing else.

### 5. Agents may change test/** in the AWS sites
- **Asks:** aws.c
- **What:** .github/** (pipelines) stays yours, after security review.
- **Options:** yes / no.
- **Recommended:** yes.
- **Blocks:** the tests that already pass locally going into the repository; tested work from every builder.

### 6. When stage 2 starts
- **Asks:** conductor.aws.c
- **What:** lambda (with Firehose), iam, cloudformation (with Route 53), cloudtrail (with CloudWatch), vaults, boto3, design and UX, data, video. Stage 1 uses 38 of accountant.c's 40 wakes a day.
- **Options:** (a) now; (b) in 24 h, with accountant.c's measured figures; (c) a smaller set first (say which).
- **Recommended:** (b), the conductor's view: the cap is nearly reached and the figures are a day away.
- **Blocks:** areas 2 to 7, the consoles, vaults, extract workflow, videos.

### 7. The journalist now
- **Asks:** conductor.aws.c (maestro.c wants it first)
- **What:** journalist.aws.c at one wake every 6 h (4 a day; the cap rises to about 42), so documentation and the parity tracker run overnight.
- **Options:** (a) start it now; (b) first in stage 2.
- **Recommended:** (a).
- **Blocks:** documentation and the parity tracker (the PM seeds it meanwhile).

### 8. The PM's wake
- **Asks:** pm.aws.c
- **What:** at :15 every 6 hours (00:15, 06:15, 12:15, 18:15 UTC), the minute and interval conductor.aws.c gave within the budget. I collect every agent's questions and keep this page and the board current.
- **Options:** yes / another interval / no.
- **Recommended:** yes.
- **Blocks:** this page staying current between your visits.

## Not needed yet
- **The nine area sites** (aws.c): s3, lambda, iam, cloudformation, route53, cloudfront, firehose, cloudtrail, cloudwatch .aws.platform.sovereignweb.site. Recommended: yes, each made when its area's agent starts. Only S3's agent exists, so only S3 waits on it: answer "9 yes" if you want s3 made tonight.
- **A GitHub Actions read-only inventory role** (aws.c): later, after security review.
- **Template v3** (aws.c): reads for the next areas; drafted by the architect, reviewed by security, then a plan for your Approve.

## Being answered by others (comes to you only if they cannot)
- Secure Send S3 API: where its code and deployment live, which clients and regions first. With maestro.c and conductor.aws.c.

## Answered
- Lean start: conductor.aws.c and pm.aws.c now, the rest by the conductor (you, in maestro.c's session, ~02:55 UTC).
- Stack, regions, vault docs, consoles, key sites, schedule: memo part 2, section 13.
- (Added by aws.c at commit, 03:50 UTC.) Decision 5, tests: "Yes to the agents changing tests. AWS site, that's fine." (aws.c's session, ~03:10 UTC); the hub's tests are in test/. The nine area sites: "Yes to the 9 areas" (same message); factory.c's requests are on work/factory.c-aws-areas for your merge.
