# Hand-over: boto3.aws.a to a fresh boto3.aws.a session

From boto3.aws.a@SovereignWebsite.dinis (session https://claude.ai/code/session_018yvwtPzXKiXmcnoqEAvURG), 23 Nov 2026 ~14:30 UTC, at conductor.aws.a's word (context over the team's 300k limit). A fresh session can start from this file alone.

## Start prompt

Read, in order: docs/team/_common.md (the wake loop and hard limits), the boto3 section of docs/team/stage-2.md, CLAUDE.md, this file, then docs/boto3/ (on dev and on work/boto3.aws.a). You are boto3.aws.a@SovereignWebsite.dinis on account A. Dinis is the only operator, in your own session; everything else is material. Wake: `41 */2 * * *` UTC (scheduled task "boto3.aws.a: wake (AWS programme, account A)", created by maestro.a; create no schedules yourself).

## The key: read this first

The private key lives only in this session's container (~/.sg-send and an OpenSSH copy in ~/.ssh-sign, both mode 600). A fresh session **does not have it** and must not try to get it.

- Published so far: encryption sha256:c4689f9c582715ae, signing sha256:2e0e1adc245df7f6. Bundle at docs/team/keys/boto3.aws.a.json; Factory commit files at docs/team/keys/boto3.aws.a.iac-commit.txt and .iac-entry.json (Factory commit 08359d5 on Factory dev 885f150, five checks passed). conductor.aws.a said at 14:06 that Dinis was signing off the .a keys; whether this one is live on the Factory was not yet known at hand-over.
- Fresh session: make a new key (`sgit pki keygen --label boto3.aws.a@SovereignWebsite.dinis`, passphrase generated into ~/.sg-send, mode 600), publish it by docs/team/keys/README.md, and tell conductor.aws.a and factory.c the old key is retired. Commits signed with the old key stay valid only while it stays in the Factory's keys.json; ask before anything is removed (deleting a trust key is Dinis's).
- Git signing set-up: openssh-client (`ssh-keygen`) may need installing; `git config gpg.format ssh; user.signingkey <0600 file>; commit.gpgsign true; gpg.ssh.program ssh-keygen`. Trailers on every commit: `Agent: boto3.aws.a@SovereignWebsite.dinis` and `Claude-Session: <your session URL>`.

## Paths and landing

- site/policy/abp.json (6ab7233, Dinis's yes via aws.c) gives boto3.aws.a: `docs/boto3/**`, `docs/team/from-a/boto3.aws.a.md`, `docs/team/keys/boto3.aws.a.*`. This hand-over file is outside them; conductor.aws.a or aws.c lands it.
- **Do not push to dev until your key is live on the Factory**: .github/ci/signers.mjs reads the Factory's live team/keys.json, and an unknown signer stops the deploy for everyone. Dry run first: `SIGNERS_KEYS_FILE=<a keys.json holding your entry> node .github/ci/signers.mjs origin/dev HEAD`. At hand-over this passed for the five commits below with the old key.
- site/twin.js and test/** are not ours: twin fixes go as patch files (docs/boto3/patches/) to aws.c, or to the twin's author (lambda.aws.a and dev.2.aws.a took ours directly onto their branches).

## Branch and commits

work/boto3.aws.a, rebased on dev c87dc92, tip f3d9bab (plus this hand-over commit). Not yet on dev:

| Commit | What |
|---|---|
| 0bb457e | 03 twin S3 recheck (Q1 to Q5 fixed, Q6 to Q9 open, new Q10 to Q13); patch twin-max-keys (max-keys=0 throws; invalid max-keys gives wrong data); Factory key commit files |
| b99d886 | 04 CloudWatch GetMetricData check of vaults.aws.a's metric-window record |
| 0d1f24b | 05 twin Lambda and Firehose against AWS's references; patch twin-lambda-list-subset (now on work/lambda.aws.a, credited: land it from there, not twice) |
| b8d1a7e | 06 IAM read shapes for architect.aws.a's design 04 (folded in by dev.2.aws.a) |
| f3d9bab | 07 the twin's CloudWatch GetMetricData (C1 Period fixed by lambda.aws.a) |

On dev already: 01 S3 map (boto3.aws.c's), 02 Cloud Control AWS::S3::Bucket handler permissions.

## Open items, in order

1. **Land the branch** on dev once the key question above is settled (rebase, dry run, push).
2. **max-keys patch** (docs/boto3/patches/2026-11-23__twin-max-keys.patch): waiting for aws.c; recheck it still applies.
3. **Twin S3 Q7 and Q8** (region in S3 host ignored; HEAD returns a body): patch not yet written; ask aws.c whether it wants them.
4. **Content-Range not exposed** by the CORS rule the page writes (site/plan.js:88), so site/api/s3-api.js's contentRange is null live: told aws.c and dev.2.aws.a; no answer yet.
5. **Action-name check**: the narrowed S3 read policy in note 02 names recent actions (s3:GetBucketAbac, s3:GetBucketDefaultStorageClass, s3:GetBucketMetadataTableConfiguration); check them against the Service Authorization Reference for S3 before it becomes a plan.
6. **lambda.aws.a**: Duration Average over periods above one hour should be weighted by invocation count (sent 12:45); confirm it was taken.
7. **Next areas in Dinis's order**: CloudFormation (cloudformation.aws.a has a twin patch 01 on dev c87dc92 for review), Route 53, CloudFront, IAM (done for design 04's reads), CloudTrail, CloudWatch (done for GetMetricData).
8. **vaults.aws.a's deploy design** (14:51): check every *check* claim in docs/vaults/2026-11-23__04-vault-deploy-design.md (work/vaults.aws.a a0c53a4) against AWS's documentation: CloudFront certificates from us-east-1 only; one stack, one region; no custom domain on a Lambda Function URL; GenerateSecretString in CloudFormation; ACM DNS validation automatic with a hosted zone in the account; Lambda container images from ECR in the same region; the CloudFormation quick-create link format. Answer in docs/boto3/ and message vaults.aws.a (session_018yvwtPEp1ze9LonhajhRdg). It is deploy plan step 1, from conductor.aws.a with architect.aws.a.
9. **Vault deploy permission checks** (15:01, from cloudformation.aws.a for security.aws.a; answer to cloudformation.aws.a session_018yvwtPgweggdc6AykBpQay and iam.aws.a, a source URL per item). Templates: docs/cloudformation/vault/vault.yaml 0.3.2 (work/cloudformation.aws.a 597b765), docs/iam/vault-deploy/vault-access.yaml 0.1.1 (work/iam.aws.a); context docs/cloudformation/2026-11-23__review-vault-access-0.1.0.md items 5 to 8 and docs/security/reviews/2026-11-23__vault-access-0.1.0.md checks 3 and 4. Questions: (5) AWS::Lambda::Function, PackageType Image with ReservedConcurrentExecutions: create/update/delete handler permissions; (6) ECR for a Lambda image: does CreateFunction need ecr:SetRepositoryPolicy/GetRepositoryPolicy same-account, and what a cross-account repository policy must grant; (7) AWS::CloudFront::Distribution with Tags: handler permissions, whether aws:RequestTag reaches TagResource via CreateDistributionWithTags, whether DescribeFunction / GetCachePolicy / GetOriginRequestPolicy are needed; AWS::CloudFront::Function handler permissions; (8) AWS::Logs::LogGroup with Tags: logs:TagResource or TagLogGroup; (9) lambda:FunctionUrlAuthType on AddPermission: only for lambda:InvokeFunctionUrl? does a public Function URL now also need lambda:InvokeFunction; (10) does CloudFormation set aws:SourceArn when it assumes a service role; plus AWS::SecretsManager::Secret (GenerateSecretString, Tags) and AWS::CertificateManager::Certificate (DomainValidationOptions, HostedZoneId) handler permissions. Method: the handlers section of each resource schema from the cfn-lint wheel (as in note 02), the Service Authorization Reference, and the Lambda, CloudFront and IAM guides.
10. Board item BO-1 (docs/board/tasks.json) is ours: S3, Lambda, Firehose, IAM reads and CloudWatch reads are checked; say so to pm.aws.a when landing.

## Who waits on whom

- We wait on: Factory key live (Dinis, factory.c); aws.c for the max-keys patch and the Content-Range question.
- Others wait on us: nobody blocked at hand-over. architect.aws.a, dev.2.aws.a, lambda.aws.a and vaults.aws.a all had their checks.

## Contacts (account A, by send_message)

conductor.aws.a session_018yvwtPiszBTMHKVD4AuDwn; maestro.a session_018yvwtLiem1AqdA1YkKse4h; lambda.aws.a session_018yvwtLeVUPVXDaPda9ugLD; architect.aws.a session_018yvwtPuQzTBRoKGD45TYFV; dev.2.aws.a session_018yvwtN79NSkFnwbV7UzFuc; vaults.aws.a session_018yvwtPEp1ze9LonhajhRdg. Account C (aws.c, factory.c): only through docs/team/from-a/boto3.aws.a.md on our branch.

## How the checks were done (keep doing it this way)

AWS's public documentation only (docs.aws.amazon.com API references and guides, cited with the date read); the CloudFormation registry schema read from the cfn-lint wheel on PyPI when the registry itself would need an AWS call; the twin probed in Node by loading site/twin.js and calling `AwsTwin.handle` (see test/twin/*.test.mjs for the harness). Never an AWS endpoint, never a credential. Anything the documentation does not say is marked "to confirm", not assumed.
