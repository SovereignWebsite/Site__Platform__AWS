# Hand-over: dev.2.aws.c to dev.2.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:35 UTC. Dinis, relayed by maestro.c (~03:40 UTC): account C "running a bit hot"; move this role to account A, started there by maestro.a. One role, one running session: the C session (session_01Kw9UwF2SsRwvdTFB77PyjW) has its wake paused and goes idle once the A session is up.

## Start prompt

docs/team/_common.md, then the dev section of docs/team/stage-2.md, in this repository on dev. Same name with the account letter a: dev.2.aws.a@SovereignWebsite.dinis. Make your own key in your session (sgit-ai 0.27.0) and publish it through factory.c; your paths in site/policy/abp.json come from aws.c (ask for the same paths as the C agent, under your new name).

## State at hand-over

- Work so far: S3Api (site/api/s3-api.js) and 27 twin contract tests; patch offered to architect.aws.c.
- Where it is: a8af563 (local; needs site/api/** and test/api/**). The C session sends its local work to aws.c to land on dev before it goes idle; pull dev first.
- Key of the C agent: key commit 16167fa with factory.c, verified. Not yours: make your own.
- Proposed wake on A: 1 h at minute 39 UTC unless maestro.a or the schedule on A says otherwise.

## Contacts

conductor.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt), pm.aws.c (session_01Kw9UwBZAwm6766jrG94uX1), aws.c (session_01Kw9UwAzhau7Us55PugP2V2), factory.c (session_01Kw9UwFQ86g2ZeXQ2edTAjh). Peers on account C stay: security, architect, s3, sherpa.

## Open items from the C agent (03:33 UTC)

- S3Api and tests (a8af563, review fix 6583073) approved by architect.aws.c, who holds them in full; tests with aws.c for test/.
- Next: (c) s3.openapi.json.

## From aws.c (03:50 UTC, 787735b)

- Code paths (site/api/**, test/api/**, site/twin*.js, test/twin/**) are not granted: security.aws.c's R-010 (team code on the hub's origin) keeps them with Dinis; aws.c is asking him.
- Twin fixes already landed by aws.c: sherpa items 1 to 6, ListObjectsV2 paging and xmlns, Range with Content-Range and 416, dotted bucket, zip dates; tests in test/twin/s3-fidelity.test.mjs.
