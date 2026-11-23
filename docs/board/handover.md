# Hand-over: pm.aws.c to pm.aws.a

From pm.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~07:40 UTC. Adds to conductor.aws.c's docs/team/handover/pm.aws.md, which lists some decisions since answered. The board in this folder was last brought up to date at 04:05 UTC; everything after that is for pm.aws.a to fold in.

## Where things stand
- **The board:** tasks.json (40 tasks, every one owned, twin first, usability first), README.md (the phone view, regenerated from tasks.json), pipeline.md (P1 to P8 in Dinis's words), decisions.md (open questions for Dinis, most urgent first, answered by number in the PM's session).
- **Owners:** 16 roles moved to account A after 04:05; replace "<role>.aws.c (moving to <role>.aws.a)" with the .a names and their sessions from docs/team/schedule.json.
- **Account C hold (OPS-1):** in force at 04:05; close it or update it from conductor.aws.a.

## Open for Dinis at 04:05 (decisions.md numbering)
1. Landing agent keys: a standing word in factory.c's session (eight .c keys were verified and waiting), and cloudtrail's session reading the Factory. Re-check: the .a agents make new keys.
2. R-009 High: the deploy signer check can be bypassed (his .github/**).
3. R-010 High: team code on the hub's origin (recommended: review now, move as area sites arrive).
4. Approve template v2.1 on the site (R-001 fix).
5. Merge factory.c's nine area-site requests (work/factory.c-aws-areas).
6. The PM's wake (now pm.aws.a's: 6 h at :15 per maestro.c).

## Answered (do not ask again)
No budget cap; Opus with a bit of Sonnet; parallel agents. Full stage 2. Agents sign with their own sgit keys. Team docs paths (c32279d). Tests. The nine areas (yes; merge still his). Twin first, Try the twin, demo packs, altitudes (memo part 4). First packet: one visitor loads a page on a Sovereign Website, step by step, colour-coded, zoom in and out. The engine: the bulletins repository's characters, plus "something a bit more pragmatic" built here by viz and swarm. Accounts: the long-running roles on A.

## How I worked
- Questions reach the PM from every agent by message; one batch per wake, committed under docs/board/**.
- Recommendations always given; a relayed yes is not counted where the target session needs Dinis himself (aws.c's oversight changes, factory.c's pushes).
- Before pushing: the pipeline's signer check locally (node, .github/ci/signers.mjs) so a refused commit never blocks aws.c's deploys.

pm.aws.c never created a scheduled wake (Dinis had not said yes), so there is none to turn off. This session goes idle.
