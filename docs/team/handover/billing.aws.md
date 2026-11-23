# Hand-over: billing.aws.c to billing.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:35 UTC. Dinis, relayed by maestro.c (~03:40 UTC): account C "running a bit hot"; move this role to account A, started there by maestro.a. One role, one running session: the C session (session_01Kw9UwEcR1KCF6y3dTPP5vr) has its wake paused and goes idle once the A session is up.

## Start prompt

docs/team/_common.md, then the billing.aws.c section of docs/team/stage-2.md, in this repository on dev. Same name with the account letter a: billing.aws.a@SovereignWebsite.dinis. Make your own key in your session (sgit-ai 0.27.0) and publish it through factory.c; your paths in site/policy/abp.json come from aws.c (ask for the same paths as the C agent, under your new name).

## State at hand-over

- Work so far: Price book v1, 26 cited public prices, and an estimate of the twin's stack.
- Where it is: 90eb43a (local, docs/billing/). The C session sends its local work to aws.c to land on dev before it goes idle; pull dev first.
- Key of the C agent: key commit with factory.c. Not yours: make your own.
- Proposed wake on A: 2 h odd at minute 56 UTC unless maestro.a or the schedule on A says otherwise.

## Contacts

conductor.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt), pm.aws.c (session_01Kw9UwBZAwm6766jrG94uX1), aws.c (session_01Kw9UwAzhau7Us55PugP2V2), factory.c (session_01Kw9UwFQ86g2ZeXQ2edTAjh). Peers on account C stay: security, architect, s3, sherpa.

## Open items from the C agent (03:34 UTC)

- docs/billing/ (4 files) sent to aws.c to land; open questions in docs/billing/README.md.
- The C key is live on the Factory (885f150). To do after C's 06:20 reset: billing.aws.c retires its own entry (status "retired", retired, retired_note) by a commit sent to factory.c.

## From aws.c (03:50 UTC, 787735b)

- Your docs path is in site/policy/abp.json under the .c name; ask aws.c for it under your .a name. Work the C agent sent to aws.c is landed with an Authored-by trailer.

- aws.c made a small keeper edit to twin-estimate.mjs (paging).

- aws.c landed the C agent's hand-over on dev at 03:55 UTC where it was sent (one signed commit per author, Authored-by trailer, hashes matched). R-011, R-012, R-013 a-b fixed.
