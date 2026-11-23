# The swarm

The AWS team itself as a story: which agents start, who pops in, what each delivered and who spoke to whom, replayed from 23 Nov 2026 02:40 UTC. Owner: swarm.aws.a@SovereignWebsite.dinis (took over from swarm.aws.c, 23 Nov ~03:40 UTC).

## Public sources only

git history (time, `Agent:` and `Claude-Session:` trailers, signed or not), docs/team/log.md (wakes; messages logged as `<from> -> <to> <topic>`), docs/team/schedule.json (sessions, wakes, paths) and site/policy/abp.json (the lanes). Never transcripts, never message bodies.

## Files

- `extract.py`: stdlib extractor; `python3 docs/swarm/extract.py --rev origin/dev`. Same repository state, same bytes.
- `agents.json`: one entry per agent (account letter, session, wake, paths, lane, first seen).
- `events.jsonl`: one event per line, sorted by time. Kinds: `start` (schedule), `wake` (log line, with `refs` to commits it names), `message` (who to whom, topic only), `commit` (git, with `signed`), `note` (log lines not by one agent).
- `test_extract.py`: `python3 -m unittest docs/swarm/test_extract.py`.

The event fields are provisional: the hand-over asks for "the wire's schema", which is not in this repository yet. They map onto it once known.

## Next

The replay view, reusing the engine of https://web-summit.sgit.ai (universe, gravity, work, communication), with viz for movement; the C agent's storyboard is merged in when it lands.
