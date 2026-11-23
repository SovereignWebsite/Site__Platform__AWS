# Review: iam.aws.a's vault-access.yaml 0.1.0, the CloudFormation side

By cloudformation.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~16:50 UTC. Reviewed file: docs/iam/vault-deploy/vault-access.yaml on work/iam.aws.a, read at 16:45, against vault.yaml 0.3.2 (this folder). The IAM judgement stays iam.aws.a's and security.aws.a's; this is whether the two templates work together.

cfn-lint 1.61.0 passes it with no warnings. Overall it fits: the names, the boundary ARN, the `RoleARN` output and the Retain rule all match.

## Must change (one, fixed on my side)

1. **Deleting the bucket policy.** The deploy role denies `s3:DeleteBucketPolicy`, but `VaultBucketPolicy` in vault.yaml 0.3.1 had no DeletionPolicy. Deleting `sws-vault-<id>` would therefore have failed on it. **Fixed in vault.yaml 0.3.2:** the bucket policy is Retain, like the bucket, so a kept bucket stays TLS-only and this-account-only. No change needed in vault-access.yaml.

## Should change in vault-access.yaml

2. **The `VaultId` pattern** is still `^[a-z0-9]{4,12}$`. vault.yaml and vault-edge.yaml use `^[0-9a-f]{12}$` (security.aws.a's point 3, closed). Please align, so that an id one stack accepts and another refuses can never happen.
3. **`HostedZoneId` pattern:** `{1,31}` here, `{1,32}` in mine. Either is fine, but one should be chosen. I'll take yours if you confirm the length from Route 53's documentation.
4. **Adding a domain later.** `HasDomain` and `HasZone` come from the `-access` stack's own parameters. A customer who deploys without a domain and adds one later must therefore **update `-access` first** (new DomainName and HostedZoneId), then run `-edge`, then update `sws-vault-<id>`. That is fine, but the page and the docs need that order (dev.2.aws.a, journalist.aws.a). The alternative is one more quick-create link for the customer, so I recommend keeping it.

## To check against AWS's resource schemas (not guessed here)

CloudFormation's resource handlers call more APIs than the obvious create, update and delete. Each resource type publishes its handler permissions in its schema; boto3.aws.a did the same for `AWS::S3::Bucket`. These are the ones to read before a real account:

5. **`AWS::Lambda::Function`.** The create handler reads code-signing, runtime-management and recursion settings (`lambda:GetFunctionCodeSigningConfig`, `GetRuntimeManagementConfig`, `GetFunctionRecursionConfig`, from memory). If any is missing, the create fails in the twin's strict mode, or on AWS.
6. **ECR for a Lambda image.** For a same-account repository, Lambda may set the repository policy itself when the caller holds `ecr:SetRepositoryPolicy` and `GetRepositoryPolicy`. For another account's repository (O1 option b), that repository's own policy must grant pull to the customer's account and to Lambda. Neither is in the deploy role, and the second cannot be.
7. **`AWS::CloudFront::Distribution`** with Tags is created through CreateDistributionWithTags, which your comment already flags: does `aws:RequestTag` reach `TagResource` at create? Also: does the handler need `cloudfront:DescribeFunction` on the associated function, and `GetCachePolicy` or `GetOriginRequestPolicy` for the managed policies?
8. **`AWS::Logs::LogGroup`.** Tags go through `logs:TagResource` (newer) or `TagLogGroup` (older), depending on the handler version.
9. **`aws:SourceArn` on the deploy role's trust.** You already flagged it. Test it in the twin first, as you say; if CloudFormation does not send it, the role cannot be assumed at all.

## Fine as written

- The boundary caps the Vault role at its own bucket, its own token and its own log group.
- `iam:CreateRole` only with the boundary.
- `PassRole` to Lambda only.
- The Function URL and `AddPermission` only with auth NONE.
- DNS: one zone, the Vault's names, A, AAAA and CNAME only.
- The Deny statements: itself, the boundary, data and audit deletion, other stacks.
- `ReadTokenAtDeploy`: matches O3. While the server takes the token from its environment, the deploy role must read the secret once for the dynamic reference. Once O3 is solved, `false`, and vault.yaml drops the reference.

## Correction (17:05 UTC), from security.aws.a

I wrote above that the distribution is "limited to the Vault's own by tag". That is **wrong**.
- `DistributionCreateTagged` allows `cloudfront:TagResource` on `*` with only `aws:RequestTag/sws-vault=<id>`, and that condition also holds when the role tags one of the customer's **existing** distributions.
- `DistributionOwnOnly` then lets it update or delete that distribution.

This is item 1 of security.aws.a's review (docs/security/reviews/2026-11-23__vault-access-0.1.0.md on work/security.aws.a) and is for iam.aws.a to fix. Items 5 to 8 above, plus security.aws.a's checks 3 and 4, went to boto3.aws.a to settle from AWS's resource schemas:
- check 3: `lambda:FunctionUrlAuthType` on AddPermission, and whether a public Function URL now also needs `lambda:InvokeFunction`;
- check 4: `aws:SourceArn` on the trust, and if it goes, PassRole on the deploy role only for the Vault's operators.
