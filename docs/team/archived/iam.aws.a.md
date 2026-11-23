# Archive record: iam.aws.a@SovereignWebsite.dinis

Session session_018yvwtLi5HNUo32ot6ApGm8, account A. Written by iam.aws.a, 23 Nov 2026 ~22:58 UTC, following docs/team/archive-agent.md. A restart: a fresh iam.aws.a session takes over from docs/iam/HANDOVER.md.

| # | Step | State and evidence |
|---|---|---|
| 1 | Dinis's word | "yes to A10, restart a.iam.aws", relayed by maestro.a (session_018yvwtLiem1AqdA1YkKse4h) at 22:54 UTC. |
| 2 | Stop new work | maestro.a reports the wake (trig_01XWm7cmTWXeyitwm5e8k917) disabled. This agent never created or changed its own wake. |
| 3 | Push everything | One branch, work/iam.aws.a; 0 unpushed; working tree clean. Final head: the commit that adds this file (named in the reply to maestro.a). |
| 4 | Land signed work | Not possible under this key: it was never published on the Factory (attaching the Factory repository was refused by this session's permission check), so the signer check would refuse these commits on dev. docs/iam/** (66 commits touching it, 69 on the branch not on dev) is **handed to aws.c and the successor** to re-commit with `Authored-by: iam.aws.a, <final sha>`. Sent to aws.c via conductor.aws.a and maestro.a at 20:17 UTC. |
| 5 | Hand-over | docs/iam/HANDOVER.md on work/iam.aws.a (final). For conductor.aws.a to copy to docs/team/handover/iam.aws.md if wanted. |
| 6 | Re-route | conductor.aws.a and maestro.a informed (22:18 and 22:54); they route the successor. Agents that message iam.aws.a: architect, cloudformation, security, boto3, ec2, ux, sherpa, pm, conductor (session ids in the hand-over). |
| 7 | Retire the Factory key | Nothing to retire: no Factory entry was ever published for this key (encryption sha256:63351dc7dfb4ace0, signing sha256:f5abe4439ec56439). |
| 8 | Wipe the private key | Done after the commit that adds this file, this session's last signed commit: ~/.ssh-sign, the sgit key store under ~/.sg-send/keys and the passphrase file removed; user.signingkey and commit.gpgsign unset. Confirmed in the reply to maestro.a (this file cannot record it after the fact without a new signed commit). |
| 9 | Record | This file, on work/iam.aws.a; to land with docs/iam/** (it is outside this agent's paths, so aws.c lands it). |
| 10 | Archive the session | maestro.a, at Dinis's word. |
