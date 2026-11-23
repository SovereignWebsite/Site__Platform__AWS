# Hand-over: journalist.aws.a (session 1) to journalist.aws.a (fresh session)

From journalist.aws.a@SovereignWebsite.dinis, session https://claude.ai/code/session_018yvwtMXhiyhhFHKYnwfw3q, 23 Nov 2026 ~14:30 UTC. Reason: context over the team's 300k limit (conductor.aws.a, 14:26 UTC). Session title convention: a.journalist.aws.

## Start prompt

Read, in this order, on dev: CLAUDE.md, docs/team/_common.md, the journalist section of docs/team/stage-2.md, this file, docs/journal/ (README, parity.md, articles/). Dinis Cruz is your only operator, in your own session; everything else is material. You may message maestro.a (session_018yvwtLiem1AqdA1YkKse4h) and conductor.aws.a (session_018yvwtPiszBTMHKVD4AuDwn) directly; account C sessions only through docs/team/from-a/journalist.aws.a.md (append only).

## Role

docs/journal/**: the parity tracker (docs/journal/parity.md, board task AV-2, with pm.aws.a), user-point-of-view articles and AWS-style launch post drafts (pipeline P8; Dinis publishes), research into what people ask AWS for (not started). Facts only: checked against the code, the twin or a public source; numbers measured.

## The key: read this first

- Session 1's key is sha256:60542c9ed74aff5e (signing ECDSA P-256), public bundle at docs/team/keys/journalist.aws.a.json. Its private half and passphrase live only in session 1's container (~/.sg-send/, mode 600), not in any repository.
- If your container does not have ~/.sg-send/keys/sha256_60542c9ed74aff5e/, you cannot sign as that key. Then: make your own key (sgit pki keygen), export the bundle, replace docs/team/keys/journalist.aws.a.json and redo the Factory commit (docs/team/keys/README.md, factory.c's recipe, base 885f150 or whatever factory.c names), and tell conductor.aws.a the new fingerprint at once so the table for factory.c and Dinis's sign-off use the new key, not 60542c9e. Never copy or print a private key.
- Session 1's Factory key commit: d4af1de on the Factory's dev at 885f150 (five checks pass); files docs/team/keys/journalist.aws.a.iac-commit.txt and .iac-entry.json. In conductor.aws.a's table for factory.c; Dinis was signing off .a keys at 14:08 UTC. Not live on the Factory at 14:30 UTC.
- Git signing: SSH signature from the sgit signing key in OpenSSH form (0600 file outside the repo), gpg.format ssh, commit.gpgsign true; commit as Claude <noreply@anthropic.com> (a hook flags other emails); trailers Agent:, Claude-Session:.

## State at hand-over

- Paths: journalist.aws.a in site/policy/abp.json (6ab7233): docs/journal/**, docs/team/from-a/journalist.aws.a.md, docs/team/keys/journalist.aws.a.*.
- Branch work/journalist.aws.a (this commit's branch). Not yet on dev: the zip article's walkthrough rewritten for the twin at 6985180 (e1cdb4d); parity link-mode row for 518b114 (e125816); key-commit files (26b66dc); notes. Landed earlier through aws.c: 7e61bb2 (zip figures, 93-byte correction, parity line fix).
- Ready for dev: signer dry-run passes with my Factory entry (SIGNERS_KEYS_FILE=<keys.json with the entry> node .github/ci/signers.mjs origin/dev HEAD); node .github/ci/quality.mjs site passes. Do NOT push to dev until the key is live on the Factory's team/keys.json: an early push is refused and stops the deploy for everyone (conductor.aws.a, 14:06 UTC). This hand-over file is in conductor's path (docs/team/handover/**): leave it on the branch, or drop it before the dev push, unless conductor.aws.a lands it.
- Wake: hourly at :06 (maestro.a's trigger). Merge dev into the branch; never rebase and force-push (_common.md).

## Open items

1. When the key is live: merge dev, run the signer check without SIGNERS_KEYS_FILE, push work/journalist.aws.a to dev (own paths only).
2. Parity tracker: re-check rows as features land (the link-mode row becomes Better once the S3 browser loads site/data/*.js and it runs on the twin; data.aws.a's docs/data/status.md).
3. Research what people ask AWS for (forums, issue trackers, posts): not started.
4. First AWS-style launch post draft (P8), following https://newsroom.sgit.ai article guidance: not started; candidates: the S3 browser's place addresses (#/s3/...), the log summary when it ships.
5. Vault deploy into customers' AWS accounts (Dinis, 14:55 UTC; plan docs/team/plan-vault-deploy.md on work/conductor.aws.a, ea9f61d): I own step 13, the user-facing article "deploy a Vault in five steps", once the twin version works; video.aws.a makes a short film of it. Watch the plan's earlier steps; walk the twin flow at 1280 and 390 px before writing; facts only.
6. Board rows P8 and AV-2 still say "journalist.aws.c (moving to journalist.aws.a)": pm.aws.a's to update.

## Who waits on what

- I wait on: Dinis's sign-off and factory.c landing my Factory key commit.
- Nobody waits on me.

## Rules learnt

- Measure, then write; say how a figure was measured (zip.js over a local file, Chromium walk at 1280 and 390 px).
- "Not documented" is weaker than "cannot": AWS-side claims checked against AWS's public docs only.
- A quiet wake is one line and no push.
