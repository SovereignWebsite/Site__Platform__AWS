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


def account(name):
    """The account letter from the name: swarm.aws.a -> a, maestro.c -> c, unknown -> None."""
    m = re.search(r"\.([a-z])$", short(name))
    return m.group(1) if m else None


LOG_LINE = re.compile(r"(\d{4}-\d\d-\d\dT\d\d:\d\dZ) (\S+) (.*)")
LOG_MESSAGE = re.compile(r"(\S+) -> (\S+) (.*)")           # the published form: <UTC> <from> -> <to> <topic>


def log_events(text):
    """Events from docs/team/log.md: wakes, published messages and relays, and notes not by one agent."""
    out = []
    for line in text.splitlines():
        m = LOG_LINE.match(line)
        if not m:
            continue
        t, who, what = m.groups()
        msg = LOG_MESSAGE.match(f"{who} {what}")
        if msg:
            out.append({"t": t, "type": "message", "from": short(msg.group(1)), "to": short(msg.group(2)),
                        "topic": msg.group(3), "source": "docs/team/log.md"})
            continue
        if "." not in who:                                   # "first runs reported: ..." and the like
            out.append({"t": t, "type": "note", "note": f"{who} {what}"})
            continue
        out.append({"t": t, "type": "wake", "agent": short(who), "note": what})
        r = re.search(r"relayed .* to ([\w ,]+?)(?:;|$)", what)
        if r:
            for to in re.split(r",| and ", r.group(1)):
                to = to.strip()
                if to:
                    out.append({"t": t, "type": "message", "from": short(who), "to": to if account(to) else to + ".aws.c",
                                "source": "docs/team/log.md"})
    return out


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=True).stdout


def work_branches():
    """The account A agents' own branches (origin/work/<role>.aws.a), public like dev."""
    refs = git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/work/").split()
    return sorted(r for r in refs if re.fullmatch(r"origin/work/[\w.]+\.aws\.a", r))


def commits(since, ref="origin/dev"):
    """Commits on dev, or on a work branch: only those not on dev, merges left out."""
    sep = "\x1e"
    fmt = sep + "%H%x1f%h%x1f%cI%x1f%s%x1f%(trailers:key=Agent,valueonly,separator=;)%x1f%(trailers:key=Claude-Session,valueonly,separator=;)"
    span = [ref] if ref == "origin/dev" else ["--no-merges", f"origin/dev..{ref}"]
    raw = git("log", "--reverse", f"--since={since}", f"--format={fmt}", "--name-only", *span)
    for block in raw.split(sep)[1:]:
        head, _, files = block.partition("\n")
        full, sha, at, subject, agent, sess = head.split("\x1f")
        signed = "gpgsig" in git("cat-file", "-p", full).split("\n\n", 1)[0]
        m = re.search(r"\(from ([\w.]+)\)", subject)
        yield {
            "sha": sha, "at": at.replace("+00:00", "Z"), "subject": subject,
            "agent": short(agent), "session": sess.rsplit("/", 1)[-1] or None,
            "signed": signed, "files": [f for f in files.split("\n") if f],
            "on_behalf_of": m.group(1) if m else None, "branch": ref.replace("origin/", ""),
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
                             "status": s["status_at_snapshot"], "programme": "aws.c" if ".aws." in s["name"] or s["name"] == "aws.c" else f"account-{account(s['name']) or 'c'}"}
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
    branches = work_branches()
    movers = {p.stem for p in (ROOT / "docs/team/handover").glob("*.aws.md")}      # e.g. swarm.aws: roles moving C to A
    for ref in ["origin/dev", *branches]:
        for c in commits(since, ref):
            events.append({"t": c["at"], "type": "commit", "agent": c["agent"], "sha": c["sha"], "branch": c["branch"],
                           "subject": c["subject"], "signed": c["signed"], "files": c["files"],
                           "lanes_touched": sorted({lane_of(f, lanes) or "keeper" for f in c["files"]})})
            if c["agent"] and c["agent"] not in agents:              # an agent seen only in git: its first commit
                role = c["agent"][:-2]
                agents[c["agent"]] = {"id": c["agent"], "session": c["session"], "parent": None, "born": None,
                                      "programme": "aws.c", "account": account(c["agent"]),
                                      "moved_from": f"{role}.c" if account(c["agent"]) == "a" and role in movers else None}
            if c["on_behalf_of"]:
                events.append({"t": c["at"], "type": "handoff", "from": c["on_behalf_of"], "to": c["agent"], "sha": c["sha"]})
    for a in agents.values():                                        # scene 8: the role jumps from account C to account A
        if a.get("moved_from"):
            first = min(e["t"] for e in events if e.get("agent") == a["id"])
            events.append({"t": first, "type": "move", "from": a["moved_from"], "to": a["id"],
                           "source": f"docs/team/handover/{a['id'][:-2]}.md"})
        if c["on_behalf_of"]:
            events.append({"t": c["at"], "type": "handoff", "from": c["on_behalf_of"], "to": c["agent"], "sha": c["sha"]})
    events += log_events((ROOT / "docs/team/log.md").read_text())
    events.sort(key=lambda e: e["t"])
    out = {"schema": "swarm-replay/0.1", "since": since, "agents": sorted(agents.values(), key=lambda a: a.get("born") or "9"),
           "events": events,
           "sources": ["git origin/dev", *[f"git {b}" for b in branches], "docs/team/handover/", "docs/team/schedule.json", "docs/team/log.md", "site/policy/abp.json", "docs/swarm/data/sessions-snapshot.json"]}
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    # The same events in the wire's line schema (maestro.c's proposal,
    # PrompTugal__News__Website board/team/maestro.c/analysis/2026-11-23-the-wire/),
    # fields as relayed by conductor.aws.c; values for kind and channel are ours until checked.
    chan = {"commit": "git", "handoff": "git", "spawn": "session", "wake": "team-log", "message": "team-log", "note": "team-log", "move": "handover"}
    with (ROOT / "docs/swarm/events.jsonl").open("w") as f:
        for e in events:
            f.write(json.dumps({
                "at": e["t"], "from": e.get("from") or e.get("agent"), "to": e.get("to"),
                "account_from": account(e.get("from") or e.get("agent")), "account_to": account(e.get("to")) if e.get("to") else None,
                "channel": chan[e["type"]], "kind": e["type"],
                "text": e.get("subject") or e.get("note") or e.get("topic"), "hash": e.get("sha"),
                "source": e.get("source") or {"git": f"git {e.get('branch', 'dev')}", "session": "sessions-snapshot.json"}.get(chan[e["type"]], "docs/team/log.md"),
                "signed_by": e.get("agent") if e.get("signed") else None,
                "visibility": "public"}) + "\n")
    print(f"{len(out['agents'])} agents, {len(events)} events -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
