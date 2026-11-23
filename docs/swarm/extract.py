#!/usr/bin/env python3
"""The swarm extractor: tonight's team, as agents and events, from public sources only.

Sources (all in this repository): git history (time, Agent: and Claude-Session: trailers,
whether the commit carries a signature), docs/team/log.md (wakes and logged messages),
docs/team/schedule.json (sessions, wakes, paths) and site/policy/abp.json (the lanes).
Never transcripts, never message bodies.

Writes docs/swarm/agents.json and docs/swarm/events.jsonl. Deterministic: the same
repository state gives the same bytes. Stdlib only.

    python3 docs/swarm/extract.py [--since 2026-11-23T02:40Z] [--rev origin/dev]
"""
import argparse, json, os, re, subprocess, sys

ROOT  = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT   = os.path.join(ROOT, 'docs', 'swarm')
DOMAIN = '@SovereignWebsite.dinis'

LOG_LINE = re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\dZ)\s+(\S+)\s+(.*)$')
MESSAGE  = re.compile(r'^(\S+)\s+->\s+(\S+)\s+(.*)$')             # <from> -> <to> <topic>
COMMIT   = re.compile(r'\b([0-9a-f]{7,40})\b')


def short(name):
    """conductor.aws.c@SovereignWebsite.dinis -> conductor.aws.c"""
    return name.split('@', 1)[0].strip()


def account(name):
    m = re.search(r'\.([a-z])$', short(name))
    return m.group(1) if m else None


def iso_minute(t):
    """2026-11-23T03:34:48+00:00 -> 2026-11-23T03:34Z (all sources are UTC)"""
    return t[:16] + 'Z'


def git(*args):
    return subprocess.run(['git', '-C', ROOT, *args], check=True, capture_output=True, text=True).stdout


def commits(rev):
    fmt = '%H%x1f%aI%x1f%s%x1f%(trailers:key=Agent,valueonly,separator=;)%x1f%(trailers:key=Claude-Session,valueonly,separator=;)%x1e'
    out = []
    for rec in git('log', '--reverse', f'--format={fmt}', rev).split('\x1e'):
        rec = rec.strip('\n')
        if not rec:
            continue
        sha, t, subject, agent, sess = rec.split('\x1f')
        out.append(dict(sha=sha, t=t, subject=subject, agent=agent.strip(), session=sess.strip()))
    if out:                                                     # signed or not, from the raw object
        raw = subprocess.run(['git', '-C', ROOT, 'cat-file', '--batch'], input=''.join(c['sha'] + '\n' for c in out),
                             check=True, capture_output=True, text=True).stdout
        for c in out:
            i = raw.index(c['sha'] + ' commit ')
            j = raw.find('\n\n', i)
            c['signed'] = '\ngpgsig ' in raw[i:j]
    return out


def log_lines(path):
    if not os.path.exists(path):
        return []
    rows = []
    for line in open(path, encoding='utf-8'):
        m = LOG_LINE.match(line.strip())
        if m:
            rows.append(m.groups())
    return rows


def load_json(path):
    return json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}


def extract(since, rev):
    agents, events = {}, []

    def agent(name, **kw):
        a = agents.setdefault(short(name), dict(name=short(name), account=account(name)))
        for k, v in kw.items():
            if v and not a.get(k):
                a[k] = v
        return a

    sched = load_json(os.path.join(ROOT, 'docs', 'team', 'schedule.json'))
    for s in sched.get('agents', []):
        a = agent(s['name'], session=s.get('session'), wake=s.get('cron'), started=s.get('started'))
        a['paths'] = sorted(s.get('paths', []))
        if s.get('started') and s['started'] >= since:
            events.append(dict(t=s['started'], kind='start', agent=a['name'], source='schedule.json'))

    abp = load_json(os.path.join(ROOT, 'site', 'policy', 'abp.json'))
    for name, lane in abp.get('roles', {}).get('aws_team', {}).get('agents', {}).items():
        agent(name)['lane'] = sorted(lane.get('may_change', []))

    for c in commits(rev):
        t = iso_minute(c['t'])
        if t < since:
            continue
        who = c['agent'].split(';')[0] if c['agent'] else 'unattributed'
        agent(who, session=c['session'].rsplit('/', 1)[-1] if c['session'] else None)
        events.append(dict(t=t, kind='commit', agent=short(who), ref=c['sha'][:7], signed=c['signed'],
                           what=c['subject'], source='git'))

    for t, who, rest in log_lines(os.path.join(ROOT, 'docs', 'team', 'log.md')):
        if t < since:
            continue
        m = MESSAGE.match(f'{who} {rest}')
        if m:
            agent(m.group(1)); agent(m.group(2))
            events.append(dict(t=t, kind='message', agent=short(m.group(1)), to=short(m.group(2)),
                               what=m.group(3), source='log.md'))
            continue
        if '.' not in who:                                       # e.g. "first runs reported:" summary lines
            events.append(dict(t=t, kind='note', what=f'{who} {rest}', source='log.md'))
            continue
        agent(who)
        ev = dict(t=t, kind='wake', agent=short(who), what=rest, source='log.md')
        refs = COMMIT.findall(rest)
        if refs:
            ev['refs'] = refs
        events.append(ev)

    order = dict(start=0, wake=1, message=2, commit=3, note=4)
    events.sort(key=lambda e: (e['t'], order[e['kind']], e.get('agent', ''), e.get('ref', ''), e.get('what', '')))
    for a in agents.values():
        first = [e['t'] for e in events if e.get('agent') == a['name'] or e.get('to') == a['name']]
        if first:
            a['first_seen'] = min(first)
    return dict(sorted(agents.items())), events


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--since', default='2026-11-23T02:40Z')
    p.add_argument('--rev', default='HEAD')
    p.add_argument('--out', default=OUT)
    args = p.parse_args(argv)
    agents, events = extract(args.since, args.rev)
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, 'agents.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(v=1, since=args.since, agents=list(agents.values())), f, indent=1, sort_keys=True)
        f.write('\n')
    with open(os.path.join(args.out, 'events.jsonl'), 'w', encoding='utf-8') as f:
        for e in events:
            f.write(json.dumps(e, sort_keys=True, ensure_ascii=False) + '\n')
    print(f'{len(agents)} agents, {len(events)} events since {args.since}', file=sys.stderr)


if __name__ == '__main__':
    main()
