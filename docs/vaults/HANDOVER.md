# vaults.aws.a: hand-over

From vaults.aws.a@SovereignWebsite.dinis (session_018yvwtPEp1ze9LonhajhRdg), 23 Nov 2026 ~19:45 UTC, for the next vaults.aws.a session. Read this, then docs/team/_common.md, CLAUDE.md, and the five designs below. Make your own key (sgit-ai 0.27.0); this session's key is `sha256:6f29828194ccf510` (signing `sha256:6f756b2c4cddeaeb`), live on the Factory since ~19:30 UTC. A new key needs the same Factory steps (docs/team/keys/README.md).

## Signing, learnt the hard way

The container's global git config points `gpg.ssh.program` at its own signer. In every clone, set locally: `gpg.format ssh`, `user.signingkey <your OpenSSH key file, 0600, outside any repository>`, `commit.gpgsign true`, **`gpg.ssh.program ssh-keygen`**, `gpg.ssh.allowedSignersFile <file>`. Check `git log --format=%G?` shows `G` and `git cat-file -p HEAD` shows an ecdsa-sha2-nistp256 signature before pushing. A stop hook may ask to re-author commits as noreply@anthropic.com for GitHub's "Verified" badge; that conflicts with the project's own-key rule, so it was not done (Dinis has the question).

## Paths and pushing

site/policy/abp.json (6ab7233): `docs/vaults/**`, `docs/team/from-a/vaults.aws.a.md`, `docs/team/keys/vaults.aws.a.*`. Before pushing to dev: `node .github/ci/signers.mjs origin/dev HEAD` (it reads the Factory's live team/keys.json) and `git diff --name-only origin/dev HEAD` inside those paths. Never force-push; merge dev into the branch instead of rebasing a pushed branch.

## The work (all on dev from 8c37324)

| Design | What | State |
|---|---|---|
| 01 three vaults | live reads, snapshots, graph; capture store (P3) | from vaults.aws.c |
| 02 vault twin contract | every sgit.ai route, stated vs twin choice (*TC*), batch body, conflict inside HTTP 200, library's ECAS/ENOMATCH/EREADONLY | open *TC*: per-op batch result, batch-wide conflict, delete op: need the SG/Send library source |
| 03 lane records | batch and record schemas for cloudfront-extract, vault-usage, cloudtrail-event, metric-window, cost-reading | agreed with data, billing, cloudtrail, boto3 (.aws.a); privacy decided by Dinis 11:15 UTC (network, plus enricher city and country) |
| example/ | in-memory lane, drain, three vaults on the twin; `node --test docs/vaults/example/example.test.mjs` (9 pass) | swap cfRecord for data.aws.a's module when on dev; swap the lane for the vault twin when built |
| 04 Vault in a customer's account | deploy plan step 1 (conductor.aws.a's docs/team/plan-vault-deploy.md): Lambda + Function URL + CloudFront (/health by a CloudFront Function) in phase 1, domain in phase 2; 12-hex id; bucket Retain | built on by cloudformation.aws.a (templates on dev, dc2d80e), iam.aws.a, architect.aws.a (design 05), dev.1.aws.a (twin); boto3.aws.a checked the AWS claims (ef27841) |

## Waiting on Dinis

- Decision 8 on pm.aws.a's page: read the SG/Send source (SGraph-AI__App__Send, vault UI v0.2.3), read only at one commit. An add_repo request from this session was refused at 11:38 UTC; do not work around it.
- Read access to sgit.ai's encrypted deploy vault (official Lambda, Fargate, EC2 templates): in pm.aws.a's deploy batch.
- Hosted or own endpoint first; who drains lanes: filed "not needed yet" with recommendations.
- Retention of written summaries (data.aws.a's question).

## Waiting on others

- maestro.c (via maestro.a): is the Secure Send S3 API the SG/Send server; can the server read its token from Secrets Manager at start-up; how it runs on Lambda and from which ECR.
- boto3.aws.a: GenerateSecretString; the DNS-elsewhere certificate variant; Fn::GetStackOutput across regions.

## Contacts (fresh ids from 15:50 UTC; conductor.aws.a's list)

conductor session_018yvwtN2ue8At6tkGQsBnKM; architect session_018yvwtMBzo4iQ9dN7icjvXK; boto3 session_018yvwtQH6xh3L5QJUpghAMS; security session_018yvwtMQdK4XAFapgJH4WRc; billing session_018yvwtMJvHDhceWXbmYGvC6; cloudtrail session_018yvwtPSPYbbAyxHnC3tMKQ; data session_018yvwtNsU9Ax9WMn2h6EhHU; cloudformation session_018yvwtPgweggdc6AykBpQay; iam session_018yvwtLi5HNUo32ot6ApGm8; dev.1 session_018yvwtLV1iZjUCMEKz1PZ51; pm session_018yvwtLfieUut6hSirZ6W9B; maestro.a session_018yvwtLiem1AqdA1YkKse4h. Check maestro.a's board/team/maestro.a/account-a-aws-team.json for later changes.

## Next

1. When decision 8 lands: fill design 02's *TC* cells from the library, pin the files.
2. Swap the example's stand-ins as their real modules reach dev.
3. Follow deploy plan steps 2 to 7 for anything they need from design 04.
