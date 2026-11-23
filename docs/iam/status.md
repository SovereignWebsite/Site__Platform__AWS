# iam.aws.a status

Kept by iam.aws.a@SovereignWebsite.dinis (session_018yvwtNPmVvCFyGifHJeMv5). Newest first. Each wake adds a status block and a short debrief.

## 23 Nov 2026 22:57 UTC (first wake of the restarted session)

### Status

- **Restart:** this session replaces session_018yvwtLi5HNUo32ot6ApGm8 (context past the limit), at Dinis Cruz's word relayed by a.maestro ("yes to A10, restart a.iam.aws", about 23:00 UTC 23 Nov). Hand-over read: docs/iam/HANDOVER.md at 1ef0c23.
- **Key:** made in this session with sgit-ai 0.27.0. Encryption sha256:9c828dc09276e039, signing sha256:cf44e76deda12e0e. Git signs with it (ssh-keygen; `ssh-keygen -y` matches bundle.sign). Decrypting the key for git was not refused, so no "signing key" blocker.
- **Factory commit:** a80f2ebc2df2dd713d3c7929af891df9fe717f02 on 885f150, id `iam-aws-a-sovereignwebsite` (the predecessor never published one, so no retire and no `-2`). Five checks pass locally. Files: docs/team/keys/iam.aws.a.iac-commit.txt and .iac-entry.json. Factory dev has moved to d969ba6 since 885f150; factory.c decides whether to rebase.
- **Bundles:** docs/team/keys/iam.aws.a.json is this session's; the predecessor's public bundle is kept as iam.aws.a.session-1.json (never live on the Factory).
- **docs/iam/ on dev:** not landed (origin/dev e252cac has no docs/iam/). aws.c was asked to re-commit it; I do not duplicate that. Once my key is live I can land it myself as re-commits with `Authored-by: iam.aws.a, <sha>`, if aws.c has not by then.

### Blocks

1. My key is not yet live on the Factory: waits on factory.c landing a80f2eb at Dinis's word. Until then nothing of mine can land on dev.
2. Dinis's open items from the hand-over: Decision 6 (P-IAM-001 v2.5 by console), O1, O3, the deploy mode, the real-account test stack.

### Debrief

- Lesson: this container's global git config sets `gpg.ssh.program=/tmp/code-sign`, which signs with the environment's own ED25519 key whatever `user.signingkey` says. The first Factory commit (ef4f180, never pushed) was signed that way and failed check-signatures. Set `gpg.ssh.program=ssh-keygen` in every repository's local config before committing.
