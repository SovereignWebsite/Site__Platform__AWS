# Vault deploy, step 3, draft 2: the deploy role, the function's role, and what IAM cannot say

iam.aws.a, 23 Nov 2026 ~15:20 UTC. Builds on [01-least-privilege.md](01-least-privilege.md). Inputs: vaults.aws.a's design 04 (work/vaults.aws.a a0c53a4: phase 1 bucket, secret, function, Function URL, log group in the chosen region; phase 2 ACM in us-east-1, CloudFront, Route 53) and security.aws.a's early review (work/security.aws.a 846735b, points 1 to 6). Not yet known, so not written as fact: the exact S3 actions the server uses, how the Lambda is packaged (image registry), whether CloudFormation sets `aws:SourceArn` when it assumes a service role. Marked *open*. `<id>` is the Vault's id; `<acct>`, `<region>` from the stack.

## Roles

| Role | Trusted by | Purpose |
|---|---|---|
| `sws-vault-<id>-deploy` (bootstrap stack) | `cloudformation.amazonaws.com` only, with `aws:SourceAccount` = `<acct>`; `aws:SourceArn` exactly `stack/sws-vault-<id>/*` and `stack/sws-vault-<id>-edge/*`, no `*` after the id, if CloudFormation sets it (*open*, security 1 and 17) | The service role both Vault stacks run with |
| `sws-vault-<id>-api` (Vault stack) | `lambda.amazonaws.com` only, with `aws:SourceAccount` = `<acct>` | The function's runtime rights; carries the Vault boundary |

The deploy role is not a principal the customer's users assume; their console user needs only CreateStack, UpdateStack, DeleteStack and Describe on the three stacks named exactly (`stack/sws-vault-<id>-access/*`, `stack/sws-vault-<id>/*`, `stack/sws-vault-<id>-edge/*`) and `iam:PassRole` on the deploy role.

## The deploy role's policy, by service (from design 04)

| Service | Allow | Scope and conditions |
|---|---|---|
| S3 | CreateBucket, PutBucketPublicAccessBlock, PutEncryptionConfiguration, PutBucketVersioning, PutBucketPolicy, PutBucketTagging, GetBucket* | `arn:aws:s3:::sws-vault-<id>-*`. **No DeleteBucket** (design 04's Retain: data is never deleted as a side effect, so the role cannot) |
| Secrets Manager | CreateSecret, DescribeSecret, DeleteSecret, TagResource, GetRandomPassword | `secret:sws-vault-<id>-*`; GetRandomPassword on `*` (it names no resource). No GetSecretValue (see "The token" below) |
| IAM | CreateRole, DeleteRole, GetRole, PutRolePolicy, DeleteRolePolicy, TagRole | `role/sws-vault-<id>-api` only; CreateRole **only with** `iam:PermissionsBoundary` = the Vault boundary's ARN |
| IAM | PassRole | `role/sws-vault-<id>-api`, `iam:PassedToService` = `lambda.amazonaws.com` |
| Lambda | CreateFunction, GetFunction, UpdateFunctionCode, UpdateFunctionConfiguration, DeleteFunction, TagResource, Create/Get/Update/DeleteFunctionUrlConfig, AddPermission, RemovePermission | `function:sws-vault-<id>-*`; CreateFunctionUrlConfig and AddPermission with `lambda:FunctionUrlAuthType` = the agreed auth type (below); AddPermission's `lambda:Principal` limited to what step 1 names (security 3) |
| Lambda image | the registry reads for the image | *open*: design 04 says Lambda images come from ECR in the same region; which repository, and whose, decides this row |
| Logs | CreateLogGroup, PutRetentionPolicy, DeleteLogGroup, TagResource | `log-group:/aws/lambda/sws-vault-<id>-*` |
| ACM (us-east-1, phase 2) | RequestCertificate, DescribeCertificate, DeleteCertificate, AddTagsToCertificate | create only with `aws:RequestTag/sws-vault` = `<id>`; change and delete only with `aws:ResourceTag/sws-vault` = `<id>` |
| CloudFront (phase 1 since design 04 23f8b03) | CreateDistribution (with tags), GetDistribution, UpdateDistribution, DeleteDistribution, TagResource | same tag rule; *open* whether CloudFront supports `aws:RequestTag` on create (boto3.aws.a to check) |
| CloudFront Function `/health` | CreateFunction, DescribeFunction, UpdateFunction, PublishFunction, DeleteFunction | `arn:aws:cloudfront::<acct>:function/sws-vault-<id>-health` by name (no tag rule needed) |
| Route 53 (phase 2) | ChangeResourceRecordSets, GetChange, GetHostedZone | `hostedzone/<zone id>` named by id (a stack parameter); `route53:ChangeResourceRecordSetsNormalizedRecordNames` ForAllValues:StringEquals [the Vault's name, the certificate's `_` validation name]; `route53:ChangeResourceRecordSetsRecordTypes` ForAllValues:StringEquals [A, AAAA, CNAME]: no NS, no SOA, no delegation, no apex unless the customer chose it (security 5) |
| Deny | iam:UpdateAssumeRolePolicy, Put/DeleteRolePermissionsBoundary, CreatePolicyVersion, SetDefaultPolicyVersion, DeletePolicy on the boundary, CreateUser, CreateAccessKey, CreateLoginProfile; s3:DeleteBucket, s3:DeleteBucketPolicy; every Tag action on a resource that does not already carry `sws-vault` = `<id>` | `*` |

**Tag hijack (security 4).** Scoping by `aws:ResourceTag` alone would let the role tag a customer's existing resource and then change or delete it. So the `sws-vault` tag is allowed only in the create request (`aws:RequestTag` on Create*), and standalone Tag and Untag actions are allowed only on resources that already carry `sws-vault` = `<id>` (and never to change that tag's value). Where a service cannot tag at create, the resource is scoped by name instead.

## The function's role and the Vault boundary

`sws-vault-<id>-api`: S3 on `arn:aws:s3:::sws-vault-<id>-data` and its objects, the actions the server uses (*open* until its source is read: design 04 section 8); `secretsmanager:GetSecretValue` on the one secret if the server reads it at start-up; logs on its own log group. The Vault boundary (bootstrap stack) is the same list: the most the function can ever do, whatever the Vault template says.

**A role that trusts another account (security 2).** A boundary caps rights, not who may assume the role. So: the deploy role cannot call UpdateAssumeRolePolicy at all (denied); the function role's trust is set at create, `lambda.amazonaws.com` only; and the bucket's policy refuses any principal outside the customer's account (`aws:PrincipalAccount` not equal to `<acct>`), plus non-TLS requests.

## What IAM cannot say (gaps, recorded, not hidden)

1. **"Only at create" for bucket settings (security 3).** IAM cannot tell CreateBucket's follow-up PutBucketPublicAccessBlock and PutBucketPolicy apart from the same calls a year later. With the actions allowed, a tampered later template could loosen them. Mitigations: the template is pinned and hashed (security 6); the deploy role is used only by stacks named `sws-vault-<id>*`; drift detection shows a change; and the page recommends the customer turn on S3 Block Public Access for the whole account (one console setting, outside our stack), which overrides any bucket setting.
2. **The token.** design 04 puts the token in the function's environment. A CloudFormation dynamic reference (`{{resolve:secretsmanager:...}}`) resolves at deploy time with the service role's rights, so the deploy role would need GetSecretValue, and the value then sits in the function's configuration, readable by anyone in the customer's account with `lambda:GetFunctionConfiguration`. Recommendation: the server reads the secret at start-up (the function role holds GetSecretValue on that one secret, the deploy role never does); a change for the server's owners (design 04 section 8, question 2). Until then: the dynamic reference, with GetSecretValue on that one secret for the deploy role, written as a known gap.

## The Function URL's auth type (security 3 against design 04)

security.aws.a's position: AWS_IAM or no URL. design 04: NONE, because the server's own token gates every route and IAM auth breaks sgit and browser clients. My view:

- **Phase 1 (no domain): NONE, accepted for v1**, since the token gates every server route, reads included (the end-of-deploy `/health` is a CloudFront Function on that one path, not a server route), and the URL is the Vault's only address. Recorded as a public endpoint in the risks, not as a gap in IAM. The deploy role may create a URL only for `function:sws-vault-<id>-*` and only with the agreed auth type, so it cannot open any other function.
- **Phase 2 (CloudFront in front): AWS_IAM on the Function URL with CloudFront origin access control for Lambda**, so only the distribution can call the function and the URL stops being public. *open*, for boto3.aws.a: whether origin access control for Lambda Function URLs passes PUT and POST bodies from sgit clients without the client signing the payload; if it does not, phase 2 stays NONE with the token.

security.aws.a ruled: NONE accepted for phase 1 on conditions (below). Note on `/health`: the CloudFront Function answering it shows only that the distribution answers, not that the server runs; the end-of-deploy check is worded that way.

## Next

When cloudformation.aws.a's step 2 template exists: a check like docs/iam/check_boundary.py that every action the template's resources need is inside the deploy role, and nothing more; then items 7 to 12 of security.aws.a's review.

## security.aws.a's review of draft 2 (15:40 addendum, 59eb4c5), taken in

Points 1 to 6 accepted and the two gaps accepted as recorded. Ruling on the Function URL: **phase 1 NONE accepted for v1** on conditions (a) to (e); phase 2 target AWS_IAM with origin access control.

**Changes to the deploy role (supersede the tables above where they differ):**

- **Ids (point 17).** `<id>` is 12 lower-case hex characters, enforced by `AllowedPattern: "^[0-9a-f]{12}$"` in every stack, so `sws-vault-<id>-*` can never match another Vault's resources (an id with "-" would let `sws-vault-ab-*` match Vault `ab-c`). Three stacks, named exactly: `sws-vault-<id>-access` (bootstrap), `sws-vault-<id>` (the Vault), `sws-vault-<id>-edge` (us-east-1 certificate). The deploy role's `aws:SourceArn` names the two it runs: `stack/sws-vault-<id>/*` and `stack/sws-vault-<id>-edge/*`, no `*` after the id.
- **Logs (point 19).** The log group is the Vault's audit trail: `DeletionPolicy: Retain`, and the deploy role loses logs:DeleteLogGroup.
- **Self-protection (point 20).** Deny every action on `role/sws-vault-<id>-deploy` and on the Vault boundary policy, and `cloudformation:*` on any stack but the three above.
- **Secrets (point 21).** Deny secretsmanager:PutResourcePolicy and ReplicateSecretToRegions.
- **Function URL (condition d).** AddPermission with principal `*` only together with `lambda:FunctionUrlAuthType` = NONE, i.e. for lambda:InvokeFunctionUrl, never for lambda:InvokeFunction. *check* (boto3.aws.a): whether IAM can tell the two apart on AddPermission by that condition key alone; if not, the template check (below) enforces it.
- **Denial of wallet (condition c).** Reserved concurrency is a stack parameter with a low default; billing.aws.a to price a flood (requests up to that concurrency for an hour).

**Conditions on the server and the template, for vaults.aws.a and cloudformation.aws.a:** (a) the token is at least 32 random bytes (GenerateSecretString length), compared in constant time, sent in a header only, never in a URL, never logged; (b) every server route is gated by the token: `/health` is not a server route but the CloudFront Function on that one path (design 04 section 4a), returning `{ vault_id, template_version }` and nothing else; (e) a risk row once code exists.

**Token (point 18).** The token in the function's configuration (dynamic reference) is acceptable in the twin only. Before the first real customer the server should read the secret at start-up (design 04 section 8 question 3, with the server's owners). For Dinis's batch.

**Still waiting on Dinis** (vaults.aws.a, f4704f1): the server's S3 actions (question 2, decision 8) for the function role and the boundary; the image's ECR source (question 4: the official template's way, or an ECR repository per region in our account pulled across accounts, which would add a cross-account read to the deploy role's image row).

## Against cloudformation.aws.a's Vault stack 0.2.0 (7ea995f)

Settled in 0.2.0: names `sws-vault-<id>-*` (the function role is `sws-vault-<id>-api`, renamed here to match; the bucket `sws-vault-<id>-data-<acct>-<region>`, inside the `sws-vault-<id>-*` scope); the boundary `policy/sws-vault-<id>-boundary` lives in the `-access` stack and the Vault stack only references it; ImageUri must be an ECR URI pinned by `@sha256` digest (AllowedPattern). On the digest: if the image comes from an ECR repository of ours, we are the customer's supply chain; the digest is what lets them check it stays the image they were shown.

Still to settle with cloudformation.aws.a: the bucket and the log group are `DeletionPolicy: Delete`; design 04, security.aws.a and this role say Retain (the deploy role has no s3:DeleteBucket or logs:DeleteLogGroup, so with Delete the stack's teardown would fail on them). And VaultId is `^[a-z0-9]{4,12}$`: safe from prefix collisions because every name has "-" after the id, but security.aws.a asked for a fixed length (12 hex).

## The access stack, draft 0.1.0 (16:00 UTC)

[vault-access.yaml](vault-access.yaml): stack `sws-vault-<id>-access`, the deploy role and the Vault boundary as written above, built against cloudformation.aws.a's list (7ea995f) and checked with cfn-lint 1.61.0, whose IAM action data caught one wrong name (`cloudfront:CreateDistributionWithTags` is an API, not an IAM action: CreateDistribution plus TagResource). Clean now. Optional parts by condition: Route 53 only with a hosted zone, ACM only with a domain, ECR only with an image repository, GetSecretValue only while `ReadTokenAtDeploy` is true (twin only, point 18). Deliberately not granted, against cloudformation.aws.a's list: s3:DeleteBucket and logs:DeleteLogGroup (Retain; asked of cloudformation.aws.a). Still *check* before the twin runs it: CloudFormation setting `aws:SourceArn`; `lambda:FunctionUrlAuthType` on AddPermission; `aws:RequestTag` on CloudFront and ACM creates; the Route 53 normalized-name condition with `_*.` for the certificate's validation record.

0.1.1 (16:10 UTC): VaultId `^[0-9a-f]{12}$`, matching vault.yaml 0.3.0 (e92ee88), which also makes the bucket and the log group Retain (DeletionPolicy and UpdateReplacePolicy), adds the bucket policy's deny for other accounts (aws:PrincipalAccount) and an optional ReservedConcurrency (covered by Put/DeleteFunctionConcurrency here). On 0.2.0's AccessTokenSecretArn (bring your own secret): the deploy role's GetSecretValue stays on `secret:sws-vault-<id>-token-??????` only, whatever the template passes (security.aws.a); a secret named otherwise cannot be read at deploy and the stack fails, safely.

## 0.1.2 (16:20 UTC): security.aws.a's review of 0.1.0 (28642a5)

- **(1) CloudFront tag hijack, fixed.** The create statement now holds only CreateDistribution (with `aws:RequestTag/sws-vault` = `<id>`); TagResource sits with the other changes, only where the distribution already carries `sws-vault` = `<id>`; and an explicit deny (NeverTagOthers) refuses Tag and UntagResource on any distribution that does not. Consequence to test in the twin: if CloudFormation creates the distribution with CreateDistributionWithTags and that needs TagResource on the new, still untagged distribution, creation fails; then the fallback is scoping by the distribution's id (an output passed back on update), not a self-applied tag.
- **(2) DNS names tightened.** The certificate's validation name is `_` plus 32 single-character wildcards directly under the domain, not `_*`, so it cannot match `_acme-challenge` or `_dmarc` (length to be confirmed by boto3.aws.a against ACM's documented shape). `ChangeResourceRecordSetsActions` is now named (CREATE, UPSERT, DELETE); those are all CloudFormation uses, so it documents rather than narrows.
- **(3), (4) for boto3.aws.a before the twin run:** FunctionUrlAuthType on AddPermission (and whether public Function URLs now also need a lambda:InvokeFunction permission, which would then have to be limited to calls through the URL); whether CloudFormation sets `aws:SourceArn`. If SourceArn has to go, the customer text says: give iam:PassRole on the deploy role only to the people who run this Vault.
- **(5) Inline code bypasses the image pin.** CreateFunction would also accept an inline ZipFile, skipping the digest. Lambda's code-signing condition applies to zip packages only, so it cannot force an image; written into the trust paragraph as a gap, held by the pinned template hash.
- **(6)** While ReadTokenAtDeploy is true outside the twin, the deploy page shows it as a known gap (for dev.2.aws.a and ux.aws.a).
- **(7)** One VaultId pattern, `^[0-9a-f]{12}$`, already in 0.1.1.

## 0.1.3 (16:35 UTC): the deploy role against the resource handlers

[check_handlers.py](check_handlers.py) compares, for every resource type in vault.yaml and vault-edge.yaml (cloudformation.aws.a 0.3.2), the permissions its CloudFormation create, update and delete handlers list (the resource schemas cfn-lint 1.61.0 ships, a snapshot of the registry) with the deploy role. A schema lists every permission a handler may need for any property, so a gap means "check this template's properties", not "certainly broken". Added in 0.1.3, each scoped to this Vault's resources: IAM role delete's List and Detach reads; Lambda read handlers' Get (code signing, runtime management, recursion); Logs Untag and GetDataProtectionPolicy; Secrets Manager UpdateSecret, Untag, RemoveRegionsFromReplication; S3 GetBucketAcl, ListBucket, Tag and Untag on the bucket; ACM RemoveTags and UpdateCertificateOptions on its own certificate; CloudFront Untag (and tagging on the health function, which NeverTagOthers no longer covers: it applies to distributions only); route53:ListHostedZones.

Left out after the check, and why: KMS, VPC, EFS, S3 Tables, replication, website, analytics, inventory, lifecycle, logging, metadata tables, private CA, connection groups and VPC origins (properties this template does not use; if a later template uses one, the stack fails safely and the role grows by review); s3:GetObject and GetObjectVersion on Lambda create (code from an S3 zip, which this template does not use: leaving it out also blocks that path around the image pin); and the deliberate denies (DeleteBucket, DeleteBucketPolicy, DeleteLogGroup, ReplicateSecretToRegions, AttachRolePolicy, trust and boundary edits). One conflict for boto3.aws.a: the CloudFront schema lists `cloudfront:CreateDistributionWithTags`, while cfn-lint's IAM action data says no such IAM action exists.

From cloudformation.aws.a's review (b35a61d): the bucket policy is now Retain too (my deny on DeleteBucketPolicy would have failed the stack's deletion); VaultId was already 12 hex in 0.1.1; HostedZoneId: mine allows 32 characters in all (`Z` plus up to 31), theirs 33; Route 53's documentation to settle it (boto3.aws.a). For the page: adding a domain later means updating `-access` first (DomainName and HostedZoneId add the ACM and Route 53 rights), then `-edge`, then `sws-vault-<id>`.

## 0.1.4 (16:45 UTC): security.aws.a's re-review of 0.1.2 (30603d3)

(1), (5) and (7) closed or accepted. (2), last Low: in StringLike "?" also matches ".", so the 32-character validation pattern could still match a two-label name of the same length (`_acme-challenge.` + a 16-character label + the domain: DNS-01 for a new subdomain). 0.1.4 adds NeverDeeperNames, a deny on ChangeResourceRecordSets when any name matches `*.*.<domain>`. Checked by pattern: the Vault's name and ACM's one-label token pass; `_acme-challenge.<16>.<domain>` and any `x.<domain>` are refused. security.aws.a has no objection to the twin run. Before a real account: boto3.aws.a's checks (FunctionUrlAuthType on AddPermission and any InvokeFunction need; aws:SourceArn; the handler permissions and the CreateDistributionWithTags conflict; HostedZoneId length), the twin's CreateDistributionWithTags result, and Dinis's O1 (image source) and O3 (token at start-up).

## 0.1.5 (17:15 UTC): boto3.aws.a note 08 (ef27841)

- New Function URLs need both lambda:InvokeFunctionUrl and lambda:InvokeFunction in the function's resource policy (Lambda guide, urls-auth, read 23 Nov 2026). The second AddPermission is not granted yet: it must be limited to calls through the URL by Lambda's condition key for that, whose name boto3.aws.a is to confirm; a public InvokeFunction without it is what security.aws.a ruled out (condition d).
- Creating a function from an ECR image needs GetRepositoryPolicy and SetRepositoryPolicy on the caller (images-create): added, scoped to the one repository. SetRepositoryPolicy acts only in this account; for an image in our account the repository owner sets the policy (O1 decides which).

## vault.yaml 0.3.3 (35fa42c): the InvokeFunction permission

cloudformation.aws.a added VaultFunctionInvokePermission (lambda:InvokeFunction, Principal "*", InvokedViaFunctionUrl: true), as boto3.aws.a's note 08 requires for Function URLs made since October 2025. The template limits it to calls through the URL; the deploy role does not yet allow adding it (FunctionUrlNoneOnly requires lambda:FunctionUrlAuthType, which this permission does not carry). It stays refused until boto3.aws.a confirms an IAM condition key that matches InvokedViaFunctionUrl, so the role can allow exactly that and no public InvokeFunction otherwise. check_handlers.py shows Lambda::Permission clean because it matches action names, not conditions (now said in its docstring).

0.1.6 (17:25 UTC): InvokeOnlyThroughTheUrl allows the second AddPermission only with `{"Bool": {"lambda:InvokedViaFunctionUrl": "true"}}` and `lambda:Principal` = `*`, on this function, never IfExists (boto3.aws.a: the key and its example from the Lambda guide, urls-auth; the Service Authorization Reference lists it for AddPermission in its key table but not in the action row, so to confirm). If the key is absent at AddPermission the condition fails closed: the stack fails at deploy, InvokeFunction is never opened.
