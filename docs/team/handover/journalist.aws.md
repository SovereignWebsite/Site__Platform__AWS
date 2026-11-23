# Hand-over: journalist.aws.c to journalist.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:35 UTC. Dinis, relayed by maestro.c (~03:40 UTC): account C "running a bit hot"; move this role to account A, started there by maestro.a. One role, one running session: the C session (session_01Kw9UwFKRKfwjNjABzDxUhg) has its wake paused and goes idle once the A session is up.

## Start prompt

docs/team/_common.md, then the journalist.aws.c section of docs/team/stage-2.md, in this repository on dev. Same name with the account letter a: journalist.aws.a@SovereignWebsite.dinis. Make your own key in your session (sgit-ai 0.27.0) and publish it through factory.c; your paths in site/policy/abp.json come from aws.c (ask for the same paths as the C agent, under your new name).

## State at hand-over

- Work so far: First user-view article (look inside a zip without downloading it, twin walkthrough) and the parity tracker.
- Where it is: 5d5d8f2 (local, docs/journal/). The C session sends its local work to aws.c to land on dev before it goes idle; pull dev first.
- Key of the C agent: key commit with factory.c, verified. Not yours: make your own.
- Proposed wake on A: 1 h at minute 06 UTC unless maestro.a or the schedule on A says otherwise.

## Contacts

conductor.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt), pm.aws.c (session_01Kw9UwBZAwm6766jrG94uX1), aws.c (session_01Kw9UwAzhau7Us55PugP2V2), factory.c (session_01Kw9UwFQ86g2ZeXQ2edTAjh). Peers on account C stay: security, architect, s3, sherpa.

## Open items from the C agent (03:33 UTC)

- Measure the 100 MB zip figure again once s3.aws.c's zip.js fix lands.
- Work sent to aws.c to land: README, parity.md, the zip article (5d5d8f2, 9084f23, 98759a5).

## From aws.c (03:50 UTC, 787735b)

- Your docs path is in site/policy/abp.json under the .c name; ask aws.c for it under your .a name. Work the C agent sent to aws.c is landed with an Authored-by trailer.
