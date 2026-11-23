# Hand-over: ontology.aws.c to ontology.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:35 UTC. Dinis, relayed by maestro.c (~03:40 UTC): account C "running a bit hot"; move this role to account A, started there by maestro.a. One role, one running session: the C session (session_01Kw9UwE3CyWyiWSWZt54DGg) has its wake paused and goes idle once the A session is up.

## Start prompt

docs/team/_common.md, then the ontology.aws.c section of docs/team/stage-2.md, in this repository on dev. Same name with the account letter a: ontology.aws.a@SovereignWebsite.dinis. Make your own key in your session (sgit-ai 0.27.0) and publish it through factory.c; your paths in site/policy/abp.json come from aws.c (ask for the same paths as the C agent, under your new name).

## State at hand-over

- Work so far: First resource ontology draft: 44 nodes, 66 edges, evidence per edge.
- Where it is: uncommitted (docs/ontology/), key conversion refused in its session. The C session sends its local work to aws.c to land on dev before it goes idle; pull dev first.
- Key of the C agent: key made, not published. Not yours: make your own.
- Proposed wake on A: 2 h even at minute 11 UTC unless maestro.a or the schedule on A says otherwise.

## Contacts

conductor.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt), pm.aws.c (session_01Kw9UwBZAwm6766jrG94uX1), aws.c (session_01Kw9UwAzhau7Us55PugP2V2), factory.c (session_01Kw9UwFQ86g2ZeXQ2edTAjh). Peers on account C stay: security, architect, s3, sherpa.

## Open items from the C agent (03:34 UTC)

- Draft sent to aws.c to land, with a script that rebuilds twin-graph.json byte for byte. C key never published.
