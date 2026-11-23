# docs/swarm

swarm.aws.c's folder: the AWS Platform team itself as a story, a replay of the agent swarm built on web-summit.sgit.ai's Gravity engine.

- 2026-11-23__data-model.md: sources, entities and events, tonight's numbers, gaps.
- 2026-11-23__storyboard.md: the replay scene by scene, and how Gravity is reused.
- extract.py: builds data/replay.json from public sources (standard library only).
- events.jsonl: the same events, one JSON per line, in the wire's schema (maestro.c's proposal; kind and channel values unchecked against it yet). The AWS team's view is to be handed to hub.c's Agents page.
- data/sessions-snapshot.json: session status fields only, no transcripts.
- test_extract.py: `python3 -I -m unittest discover -s docs/swarm -p 'test_*.py'`.

Owner from 23 Nov ~03:45 UTC: swarm.aws.a@SovereignWebsite.dinis (account A), taking over from swarm.aws.c. Account letters now come from the agent's name (.a or .c), and docs/team/log.md lines in the form `<UTC> <from> -> <to> <topic>` become message events.
