#!/usr/bin/env python3
"""Who really signed each commit: every commit in the replay checked against the published keys.

Keys come from public material only: the Factory's team/keys.json (a local clone of
SovereignWebsite__Factory, --factory) and the .aws.a bundles in docs/team/keys/ on dev
and on the work/<role>.aws.a branches. Each bundle's signing key is turned into OpenSSH
form with ssh-keygen and every commit is checked with git verify-commit.

Writes docs/swarm/data/signatures.json: {sha: {"key_of": agent or null, "trailer": agent,
"verdict": "own key" | "other key" | "no Agent trailer" | "unknown key" | "unsigned"}}. extract.py reads it when present.
Needs git and ssh-keygen; standard library otherwise.

    python3 -I docs/swarm/verify_signatures.py --factory /path/to/SovereignWebsite__Factory
"""
import argparse, json, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/swarm/data/signatures.json"
SUFFIX = "@SovereignWebsite.dinis"
PRINCIPAL = "noreply@anthropic.com"          # the committer address every agent commits with


def git(*args, cwd=ROOT, check=True):
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=check)


def short(name):
    return (name or "").replace(SUFFIX, "").strip()


def bundles(factory):
    """(agent, bundle) pairs from the Factory and from docs/team/keys/*.json on dev and the work branches."""
    out = []
    if factory:
        for k in json.loads(git("show", "origin/dev:team/keys.json", cwd=factory).stdout)["keys"]:
            if isinstance(k.get("bundle"), dict):
                out.append((short(k["agent"]), k["bundle"]))
    refs = ["origin/dev"] + git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/work/").stdout.split()
    for ref in refs:
        for path in git("ls-tree", "--name-only", f"{ref}:docs/team/keys/", check=False).stdout.split():
            if re.fullmatch(r"[\w.]+\.aws\.a\.json", path):
                b = json.loads(git("show", f"{ref}:docs/team/keys/{path}").stdout)
                out.append((short(b.get("label")), b))
    return out


def openssh(pem, tmp):
    f = Path(tmp) / "k.pem"
    f.write_text(pem)
    r = subprocess.run(["ssh-keygen", "-i", "-m", "PKCS8", "-f", str(f)], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def fingerprint(key, tmp):
    f = Path(tmp) / "k.pub"
    f.write_text(key + "\n")
    return subprocess.run(["ssh-keygen", "-l", "-f", str(f)], capture_output=True, text=True).stdout.split()[1]


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--factory", help="local clone of SovereignWebsite__Factory with origin/dev fetched")
    p.add_argument("--since", default="2026-11-23T02:40Z")
    args = p.parse_args(argv)
    with tempfile.TemporaryDirectory() as tmp:
        by_fp, lines = {}, []
        for agent, b in bundles(args.factory):
            key = openssh(b.get("sign", ""), tmp)
            if not key:
                continue
            fp = fingerprint(key, tmp)
            by_fp.setdefault(fp, agent)
            lines.append(f"{PRINCIPAL} {key}")
        signers = Path(tmp) / "allowed_signers"
        signers.write_text("\n".join(sorted(set(lines))) + "\n")
        refs = ["origin/dev"] + [f"origin/dev..{r}" for r in git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/work/").stdout.split()]
        result = {}
        for ref in refs:
            log = git("log", f"--since={args.since}", "--format=%h%x1f%(trailers:key=Agent,valueonly,separator=;)", *ref.split()).stdout
            for line in log.splitlines():
                sha, trailer = line.split("\x1f")
                if sha in result:
                    continue
                trailer = short(trailer.split(";")[0])
                raw = git("cat-file", "-p", sha).stdout.split("\n\n", 1)[0]
                if "\ngpgsig " not in raw:
                    result[sha] = {"key_of": None, "trailer": trailer, "verdict": "unsigned"}
                    continue
                v = git("-c", f"gpg.ssh.allowedSignersFile={signers}", "verify-commit", "--raw", sha, check=False)
                m = re.search(r"(SHA256:[A-Za-z0-9+/=]+)", v.stderr) if 'Good "git" signature' in v.stderr else None
                key_of = by_fp.get(m.group(1)) if m else None
                verdict = ("unknown key" if not key_of else "no Agent trailer" if not trailer
                           else "own key" if key_of == trailer else "other key")
                result[sha] = {"key_of": key_of, "trailer": trailer, "verdict": verdict}
    OUT.write_text(json.dumps(dict(sorted(result.items())), indent=1, sort_keys=True) + "\n")
    counts = {}
    for r in result.values():
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"{len(result)} commits, {len(by_fp)} published keys: {counts}", file=sys.stderr)


if __name__ == "__main__":
    main()
