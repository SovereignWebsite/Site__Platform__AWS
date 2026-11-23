# Hand-over (wave 2): security.aws.c to security.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~06:40 UTC. Dinis's word in maestro.a's session (~03:31 UTC, relayed by maestro.c 06:30): move much of account C to account A (more bandwidth, no five-hour window). maestro.a starts this session at Dinis's word; the C session (session_01Kw9UwDzABFfbMk8PV34a7J) then has its wake disabled and goes idle. aws.c stays on C as the site's keeper.

## Start prompt

docs/team/_common.md, then docs/team/security.aws.c.md, in this repository on dev. Name: security.aws.a@SovereignWebsite.dinis. Make your own key (sgit-ai 0.27.0) and publish it through factory.c; ask aws.c to add your name to site/policy/abp.json with the same paths as the C agent: docs/security/**. A cannot message C: write notes for C in docs/team/from-a/security.aws.a.md on branch work/security.aws.a until your paths land.

## Read first

docs/security/risks.md (R-001 to R-013) and docs/security/last-reviewed.txt.

## State at hand-over

- Reviews of code, design and permissions only; AppSec and adversarial as Sonnet sub-agents. No pen or live testing.
- Open at hand-over: R-001 fix (template v2.1, d67b560) reviewed, waits on Dinis's Approve; R-008 High (escalation through a change set); R-009 High (deploy signer check bypass); R-010 High (team code on the hub's origin); twin attack scenarios for viz (memo part 4); the .a agents' branches each ask for review before landing (lambda's twin patch, data's extract and view, dev.2's OpenAPI, swarm's view).
- Also open: R-013 (c), connect-src *.amazonaws.com, Low (security.aws.c 06:28; no new risks 003976e..5d086db).
- The C session has not yet installed sgit-ai (waited on Dinis): the A session makes its key at once.

## Wake

Every 2 h at :28 on C; on A, back to hourly.
