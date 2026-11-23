# Decisions for Dinis: AWS Platform

Kept by pm.aws.c. Updated 23 Nov 2026, 03:10 UTC. Every open question for Dinis from the aws.* agents, in one place, most urgent first. Answer by number in pm.aws.c's session (https://claude.ai/code/session_01Kw9UwBZAwm6766jrG94uX1), for example: "1 yes, 2 a, 3 a, 4 a, 5 yes, 6 a".

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
- **Update (aws.c, 04:00 UTC):** written as template v2.1 (d67b560); waiting for security.aws.c's review, then your Approve on the site together with 4.

### 3. The AWS team in this site's policy
- **Asks:** aws.c and conductor.aws.c
- **What:** only the keeper (aws.c) may commit here. Add, docs only for now: docs/team/** (conductor), docs/board/** (pm), docs/security/** (security), docs/architecture/** (architect), docs/s3/** (s3). site/policy/** needs your yes.
- **Options:** (a) yes, docs paths only, aws.c adds each agent as it starts; (b) no, everything goes through aws.c.
- **Recommended:** (a).
- **Blocks:** this board, the risk list and the designs being committed by their own authors; aws.c is the bottleneck meanwhile.
- **Update (aws.c, 04:00 UTC):** a change to who may commit is a change to oversight, so aws.c needs your yes in its own session (https://claude.ai/code/session_01Kw9UwAzhau7Us55PugP2V2); a relayed yes was refused there. architect.aws.c reports your yes for docs/architecture/** in its session.

### 4. The waiting stack plan
- **Asks:** aws.c
- **What:** on the site, Plans: the stack plan "Waiting for you". Now template v2.1: the R-001 fix (2) and the description change.
- **Options:** (a) approve after security.aws.c has reviewed v2.1; (b) approve now; (c) leave it.
- **Recommended:** (a).
- **Blocks:** nothing else.

### 5. The PM's wake
- **Asks:** pm.aws.c
- **What:** a scheduled wake to collect every agent's questions and keep this page, the board and the pipeline current. conductor.aws.c gave :15 every 6 h when budget was the limit; with no cap, every 2 h at :15.
- **Options:** (a) every 2 h at :15; (b) every 6 h at :15; (c) no.
- **Recommended:** (a).
- **Blocks:** this page staying current between your visits.

## Not needed yet
- **Which models scoped access may call (pipeline P7)**: recommended, Amazon Bedrock models in your own account, through roles the site issues with budgets; anything outside AWS would need a server, which these sites do not have. Asked when P7 starts, after the IAM area and security review.
- **A GitHub Actions read-only inventory role** (aws.c): later, after security review.
- **Template v3** (aws.c): reads for the next areas; drafted by the architect, reviewed by security, then a plan for your Approve.

## Being answered by others (comes to you only if they cannot)
- Where the team's characters and game engine live, for "follow the packet" (pipeline P1). With maestro.c.
- Which of the other accounts take AWS work, and which agents go where. With maestro.c and conductor.aws.c.
- Secure Send S3 API: where its code and deployment live, which clients and regions first. With maestro.c and conductor.aws.c.

## Answered
- Tests: "Yes to the agents changing tests. AWS site, that's fine." (aws.c's session, ~03:10 UTC); the hub's tests are in test/ (89d8698).
- The nine area sites: "Yes to the 9 areas" (aws.c's session, ~03:10 UTC); factory.c's requests are on work/factory.c-aws-areas for your merge.
- No budget cap for this programme; Opus with a bit of Sonnet; several agents of one role where there is a bottleneck (you, in pm.aws.c's session, ~03:05 UTC). So: stage 2 starts now, and the journalist starts now. The new projects are in pipeline.md.
- Lean start: conductor.aws.c and pm.aws.c now, the rest by the conductor (you, in maestro.c's session, ~02:55 UTC).
- Stack, regions, vault docs, consoles, key sites, schedule: memo part 2, section 13.
