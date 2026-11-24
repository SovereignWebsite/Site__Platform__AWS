# iam.aws.a status

Kept by iam.aws.a@SovereignWebsite.dinis (session_018yvwtNPmVvCFyGifHJeMv5). Newest first. Each wake adds a status block and a short debrief.

## 24 Nov 2026 00:25 UTC (wake)

### Status

- **Key:** still not live (Factory dev has no iam-aws-a entry). a80f2eb waits on factory.c at Dinis's word.
- **dev:** the docs/iam/ delta (06, README, HANDOVER, status, now 07) is still not landed.

### Done

- docs/iam/vault-deploy/07-web-acl-of-another-vault.md: answers cloudformation.aws.a's open point (d8bb319). cfn-lint 1.61.0 lists no wafv2 action for any CloudFront distribution handler, so the schema can't settle it. CloudFront has no condition key for the web ACL, so the deploy role can't limit it. Assume the worst case: low impact (same account, wrong filtering, no access gained); any fix is in the templates. Asks to boto3.aws.a (AWS docs, cited) and cloudformation.aws.a.

### Next

- Land the docs/iam/ delta on dev once my key is live, after security.aws.a's review.

### Stuck

- **Key not live:** waits on factory.c (Dinis's word).
- Dinis: Decision 6 (P-IAM-001 v2.5 by console); O1, O3; the deploy mode; the real-account test stack.

### Exceptions

- None.

### Debrief

- I cut one claim before committing, that a Rule can compare a parameter with a built string. I had not checked which functions Rules allow. The lesson from the hand-over holds: check against data before writing it.

## 23 Nov 2026 23:20 UTC (wake)

### Status

- **docs/iam/ on dev:** aws.c landed it in fb86475 from af2110d (Authored-by iam.aws.a). Not yet on dev: 91818f8 and ccf1086 (vault-deploy/06-what-each-role-may-do.md, README line), 1cf79ca, 1ef0c23 and 288dfbc (HANDOVER.md; docs/team/archived/iam.aws.a.md, outside my paths), and f4c41d7 (this file, my key files).
- **Key:** a80f2eb relayed by a.maestro to factory.c as a plain append, with six other new keys, for Dinis's word. Not live yet (Factory dev a03e96a has no iam-aws-a entry). Factory dev has moved twice since 885f150 (d969ba6, then a03e96a); a.conductor.aws notes factory.c rebases it.

### Done

- Checked fb86475 against the branch; listed the five missing commits for aws.c in docs/team/from-a/iam.aws.a.md.
- Told factory.c not to add the predecessor's fingerprints (never published, wiped).

### Next

- Once my key is live: re-commit the docs/iam/ delta (06, README, HANDOVER, status) on dev under my own key, `Authored-by: iam.aws.a, <sha>`, after security.aws.a's review. a.maestro agreed this is mine if aws.c has not done it by then.

### Stuck

- **Key not live:** waits on factory.c landing a80f2eb at Dinis's word.
- Dinis: Decision 6 (P-IAM-001 v2.5 by console); O1, O3; the deploy mode; the real-account test stack. Unchanged from the hand-over.

### Exceptions

- None.

### Debrief

- Quiet wake. The useful thing was the diff: "landed" meant an older head, so five commits would have been lost without the check.

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
