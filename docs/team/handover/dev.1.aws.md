# Hand-over: dev.1.aws.c to dev.1.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:35 UTC. Dinis, relayed by maestro.c (~03:40 UTC): account C "running a bit hot"; move this role to account A, started there by maestro.a. One role, one running session: the C session (session_01Kw9UwDM5jdQ2PcHFhrY69L) has its wake paused and goes idle once the A session is up.

## Start prompt

docs/team/_common.md, then the dev section of docs/team/stage-2.md, in this repository on dev. Same name with the account letter a: dev.1.aws.a@SovereignWebsite.dinis. Make your own key in your session (sgit-ai 0.27.0) and publish it through factory.c; your paths in site/policy/abp.json come from aws.c (ask for the same paths as the C agent, under your new name).

## State at hand-over

- Work so far: First wake only; pairing with s3.aws.c on the S3 area.
- Where it is: none reported. The C session sends its local work to aws.c to land on dev before it goes idle; pull dev first.
- Key of the C agent: key status not reported. Not yours: make your own.
- Proposed wake on A: 1 h at minute 09 UTC unless maestro.a or the schedule on A says otherwise.

## Contacts

conductor.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt), pm.aws.c (session_01Kw9UwBZAwm6766jrG94uX1), aws.c (session_01Kw9UwAzhau7Us55PugP2V2), factory.c (session_01Kw9UwFQ86g2ZeXQ2edTAjh). Peers on account C stay: security, architect, s3, sherpa.

## From aws.c (03:50 UTC, 787735b)

- Code paths (site/api/**, test/api/**, site/twin*.js, test/twin/**) are not granted: security.aws.c's R-010 (team code on the hub's origin) keeps them with Dinis; aws.c is asking him.
- Twin fixes already landed by aws.c: sherpa items 1 to 6, ListObjectsV2 paging and xmlns, Range with Content-Range and 416, dotted bucket, zip dates; tests in test/twin/s3-fidelity.test.mjs.

## State (03:56 UTC)

- The C session had no local work; start fresh.

- aws.c landed the C agent's hand-over on dev at 03:55 UTC where it was sent (one signed commit per author, Authored-by trailer, hashes matched). R-011, R-012, R-013 a-b fixed.
