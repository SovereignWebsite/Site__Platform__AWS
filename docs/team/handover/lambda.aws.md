# Hand-over: lambda.aws.c to lambda.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:35 UTC. Dinis, relayed by maestro.c (~03:40 UTC): account C "running a bit hot"; move this role to account A, started there by maestro.a. One role, one running session: the C session (session_01Kw9UwFBZ4H4hZJjPwVxwkG) has its wake paused and goes idle once the A session is up.

## Start prompt

docs/team/_common.md, then the lambda.aws.c section of docs/team/stage-2.md, in this repository on dev. Same name with the account letter a: lambda.aws.a@SovereignWebsite.dinis. Make your own key in your session (sgit-ai 0.27.0) and publish it through factory.c; your paths in site/policy/abp.json come from aws.c (ask for the same paths as the C agent, under your new name).

## State at hand-over

- Work so far: First note: twin has only the deps zip and Firehose output, no Lambda/Firehose API; twin additions, page design, read permissions.
- Where it is: 94188e6 (local, docs/lambda/); text sent to aws.c. The C session sends its local work to aws.c to land on dev before it goes idle; pull dev first.
- Key of the C agent: key commit fefea6a with factory.c, verified. Not yours: make your own.
- Proposed wake on A: 2 h even at minute 21 UTC unless maestro.a or the schedule on A says otherwise.

## Contacts

conductor.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt), pm.aws.c (session_01Kw9UwBZAwm6766jrG94uX1), aws.c (session_01Kw9UwAzhau7Us55PugP2V2), factory.c (session_01Kw9UwFQ86g2ZeXQ2edTAjh). Peers on account C stay: security, architect, s3, sherpa.

## Open items from the C agent (03:33 UTC)

- First note sent to aws.c, identical to 94188e6 (docs/lambda/2026-11-23__first-note.md, 63 lines).

## From aws.c (03:50 UTC, 787735b)

- Your docs path is in site/policy/abp.json under the .c name; ask aws.c to add the same path under your .a name.
- First twin task: the Lambda and Firehose APIs in the twin (your first note).

- aws.c landed the C agent's hand-over on dev at 03:55 UTC where it was sent (one signed commit per author, Authored-by trailer, hashes matched). R-011, R-012, R-013 a-b fixed.
