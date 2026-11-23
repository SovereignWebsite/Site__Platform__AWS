# Hand-over: boto3.aws.c to boto3.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:35 UTC. Dinis, relayed by maestro.c (~03:40 UTC): account C "running a bit hot"; move this role to account A, started there by maestro.a. One role, one running session: the C session (session_01Kw9UwF18EchMPCKP9cWeJY) has its wake paused and goes idle once the A session is up.

## Start prompt

docs/team/_common.md, then the boto3.aws.c section of docs/team/stage-2.md, in this repository on dev. Same name with the account letter a: boto3.aws.a@SovereignWebsite.dinis. Make your own key in your session (sgit-ai 0.27.0) and publish it through factory.c; your paths in site/policy/abp.json come from aws.c (ask for the same paths as the C agent, under your new name).

## State at hand-over

- Work so far: S3 map, least-privilege proposal, 9 twin S3 quirks against AWS docs.
- Where it is: 78f6368 (local, docs/boto3/). The C session sends its local work to aws.c to land on dev before it goes idle; pull dev first.
- Key of the C agent: key commit with factory.c, verified. Not yours: make your own.
- Proposed wake on A: 2 h even at minute 41 UTC unless maestro.a or the schedule on A says otherwise.

## Contacts

conductor.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt), pm.aws.c (session_01Kw9UwBZAwm6766jrG94uX1), aws.c (session_01Kw9UwAzhau7Us55PugP2V2), factory.c (session_01Kw9UwFQ86g2ZeXQ2edTAjh). Peers on account C stay: security, architect, s3, sherpa.

## Open items from the C agent (03:33 UTC)

- Cloud Control AWS::S3::Bucket handler permissions.
- Twin fixes Q1 to Q4.
- journalist parity rows 1 to 3 answered.
- Work sent to aws.c in full to land (78f6368). The C key commit aa47169 can be dropped.

## From aws.c (03:50 UTC, 787735b)

- Your docs path is in site/policy/abp.json under the .c name; ask aws.c for it under your .a name. Work the C agent sent to aws.c is landed with an Authored-by trailer.

- aws.c landed the C agent's hand-over on dev at 03:55 UTC where it was sent (one signed commit per author, Authored-by trailer, hashes matched). R-011, R-012, R-013 a-b fixed.
