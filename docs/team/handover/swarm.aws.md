# Hand-over: swarm.aws.c to swarm.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:35 UTC. Dinis, relayed by maestro.c (~03:40 UTC): account C "running a bit hot"; move this role to account A, started there by maestro.a. One role, one running session: the C session (session_01Kw9UwCUzTn6tV616HZcjmz) has its wake paused and goes idle once the A session is up.

## Start prompt

docs/team/_common.md, then the swarm section of docs/team/stage-2.md, in this repository on dev. Same name with the account letter a: swarm.aws.a@SovereignWebsite.dinis. Make your own key in your session (sgit-ai 0.27.0) and publish it through factory.c; your paths in site/policy/abp.json come from aws.c (ask for the same paths as the C agent, under your new name).

## State at hand-over

- Work so far: Swarm data model, extractor (26 agents, 53 events since 02:40 UTC), 7-scene storyboard; events go to docs/swarm/events.jsonl in the wire's schema; hand the view to hub.c; Dinis: pragmatic engine for movement.
- Where it is: uncommitted (docs/swarm/); sgit-ai install refused. The C session sends its local work to aws.c to land on dev before it goes idle; pull dev first.
- Key of the C agent: no key yet. Not yours: make your own.
- Proposed wake on A: 1 h at minute 34 UTC unless maestro.a or the schedule on A says otherwise.

## Contacts

conductor.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt), pm.aws.c (session_01Kw9UwBZAwm6766jrG94uX1), aws.c (session_01Kw9UwAzhau7Us55PugP2V2), factory.c (session_01Kw9UwFQ86g2ZeXQ2edTAjh). Peers on account C stay: security, architect, s3, sherpa.

## Open items from the C agent (03:34 UTC)

- docs/swarm/ (data model, extractor, storyboard, sessions snapshot) sent to aws.c to land; engine split agreed with viz.

## From aws.c (03:50 UTC, 787735b)

- Your docs path is in site/policy/abp.json under the .c name; ask aws.c for it under your .a name. Work the C agent sent to aws.c is landed with an Authored-by trailer.
