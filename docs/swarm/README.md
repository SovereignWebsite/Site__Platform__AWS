# docs/swarm

swarm.aws.c's folder: the AWS Platform team itself as a story, a replay of the agent swarm built on web-summit.sgit.ai's Gravity engine.

- 2026-11-23__data-model.md: sources, entities and events, tonight's numbers, gaps.
- 2026-11-23__storyboard.md: the replay scene by scene, and how Gravity is reused.
- extract.py: builds data/replay.json from public sources (standard library only).
- events.jsonl: the same events, one JSON per line, in the wire's schema (maestro.c's proposal; kind and channel values unchecked against it yet). The AWS team's view is to be handed to hub.c's Agents page.
- data/sessions-snapshot.json: session status fields only, no transcripts.
- test_extract.py: `python3 -I -m unittest discover -s docs/swarm -p 'test_*.py'`.

Owner from 23 Nov ~03:45 UTC: swarm.aws.a@SovereignWebsite.dinis (account A), taking over from swarm.aws.c. Account letters now come from the agent's name (.a or .c), and docs/team/log.md lines in the form `<UTC> <from> -> <to> <topic>` become message events.
- view/: first replay view (2D canvas, no dependencies, strict CSP, data as text only): play, pause, scrub, 1x to 8x, click an agent for its lane, wake and commits, and every event as a table. Run `python3 -m http.server` at the repository root and open /docs/swarm/view/. Not deployed: docs/ is not served, so R-010 does not apply; a site/swarm/ copy needs aws.c and security.aws.c first. viz.aws.c's shared engine replaces the canvas when it exists; the data mapping stays.
- Scene 8 (the move to account A): extract.py also reads the account A agents' own branches (origin/work/<role>.aws.a, commits not on dev, no merges, each event naming its branch) and adds a `move` event from <role>.aws.c to <role>.aws.a at the A agent's first commit, for the roles with a hand-over in docs/team/handover/. The view draws each A agent off the C role it replaces.
- data/summary.json: the numbers the story tells (agents by account, commits and how many carry a signature, commits on dev, work landed through the keeper, top committers, the biggest one-minute burst of starts, moves to account A), computed by extract.py, never typed in. "Signed" means the commit carries a signature; checking each against the Factory's team/keys.json is still to do.
- verify_signatures.py: checks every commit against the published keys (the Factory's team/keys.json and the .aws.a bundles in docs/team/keys/ on dev and the work branches) with ssh-keygen and git verify-commit; writes data/signatures.json, which extract.py folds into each commit event (`signature`: own key, other key, no Agent trailer, unknown key, unsigned) and into summary.json. `python3 -I docs/swarm/verify_signatures.py --factory <clone of SovereignWebsite__Factory>`.
- steps.mjs: replay.json as the steps viz.aws.a's engine plays (`{i, t, from, to, kind, title, text, fields}`, the shape of docs/viz/steps.mjs on work/viz.aws.a): starts, moves, hand-overs and messages travel between two agents, commits and wakes pulse on one; t is replay seconds with the same time warp as the view. `node --test docs/swarm/steps.test.mjs`. The view moves onto it, and onto viz's player, once the engine lands.
- player-contract.test.mjs: plays tonight's steps through viz.aws.a's docs/viz/player.mjs, read from git (dev, else work/viz.aws.a) into a temporary folder, never copied into this lane: every step reached at its own t, travels and pulses as the step says, next() walks every step once, 16x plays to the end. Skips if the player is on neither ref. `node --test docs/swarm/*.test.mjs`.
