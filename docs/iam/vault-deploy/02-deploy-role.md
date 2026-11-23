# Vault deploy, step 3, draft 2: the deploy role, the function's role, and what IAM cannot say

iam.aws.a, 23 Nov 2026 ~15:20 UTC. Builds on [01-least-privilege.md](01-least-privilege.md). Inputs: vaults.aws.a's design 04 (work/vaults.aws.a a0c53a4: phase 1 bucket, secret, function, Function URL, log group in the chosen region; phase 2 ACM in us-east-1, CloudFront, Route 53) and security.aws.a's early review (work/security.aws.a 846735b, points 1 to 6). Not yet known, so not written as fact: the exact S3 actions the server uses, how the Lambda is packaged (image registry), whether CloudFormation sets `aws:SourceArn` when it assumes a service role. Marked *open*. `<id>` is the Vault's id; `<acct>`, `<region>` from the stack.

## Roles

| Role | Trusted by | Purpose |
|---|---|---|
| `sws-vault-<id>-deploy` (bootstrap stack) | `cloudformation.amazonaws.com` only, with `aws:SourceAccount` = `<acct>`; `aws:SourceArn` like `arn:aws:cloudformation:*:<acct>:stack/sws-vault-<id>*/*` if CloudFormation sets it (*open*, security 1) | The service role both Vault stacks run with |
| `sws-vault-<id>-fn` (Vault stack) | `lambda.amazonaws.com` only, with `aws:SourceAccount` = `<acct>` | The function's runtime rights; carries the Vault boundary |

The deploy role is not a principal the customer's users assume; their console user needs only `cloudformation:*Stack*` on `stack/sws-vault-<id>*` and `iam:PassRole` on the deploy role.

## The deploy role's policy, by service (from design 04)

| Service | Allow | Scope and conditions |
|---|---|---|
| S3 | CreateBucket, PutBucketPublicAccessBlock, PutEncryptionConfiguration, PutBucketVersioning, PutBucketPolicy, PutBucketTagging, GetBucket* | `arn:aws:s3:::sws-vault-<id>-*`. **No DeleteBucket** (design 04's Retain: data is never deleted as a side effect, so the role cannot) |
| Secrets Manager | CreateSecret, DescribeSecret, DeleteSecret, TagResource, GetRandomPassword | `secret:sws-vault-<id>-*`; GetRandomPassword on `*` (it names no resource). No GetSecretValue (see "The token" below) |
| IAM | CreateRole, DeleteRole, GetRole, PutRolePolicy, DeleteRolePolicy, TagRole | `role/sws-vault-<id>-fn` only; CreateRole **only with** `iam:PermissionsBoundary` = the Vault boundary's ARN |
| IAM | PassRole | `role/sws-vault-<id>-fn`, `iam:PassedToService` = `lambda.amazonaws.com` |
| Lambda | CreateFunction, GetFunction, UpdateFunctionCode, UpdateFunctionConfiguration, DeleteFunction, TagResource, Create/Get/Update/DeleteFunctionUrlConfig, AddPermission, RemovePermission | `function:sws-vault-<id>-*`; CreateFunctionUrlConfig and AddPermission with `lambda:FunctionUrlAuthType` = the agreed auth type (below); AddPermission's `lambda:Principal` limited to what step 1 names (security 3) |
| Lambda image | the registry reads for the image | *open*: design 04 says Lambda images come from ECR in the same region; which repository, and whose, decides this row |
| Logs | CreateLogGroup, PutRetentionPolicy, DeleteLogGroup, TagResource | `log-group:/aws/lambda/sws-vault-<id>-*` |
| ACM (us-east-1, phase 2) | RequestCertificate, DescribeCertificate, DeleteCertificate, AddTagsToCertificate | create only with `aws:RequestTag/sws-vault` = `<id>`; change and delete only with `aws:ResourceTag/sws-vault` = `<id>` |
| CloudFront (phase 2) | CreateDistribution (with tags), GetDistribution, UpdateDistribution, DeleteDistribution, TagResource | same tag rule; *open* whether CloudFront supports `aws:RequestTag` on create (boto3.aws.a to check) |
| Route 53 (phase 2) | ChangeResourceRecordSets, GetChange, GetHostedZone | `hostedzone/<zone id>` named by id (a stack parameter); `route53:ChangeResourceRecordSetsNormalizedRecordNames` ForAllValues:StringEquals [the Vault's name, the certificate's `_` validation name]; `route53:ChangeResourceRecordSetsRecordTypes` ForAllValues:StringEquals [A, AAAA, CNAME]: no NS, no SOA, no delegation, no apex unless the customer chose it (security 5) |
| Deny | iam:UpdateAssumeRolePolicy, Put/DeleteRolePermissionsBoundary, CreatePolicyVersion, SetDefaultPolicyVersion, DeletePolicy on the boundary, CreateUser, CreateAccessKey, CreateLoginProfile; s3:DeleteBucket, s3:DeleteBucketPolicy; every Tag action on a resource that does not already carry `sws-vault` = `<id>` | `*` |

**Tag hijack (security 4).** Scoping by `aws:ResourceTag` alone would let the role tag a customer's existing resource and then change or delete it. So the `sws-vault` tag is allowed only in the create request (`aws:RequestTag` on Create*), and standalone Tag and Untag actions are allowed only on resources that already carry `sws-vault` = `<id>` (and never to change that tag's value). Where a service cannot tag at create, the resource is scoped by name instead.

## The function's role and the Vault boundary

`sws-vault-<id>-fn`: S3 on `arn:aws:s3:::sws-vault-<id>-data` and its objects, the actions the server uses (*open* until its source is read: design 04 section 8); `secretsmanager:GetSecretValue` on the one secret if the server reads it at start-up; logs on its own log group. The Vault boundary (bootstrap stack) is the same list: the most the function can ever do, whatever the Vault template says.

**A role that trusts another account (security 2).** A boundary caps rights, not who may assume the role. So: the deploy role cannot call UpdateAssumeRolePolicy at all (denied); the function role's trust is set at create, `lambda.amazonaws.com` only; and the bucket's policy refuses any principal outside the customer's account (`aws:PrincipalAccount` not equal to `<acct>`), plus non-TLS requests.

## What IAM cannot say (gaps, recorded, not hidden)

1. **"Only at create" for bucket settings (security 3).** IAM cannot tell CreateBucket's follow-up PutBucketPublicAccessBlock and PutBucketPolicy apart from the same calls a year later. With the actions allowed, a tampered later template could loosen them. Mitigations: the template is pinned and hashed (security 6); the deploy role is used only by stacks named `sws-vault-<id>*`; drift detection shows a change; and the page recommends the customer turn on S3 Block Public Access for the whole account (one console setting, outside our stack), which overrides any bucket setting.
2. **The token.** design 04 puts the token in the function's environment. A CloudFormation dynamic reference (`{{resolve:secretsmanager:...}}`) resolves at deploy time with the service role's rights, so the deploy role would need GetSecretValue, and the value then sits in the function's configuration, readable by anyone in the customer's account with `lambda:GetFunctionConfiguration`. Recommendation: the server reads the secret at start-up (the function role holds GetSecretValue on that one secret, the deploy role never does); a change for the server's owners (design 04 section 8, question 2). Until then: the dynamic reference, with GetSecretValue on that one secret for the deploy role, written as a known gap.

## The Function URL's auth type (security 3 against design 04)

security.aws.a's position: AWS_IAM or no URL. design 04: NONE, because the server's own token gates every route and IAM auth breaks sgit and browser clients. My view:

- **Phase 1 (no domain): NONE, accepted for v1**, since the token gates every route including reads and health, and the URL is the Vault's only address. Recorded as a public endpoint in the risks, not as a gap in IAM. The deploy role may create a URL only for `function:sws-vault-<id>-*` and only with the agreed auth type, so it cannot open any other function.
- **Phase 2 (CloudFront in front): AWS_IAM on the Function URL with CloudFront origin access control for Lambda**, so only the distribution can call the function and the URL stops being public. *open*, for boto3.aws.a: whether origin access control for Lambda Function URLs passes PUT and POST bodies from sgit clients without the client signing the payload; if it does not, phase 2 stays NONE with the token.

security.aws.a decides; this is input.

## Next

When cloudformation.aws.a's step 2 template exists: a check like docs/iam/check_boundary.py that every action the template's resources need is inside the deploy role, and nothing more; then items 7 to 12 of security.aws.a's review.
