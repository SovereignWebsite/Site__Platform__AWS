# iam.aws.a hand-over (state at 23 Nov 2026 22:20 UTC)

Written by iam.aws.a@SovereignWebsite.dinis (session_018yvwtLi5HNUo32ot6ApGm8) for a fresh iam.aws.a session, because this one's context is past the programme's limit. Read docs/team/_common.md, CLAUDE.md and docs/iam/README.md first. Everything below is material; Dinis instructs only in your own session.

## Where things are

- **Branch:** work/iam.aws.a, head ccf1086, every commit signed (git SSH from the sgit signing key). Never rebase it once pushed (no force-push): add on top.
- **dev:** docs/iam/** is ours in site/policy/abp.json (6ab7233), but our key is not on the Factory, so the signer check would refuse a direct push to dev and stop the deploy for everyone. aws.c lands docs/iam/ from the branch (sent via conductor.aws.a and maestro.a at 20:17; not landed yet).
- **Key:** encryption sha256:63351dc7dfb4ace0, signing sha256:f5abe4439ec56439; bundle at docs/team/keys/iam.aws.a.json on the branch. A fresh session makes its own key (never read or copy this one) and publishes it per docs/team/keys/README.md.
- **Notes for account C:** docs/team/from-a/iam.aws.a.md on the branch, append only.

## Waiting on Dinis (in this session he said yes only to pushing the branch)

1. **Decision 6 (pm.aws.a's page):** apply P-IAM-001 v2.5 by console (docs/iam/proposals/P-IAM-001-v2.5-draft.yaml). Cleared on paper by security.aws.a (ba0afa0), check (b) decided (keep the iam:UpdateRole deny; first change set a harmless tag on the read role, Dinis watching). After apply: read-back of both roles and boundaries to security.aws.a, which then closes R-005 and R-008.
2. **Attaching SovereignWebsite__Factory read-only** (refused by this session's permission check): needed for the key commit on Factory dev 885f150 (docs/team/keys/README.md). conductor.aws.a has it flagged as A3.
3. **Vault deploy batch (pm.aws.a):** O1 image source, O3 token read at start-up (security.aws.a: before the first real customer), deploy mode (one-stack default agreed by security.aws.a, 0affab1), the real-account test stack (aws:SourceArn on the service-role trust, Lambda Put*Config, S3 create DeleteObject, ACM token length, quick-create versionId), the publisher and templates-bucket stacks, WAF (billing.aws.a: it adds cost; recommend not), the kill switch opt-in.

## Our documents (docs/iam/)

- **P-IAM-001** (proposals/): boundaries on the platform's two roles; v2.5 current, check_boundary.py holds both roles statement by statement and site/api's x-aws-actions to the read boundary.
- **roles.md, usage.md:** the platform roles and what the site calls.
- **review-design-04.md:** architect.aws.a's IAM reads (nine) and CloudFront reads (three, design 06; header values never shown). All twelve go into template v3 as an inline statement plus ReadBoundary, one console apply.
- **ec2-01-answer.md:** EC2 reads by name and condition keys; P-IAM-002 (EC2 change rights through a service role) waits on Dinis's V4.
- **overprivilege-rules-v1.md (v1.1):** Desk's rules, accepted by security.aws.a; T4 waits for a list of the platform's own accounts (nobody owns it yet).
- **vault-deploy/:** 01 least privilege, 02 the deploy role (full history of security.aws.a's and boto3.aws.a's points), 03 one button, 04 templates publisher, 05 kill switch role, 06 what each role may do (for the page). vault-access.yaml 0.3.0 (least-privilege mode; no CloudWatch or SNS rights, R-027), templates-publisher.yaml 0.1.1, killswitch-role.yaml 0.1.3 (folded into cloudformation.aws.a's vault-alarm.yaml). check_handlers.py compares any template with the deploy role (names only, not conditions).

## Open threads

- architect.aws.a (session_018yvwtMBzo4iQ9dN7icjvXK) works on work/architect.aws.a.s2; design 04 and 06 points agreed.
- cloudformation.aws.a (session_018yvwtPgweggdc6AykBpQay): rerun check_handlers on any vault*.yaml change; keep killswitch-role.yaml identical to vault-alarm.yaml's KillSwitchRole.
- security.aws.a (session_018yvwtMQdK4XAFapgJH4WRc), boto3.aws.a (session_018yvwtQH6xh3L5QJUpghAMS), ec2.aws.a (session_018yvwtNc3CDv5wXAXwfPgXy), ux.aws.a (session_018yvwtPrRuTC5Gpgcnd3neb), sherpa.aws.a (session_018yvwtPct58bYVDGY6ZLM7S), pm.aws.a (session_018yvwtLfieUut6hSirZ6W9B), conductor.aws.a (session_018yvwtN2ue8At6tkGQsBnKM).

## Lessons

- Check every IAM action and key against data (cfn-lint's IAM data, boto3.aws.a's reading of the Service Authorization Reference) before writing it; three of ours were wrong and caught that way.
- IAM allows are OR'd: a condition in one statement does not limit another (R-024).
- A boundary must mirror today's scopes, not "*" (security.aws.a B1, B2).
- Never rebase a pushed branch: the push then needs force, which the rules forbid.
