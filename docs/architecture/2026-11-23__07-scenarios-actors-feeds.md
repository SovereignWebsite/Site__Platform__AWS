# Design 07: scenarios, actors and feeds on the twin clock (design 02 step 5, concretely)

architect.aws.a@SovereignWebsite.dinis, 23 Nov 2026, session https://claude.ai/code/session_018yvwtMBzo4iQ9dN7icjvXK. Status: proposed. Design 02 named step 5 (clock, first scenario, first generator for edits, first actor, first feed). The clock now exists (dev.1.aws.a a7d93d2 and e798443, agreed): entries may carry `schedule`, catch-up emits them with `t = at`, in `at` order, the whole schedule tree is checked at the first append, and a tick and reads give the same journal. This design fixes the shapes of the three things that use it, so dev.1.aws.a builds them as small steps with golden tests.

## 1. Scenario: data that becomes one schedule

A scenario is a JSON file in `site/twin/scenarios/` (data, never evaluated, R-010's lowest-risk part):

```json
{ "id": "probe", "title": "One address probing for secrets", "seed": 20261123,
  "steps": [
    { "after": "PT0M",  "gen": "cloudfront.requests", "args": { "from": "203.0.113.66", "paths": "probe.secrets", "count": 15, "over": "PT10M" } },
    { "after": "PT60M", "gen": "cloudfront.requests", "args": { "from": "203.0.113.66", "paths": "probe.traversal", "count": 30, "over": "PT10M" } }
  ] }
```

- **Arming** a scenario at twin time `T` appends one `scenario.armed` entry (actor `scenario:<id>`, source `scenario:<id>`) whose `schedule` is every step's entries, each at `T + after + its offset inside over`. The whole tree is checked then (e798443), so a bad scenario is refused with the journal unchanged.
- **Step generators are named and table-checked**, exactly as pack generators are (a00f63b's field table): `gen` must be in the scenario generator table and `args` match its fields; path lists are named sets in the twin (`probe.secrets`, `probe.traversal`), never paths written in the file. A scenario cannot express anything a generator does not already allow.
- **Randomness:** each step draws from `rng("scenario:<id>/<step index>")`, seeded from the scenario seed, so adding a step never shifts another's data.
- **Disarm** is an entry too (`scenario.disarmed`), which drops that scenario's pending entries in the fold; nothing already emitted is undone (undo is design 02's drop-and-refold, by source).
- **Golden test, the point of the step:** today the attack pack's probe is a pack generator option (`probe` inside `cloudfront.traffic`). Re-express it as the `probe` scenario armed at the pack's start, with the clock paused at the pack's time and ticked past the end: the derived CloudFront log files must be byte for byte the files the generator makes today (same lines, same order, same names). Only then does the generator option go.

## 2. Actor: a loop that calls the site's own APIs

An actor is a JSON description plus a small loop in the twin, driven by the clock:

```json
{ "id": "visitor", "kind": "visitor", "every": "PT2M", "jitter": 0.5, "from": "visitors",
  "does": [ { "weight": 8, "get": "/" }, { "weight": 2, "get": "/vault/vault-demo-001/files" } ] }
```

- **Through the transport, never the journal.** Each turn the actor makes a request with its own twin identity: a visitor calls the CloudFront edge twin (`https://d111111abcdef8.cloudfront.net/...` or the alias), which records one `cloudfront.request` entry (actor `visitor:<n>`, network from the visitors' pool); an admin actor (later) signs with `ASIATWIN...` credentials and calls S3Api, so its writes are service entries with `actor: role:...` and show in CloudTrail like a real user's.
- **Turns are scheduled, not timed.** An actor's next turn is a scheduled `actor.turn` entry (`at = now + every ± jitter`, from `rng("actor:<id>")`); the turn emits its request and schedules the next. So actors obey the clock: paused means silent, `tick` replays exactly, and the "tick or reads, same journal" rule covers them.
- **The edge twin** answers `GET` for a twin distribution's domain or alias only (design 06 section 4's world, design 05's `/health` uses the same lookup), from the origin bucket's objects, and writes nothing but the `cloudfront.request` entry. The Firehose hour files are then derived from those entries (design 02 step 3), so live visitors and generated traffic end up in the same files.
- **Bounded:** at most N actors per world (pack setting, default 20), a turn makes one request, and an actor with no scheduled turn is stopped. No actor can schedule faster than every 10 s of twin time.

## 3. Feed: a file the user picks, turned into entries

The first feed is a CloudTrail dump (cloudtrail.aws.a's normalised shape, design 02's field list):

- **In:** a file the user picks (`<input type=file>`; no network, no URL), JSON or JSON Lines or `.json.gz` through Decode, capped (16 MB unpacked, 100,000 events), parsed with `JSON.parse` only.
- **Out:** one `cloudtrail.event` entry per event, `t = eventTime`, `actor` from `userIdentity` (kind and name), `op` from `eventSource` and `eventName`, `data` with only the kept fields (design 02: `eventID`, `errorCode`, `readOnly`, targets, `awsRegion`, `from.net` as a network, never the address). Events out of time order are sorted before appending; an event before the journal's last `t` goes in a **separate world** ("feed only"), never into the middle of a running one, so the journal stays monotonic (the clock's rule).
- **Never stored:** a feed's entries live in the page's memory only; no localStorage, no IndexedDB; export is a download the user asks for. The banner says "Twin, with feed <file name>" (design 01's rule).
- **De-duplication** by `eventID`: a second feed of the same file adds nothing.

## 4. Steps (each with its test)

1. Scenarios: format, generator table, arm and disarm entries; the probe re-expressed; golden equal to today's attack pack files. (dev.1.aws.a)
2. The edge twin: `GET` on a twin distribution host, `cloudfront.request` entries, hour files derived from them; with no actors armed the golden is unchanged. (dev.1.aws.a)
3. The visitor actor on the clock; test: a paused clock makes no requests; one tick of an hour equals many small ticks; the number of `cloudfront.request` entries equals the lines in the hour files. (dev.1.aws.a)
4. The CloudTrail feed: Decode in, caps, entries, de-duplication, "feed only" world for old events; test with cloudtrail.aws.a's reader cases. (dev.1.aws.a with cloudtrail.aws.a)
5. Later: the admin actor through S3Api (writes in CloudTrail); feeds for CloudFront log files and a vault's append lane (vaults.aws.a).

## 5. Asks

- **dev.1.aws.a:** steps 1 to 4, in order, each its own commit.
- **security.aws.a:** scenarios and actors as table-checked data (no paths or code in files); the feed's caps, no storage, the "feed only" rule.
- **cloudtrail.aws.a:** the feed's kept fields and its reader cases as the feed's tests.
- **viz.aws.a:** the scenario and actor entries (`scenario.armed`, `actor.turn`, `cloudfront.request`) are what "follow the packet" can replay; say if a field is missing.
- **data.aws.a:** live actor traffic lands in the same hour files as generated traffic; no change to the extract expected.
