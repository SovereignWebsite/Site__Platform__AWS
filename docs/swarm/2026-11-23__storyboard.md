# Swarm replay: storyboard

swarm.aws.c, 23 Nov 2026. A replay of tonight's AWS Platform swarm, from 02:40 UTC, about 90 seconds long. Data: docs/swarm/data/replay.json (see the data model).

## The engine we reuse

web-summit.sgit.ai's "Gravity" (lib/gravity, v0.1.0, Apache-2.0, source in SGit-AI/SGit-AI__Website__Web-Summit, dev): three.js 0.147.0 with bloom, one script, `Gravity.mount(el, opts)`. It takes `{core, centres, nodes, flows, feed}`: nodes orbit centres, flows are arcs with travelling light, fresh flows (within 45 minutes of the latest) glow brighter, `ok` colours a node teal or red.

What it lacks for us: no timeline and no physics (fixed orbits). So the plan is a thin replay wrapper, not a new engine:

1. Copy gravity.js v0.1.0 into our site (pinned, with its licence), never hotlink it; drop the vault reader (LiveUniverse, WSKeyring), which we do not need.
2. A play head walks replay.json; at each step it builds the Gravity data for "the swarm as of time t" and hands it over through `refresh()`. If refresh cannot keep the camera, a small plugin view with its own `frame(ms)` is the fallback; that is the first thing to test.
3. Mapping: core = the AWS Platform programme; centres = Dinis's sessions as the sun, then maestro.c, conductor.aws.c, aws.c (the keeper) and "stage 2"; nodes = agents; flows = spawn, hand-off and message events (count, last at); feed = commit subjects and published relays; `ok` = not blocked.

## Scenes

| # | Clock (UTC) | Replay | On screen |
|---|---|---|---|
| 1 | before 02:40 | 0 to 8 s | An empty sky, one star: maestro.c. Caption: "02:40 UTC. One agent, one owner's word: Lean start." |
| 2 | 02:40 | 8 to 15 s | maestro.c spawns conductor.aws.c and pm.aws.c two seconds apart; aws.c, the keeper, is already there, writing the memo (commit flash). |
| 3 | 02:43 to 02:46 | 15 to 30 s | The conductor writes the start prompts, then stage 1: security, architect and s3 pop out in three seconds. First relay arcs: conductor to architect and s3. s3's first commit at 02:45, 90 seconds after it was born. |
| 4 | 02:57 to 03:08 | 30 to 50 s | Work. aws.c ships the twin v0; four beams land on the keeper as pm, security, architect and s3 hand their work over ("from s3.aws.c"). Caption: "Each agent writes only in its own lane; everything else goes through the keeper." Lanes drawn as faint rings round each body. |
| 5 | 03:18 to 03:20 | 50 to 58 s | The keeper opens sixteen new lanes in the policy (c32279d); the rings appear before the agents do. |
| 6 | 03:21:42 to 03:22:03 | 58 to 75 s | The swarm: sixteen agents in 21 seconds, slowed so each one is seen. A counter: 4, 8, 12, 20. Then swarm.aws.c, the agent drawing this. |
| 7 | 03:25 | 75 to 90 s | Hold on the whole sky. Blocked agents dim to red, the rest teal. Caption with the two numbers that tell the story: "22 commits, all signed. 39 minutes from first prompt to 20 agents." |

## Interaction (usability first)

- Play, pause, a scrubber with the scene marks, speed 1x to 8x, and a live mode later.
- Click an agent: its lane, wake, parent, commits (each linking to the commit), and what it is blocked on only if that agent published it.
- Plain captions a first-time visitor can follow; no jargon on screen.
- Works without WebGL: the same data as a timeline table, so the page is still useful.

## Rules

Public data only, no transcripts, no message bodies. Static files, no cookies, no tracking, the CSP kept (three.js copied in, not from a CDN, unless security.aws.c says a pinned CDN with integrity is fine). Code and site paths are requests to aws.c.

## Shared engine and the next scene

pm.aws.c relays Dinis (~03:35 UTC): viz.aws.c and swarm.aws.c build one small, pragmatic engine for moving and jumping, shared by the swarm view and "follow the packet". Agreed with viz.aws.c (03:31 UTC): viz owns the engine (scene, bodies, links, a packet travelling a path, camera follow, play-head); swarm owns the data (events.jsonl) and the swarm view. API: `engine.mount(el)`, `engine.set({bodies, links})`, `engine.travel(from, to, opts)`, `engine.at(t)`, `engine.speed(x)` (0.25x to 8x), `engine.on("tick")`. Drawing stays separate from motion, so the bulletins' characters (PrompTugal__News__Bulletins) can plug in as a renderer. The CSP is script-src 'self': three.js (MIT) and any Gravity code (Apache-2.0) are copied into site/ at pinned versions with their notices, never loaded from a CDN.

Scene 8: tonight's move of the AWS agents from account C to account A (Dinis, ~03:40 UTC). Each body jumps across to a second sky; the replay shows it from the session and schedule records only.

## Open questions

- observability.c holds no feed or viewer; maestro.c points to the wire's schema (PrompTugal__News__Website board/team/maestro.c/analysis/2026-11-23-the-wire/), which events.jsonl follows; the wider view is hub.c's Agents page, to which this view is handed.
- Where the viewer lives: proposed site/swarm/** (asks aws.c, and Dinis via pm.aws.c).
- A published who-to-whom line in docs/team/log.md would make scene 4 honest about communication; proposed to conductor.aws.c.
