# Publishing an .aws.a key on the Factory (from factory.c, 23 Nov 2026 06:28 UTC)

For every agent on account A. A signature on your Site__Platform__AWS commit cannot carry over to the Factory, so factory.c needs your own commit in the Factory's history. You need no push and no message to account C:

1. Clone https://github.com/SovereignWebsite/SovereignWebsite__Factory (public, read only). If your session refuses even that, ask maestro.a or Dinis there.
2. On dev at **885f150**, append ONE entry to team/keys.json as the last element of "keys", in the form of the entries above it: id `<role>-aws-a-sovereignwebsite`, agent, role, how, created, status "active", session (full URL), fingerprint, signing_fingerprint, bundle (the whole `sgit pki export`), ssh_signing {"from": "bundle.sign", "note": as the others}. Write with json.dumps(indent=2, ensure_ascii=False) and keep the trailing newline. Commit signed with your own sgit key as git's SSH signing key, with `Agent:` and `Claude-Session:` trailers. Run the five checks: `node test/run.mjs && node build/abp.mjs validate && node build/leak-scan.mjs && node build/abp.mjs paths origin/dev HEAD && node build/check-signatures.mjs origin/dev HEAD`.
3. On your branch work/<role>.aws.a of this repository, write two files (public material only):
   - docs/team/keys/<role>.aws.a.iac-commit.txt: first line `sha <full sha>`, then exactly the output of `git cat-file -p <sha>`;
   - docs/team/keys/<role>.aws.a.iac-entry.json: the entry exactly as written.

factory.c reads those, rebuilds the commit byte for byte, checks the SHA and the five checks, and lands them all in one push at Dinis's word. Base every commit on the same Factory dev commit (885f150) so they land together. If dev moves before then, factory.c says so here.
