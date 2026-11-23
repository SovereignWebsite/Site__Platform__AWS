# Swarm replay: first data model

swarm.aws.c, 23 Nov 2026. The data behind a replay of tonight's AWS Platform swarm, from 02:40 UTC.

## Sources (public only)

| Source | Gives |
|---|---|
| git history on dev | commits: time, author agent (`Agent:` trailer), session (`Claude-Session:` trailer), signed or not, files touched, and "(from x)" hand-offs when the keeper lands another agent's work |
| docs/team/schedule.json | every agent, its session, its wake (cron) and the lane it asked for |
| site/policy/abp.json | the lanes the keeper actually granted (`roles.aws_team`) |
| docs/team/log.md | wakes and relays the agents chose to publish ("relayed ... to architect and s3") |
| docs/swarm/data/sessions-snapshot.json | session status fields only: created time, parent session, status bucket |

Never used: transcripts, task or turn summaries, message bodies. A message shows up only as who-to-whom-when, and only where its sender published it (the team log, a commit subject).

## Entities

**Agent**: `id` (short name, e.g. `s3.aws.c`), `session`, `parent` (who started it), `born` (session created), `cron` (wake), `lane_requested`, `lane_granted`, `status` at snapshot (working, blocked, review_ready, idle), `programme` (aws.c, or the wider account C).

**Event**, one stream sorted by time `t`:

| type | fields | drawn as |
|---|---|---|
| spawn | from, to | a new body pops out of its parent |
| wake | agent, note | the body pulses |
| commit | agent, sha, subject, signed, files, lanes_touched | a flash on the body; mass grows with files touched |
| handoff | from, to, sha | the keeper lands a peer's work: a beam from author to keeper |
| message | from, to, source | a particle travelling between bodies |

**Lane**: the globs in abp.json. A commit's files are mapped to the lane they fall in; anything outside every agent's lane is the keeper's (aws.c). A commit by an agent outside its own lane is the "policy" moment of the story: tonight it happens only through the keeper, which is the rule working.

## Tonight so far (02:40 to 03:25 UTC, extract run at 03:25)

- 26 agents in view, 22 spawns: maestro.c starts conductor.aws.c and pm.aws.c (02:40); conductor.aws.c starts stage 1, three agents in three seconds (02:44); stage 2, sixteen agents in 21 seconds (03:21:42 to 03:22:03); swarm.aws.c at 03:23:58.
- 22 commits, every one signed and carrying both trailers. aws.c 12, conductor.aws.c 8, s3.aws.c 2.
- 4 hand-offs through the keeper (pm, security, architect, s3), 2 published relays (conductor to architect and s3).
- Speed: from the first conductor commit (02:43:09) to 20 agents running, 39 minutes, most of it waiting for Dinis's word on stage 2.

## Known gaps

- Messages between sessions are mostly unpublished; the replay will under-show communication until agents log who-to-whom in docs/team/log.md. Proposal for conductor.aws.c: one optional log form, `<UTC> <from> -> <to> <topic>`.
- Session status is a snapshot, not a history. A status history needs a poll at each of my wakes, appended to a file (status fields only).
- Times quoted in prose ("Dinis, ~03:30 UTC") come from the speakers and can differ from commit and session clocks; the replay uses the clocks.
- Commits that are signed are counted as signed; checking each signature against the Factory's team/keys.json is the next step.

## Regenerate

`python3 -I docs/swarm/extract.py --since 2026-11-23T02:40Z` writes docs/swarm/data/replay.json (standard library only).
