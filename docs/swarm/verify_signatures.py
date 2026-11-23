#!/usr/bin/env python3
"""Who really signed each commit: every commit in the replay checked against the published keys.

Keys come from public material only: the Factory's team/keys.json (a local clone of
SovereignWebsite__Factory, --factory) and the .aws.a bundles in docs/team/keys/ on dev
and on the work/<role>.aws.a branches. Each bundle's signing key is turned into OpenSSH
form with ssh-keygen and every commit is checked with git verify-commit.

Writes docs/swarm/data/signatures.json: {sha: {"key_of": agent or null, "trailer": agent,
"verdict": "own key" | "own retired key" | "own superseded key" | "other key" | "no Agent trailer" | "unknown key" | "unsigned"}}. extract.py reads it when present.
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


def trusted_label(ref, path, label):
    """Whether a bundle file names its own agent honestly enough to trust (security.aws.a, 23 Nov 20:31).
    On dev: the label must match the file name. On a work branch: only the branch owner's own file,
    and the label must match both. Anything else (a bundle planted on someone else's branch) is refused."""
    stem = path[:-5] if path.endswith(".json") else None
    agent = short(label)
    if not stem or agent != stem:
        return False
    if ref == "origin/dev":
        return True
    return ref == f"origin/work/{stem}"


def bundles(factory):
    """Trusted keys, most trusted first: the Factory's team/keys.json (the trust root, with each entry's status),
    then docs/team/keys/<agent>.json on dev, then each agent's own file on its own work branch."""
    out = []
    if factory:
        for k in json.loads(git("show", "origin/dev:team/keys.json", cwd=factory).stdout)["keys"]:
            if isinstance(k.get("bundle"), dict):
                out.append({"agent": short(k["agent"]), "bundle": k["bundle"], "source": "factory", "status": k.get("status", "active")})
    refs = ["origin/dev"] + git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/work/").stdout.split()
    for ref in refs:
        for path in git("ls-tree", "--name-only", f"{ref}:docs/team/keys/", check=False).stdout.split():
            if not re.fullmatch(r"[\w.]+\.aws\.a\.json", path):
                continue
            b = json.loads(git("show", f"{ref}:docs/team/keys/{path}").stdout)
            if trusted_label(ref, path, b.get("label", "")):
                out.append({"agent": short(b["label"]), "bundle": b, "source": ref, "status": "active"})
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
        keys, refused, superseded = {}, 0, {}                    # agent -> [(fingerprint, key, status, source)]
        for b in bundles(args.factory):
            key = openssh(b["bundle"].get("sign", ""), tmp)
            if not key:
                continue
            fp, have = fingerprint(key, tmp), keys.setdefault(b["agent"], [])
            if any(fp == h[0] for h in have):
                continue
            if have and (b["source"] != "factory" or have[0][3] != "factory"):
                refused += 1                                     # a second key for an agent is taken from the Factory only;
                superseded.setdefault(b["agent"], []).append((fp, key, "superseded", b["source"]))  # kept apart, never "own key"
                continue
            have.append((fp, key, b["status"], b["source"]))
        by_fp = {fp: (agent, status) for agent, ks in keys.items() for fp, _, status, _ in ks}

        def signers_file(name, entries):
            f = Path(tmp) / f"signers-{name}"
            f.write_text("".join(f"{PRINCIPAL} {k}\n" for _, k, _, _ in entries) or "\n")
            return f
        per_agent = {a: signers_file(a, ks) for a, ks in keys.items()}
        everyone = signers_file("all", [e for ks in keys.values() for e in ks])
        old = {a: signers_file(f"old-{a}", ks) for a, ks in superseded.items()}

        def good(sha, signers):
            v = git("-c", f"gpg.ssh.allowedSignersFile={signers}", "verify-commit", "--raw", sha, check=False)
            # "Good signature" alone only means the signature is valid; "No principal matched" (exit 1) means
            # the key is not in the trusted file. Only exit 0 counts.
            m = re.search(r"(SHA256:[A-Za-z0-9+/=]+)", v.stderr) if v.returncode == 0 and 'Good "git" signature' in v.stderr else None
            return m.group(1) if m else None

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
                fp = good(sha, per_agent[trailer]) if trailer in per_agent else None    # its own agent's keys only
                if fp:
                    retired = by_fp[fp][1] == "retired"
                    result[sha] = {"key_of": trailer, "trailer": trailer, "verdict": "own retired key" if retired else "own key"}
                    continue
                if trailer in old and good(sha, old[trailer]):           # the agent's own earlier key, refused as a second key
                    result[sha] = {"key_of": None, "trailer": trailer, "verdict": "own superseded key"}
                    continue
                fp = good(sha, everyone)
                key_of = by_fp[fp][0] if fp else None
                verdict = "unknown key" if not key_of else "no Agent trailer" if not trailer else "other key"
                result[sha] = {"key_of": key_of, "trailer": trailer, "verdict": verdict}
    OUT.write_text(json.dumps(dict(sorted(result.items())), indent=1, sort_keys=True) + "\n")
    counts = {}
    for r in result.values():
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"{len(result)} commits, {len(by_fp)} trusted keys, {refused} second keys refused: {counts}", file=sys.stderr)


if __name__ == "__main__":
    main()
