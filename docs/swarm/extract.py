#!/usr/bin/env python3
"""Build the swarm replay data from public sources only.

Sources: git history (commits, signatures, Agent and Claude-Session trailers,
files touched), docs/team/schedule.json (agents, wakes, lanes),
docs/team/log.md (wakes and relays the agents published),
site/policy/abp.json (lanes the keeper granted) and
docs/swarm/data/sessions-snapshot.json (session status fields only).
No transcripts, no message bodies.

Usage: python3 -I docs/swarm/extract.py [--since 2026-11-23T02:40Z]
Writes docs/swarm/data/replay.json. Standard library only.
"""
import json, re, subprocess, sys, fnmatch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/swarm/data/replay.json"
SUFFIX = "@SovereignWebsite.dinis"


def short(name):
    return (name or "").replace(SUFFIX, "").strip()


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=True).stdout


def commits(since):
    sep = "\x1e"
    fmt = sep + "%H%x1f%h%x1f%cI%x1f%s%x1f%(trailers:key=Agent,valueonly,separator=;)%x1f%(trailers:key=Claude-Session,valueonly,separator=;)"
    raw = git("log", "--reverse", f"--since={since}", f"--format={fmt}", "--name-only", "origin/dev")
    for block in raw.split(sep)[1:]:
        head, _, files = block.partition("\n")
        full, sha, at, subject, agent, sess = head.split("\x1f")
        signed = "gpgsig" in git("cat-file", "-p", full).split("\n\n", 1)[0]
        m = re.search(r"\(from ([\w.]+)\)", subject)
        yield {
            "sha": sha, "at": at.replace("+00:00", "Z"), "subject": subject,
            "agent": short(agent), "session": sess.rsplit("/", 1)[-1] or None,
            "signed": signed, "files": [f for f in files.split("\n") if f],
            "on_behalf_of": m.group(1) if m else None,
        }


def lane_of(path, lanes):
    for agent, globs in lanes.items():
        if any(fnmatch.fnmatch(path, g) for g in globs):
            return agent
    return None


def main():
    since = sys.argv[sys.argv.index("--since") + 1] if "--since" in sys.argv else "2026-11-23T02:40Z"
    sched = json.loads((ROOT / "docs/team/schedule.json").read_text())
    abp = json.loads((ROOT / "site/policy/abp.json").read_text())
    snap = json.loads((ROOT / "docs/swarm/data/sessions-snapshot.json").read_text())

    granted = {short(k): v.get("may_change", []) for k, v in
               abp.get("roles", {}).get("aws_team", {}).get("agents", {}).items()}
    agents = {}
    for s in snap["sessions"]:
        agents[s["name"]] = {"id": s["name"], "session": s["session"], "parent": None,
                             "parent_session": s["parent_session"], "born": s["created_at"],
                             "status": s["status_at_snapshot"], "programme": "aws.c" if s["name"].endswith(".aws.c") or s["name"] == "aws.c" else "account-c"}
    for a in sched["agents"]:
        n = short(a["name"])
        ag = agents.setdefault(n, {"id": n, "session": a.get("session"), "born": None, "programme": "aws.c"})
        ag.update({"cron": a.get("cron"), "lane_requested": a.get("paths", []), "lane_granted": granted.get(n, [])})
    by_session = {a["session"]: n for n, a in agents.items() if a.get("session")}
    for a in agents.values():
        a["parent"] = by_session.get(a.pop("parent_session", None))

    events = []
    for a in agents.values():
        if a.get("born") and a["born"] >= since.replace("Z", ""):
            events.append({"t": a["born"], "type": "spawn", "from": a["parent"], "to": a["id"]})
    lanes = {k: [g.replace("**", "*") for g in v] for k, v in granted.items()}
    for c in commits(since):
        events.append({"t": c["at"], "type": "commit", "agent": c["agent"], "sha": c["sha"],
                       "subject": c["subject"], "signed": c["signed"], "files": c["files"],
                       "lanes_touched": sorted({lane_of(f, lanes) or "keeper" for f in c["files"]})})
        if c["on_behalf_of"]:
            events.append({"t": c["at"], "type": "handoff", "from": c["on_behalf_of"], "to": c["agent"], "sha": c["sha"]})
    for line in (ROOT / "docs/team/log.md").read_text().splitlines():
        m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\dZ) ([\w.]+) (.*)", line)
        if not m:
            continue
        t, who, what = m.groups()
        events.append({"t": t, "type": "wake", "agent": who, "note": what})
        r = re.search(r"relayed .* to ([\w ,]+?)(?:;|$)", what)
        if r:
            for to in re.split(r",| and ", r.group(1)):
                to = to.strip()
                if to:
                    events.append({"t": t, "type": "message", "from": who, "to": to if to.endswith(".c") else to + ".aws.c", "source": "docs/team/log.md"})
    events.sort(key=lambda e: e["t"])
    out = {"schema": "swarm-replay/0.1", "since": since, "agents": sorted(agents.values(), key=lambda a: a.get("born") or "9"),
           "events": events,
           "sources": ["git origin/dev", "docs/team/schedule.json", "docs/team/log.md", "site/policy/abp.json", "docs/swarm/data/sessions-snapshot.json"]}
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    # The same events in the wire's line schema (maestro.c's proposal,
    # PrompTugal__News__Website board/team/maestro.c/analysis/2026-11-23-the-wire/),
    # fields as relayed by conductor.aws.c; values for kind and channel are ours until checked.
    chan = {"commit": "git", "handoff": "git", "spawn": "session", "wake": "team-log", "message": "team-log"}
    with (ROOT / "docs/swarm/events.jsonl").open("w") as f:
        for e in events:
            f.write(json.dumps({
                "at": e["t"], "from": e.get("from") or e.get("agent"), "to": e.get("to"),
                "account_from": "c", "account_to": "c" if e.get("to") else None,
                "channel": chan[e["type"]], "kind": e["type"],
                "text": e.get("subject") or e.get("note"), "hash": e.get("sha"),
                "source": e.get("source") or ("git origin/dev" if "sha" in e else "sessions-snapshot.json"),
                "signed_by": e.get("agent") if e.get("signed") else None,
                "visibility": "public"}) + "\n")
    print(f"{len(out['agents'])} agents, {len(events)} events -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
