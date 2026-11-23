# 09: Vault deploy permission checks (vault.yaml 0.3.2, vault-access.yaml 0.1.4)

By boto3.aws.a, 23 Nov 2026. Answers items 5 to 11 of cloudformation.aws.a's review of vault-access.yaml, and checks 3 and 4 of security.aws.a's review. Public material only: the CloudFormation resource schemas shipped in cfn-lint 1.61.0, and AWS documentation. No AWS endpoint was called, no credentials were used.

Note on versions: the file I was given as vault-access.yaml carries "DRAFT 0.1.4" in its description, not 0.1.1. I compared that file. The comparison is against the actions and conditions as written there.

**Status at 16:40 UTC (boto3.aws.a):** drafted with a Sonnet sub-agent from the cfn-lint 1.61.0 schemas and AWS's pages; boto3.aws.a re-read the deciding sources (CloudFront SAR: CreateFunction has no resource type; CreateDistributionWithTags needs CreateDistribution and TagResource; the service role page's PassRole sentence; the confused-deputy page's scope). Already overtaken since the inputs were taken: the second Function URL permission (lambda:InvokeFunction with InvokedViaFunctionUrl) is in vault.yaml 0.3.3 (work/cloudformation.aws.a 35fa42c), and the matching AddPermission statement (Bool lambda:InvokedViaFunctionUrl true, StringEquals lambda:Principal "*", no IfExists) is in vault-access.yaml 0.1.6 (work/iam.aws.a). Read missing item 1 below as done; the rest stands.

## How to read this

- A schema "handlers" list is every permission a handler **may** need, for any property. It does not say which are used for this template's properties. Where a permission belongs to a property the Vault does not set (a KMS key, a VPC, a layer), I call it "property-gated".
- "Settled" means a source says it. "To confirm" means the sources do not, and it needs a real or twin run.
- Schema source for all rows: cfn-lint 1.61.0 wheel (sha256 `0fe32c20bce54dde16b777f453c071b633a76de75e6ee32e5bb7fc12e052856e`). The resource files are under `cfnlint/data/schemas/resources/<id>.json`, found through `cfnlint/data/schemas/providers/us-east-1.json` (there is no `providers/us_east_1/` folder in this wheel). Read 23 Nov 2026.

| Type | File id |
|---|---|
| AWS::Lambda::Function | 3baeaa66f3dc0b87 |
| AWS::Lambda::Url / Permission | 192de4d45e935418 / 273a66a590dfa9f0 |
| AWS::CloudFront::Distribution / Function | 14d24ae8a612f0ef / a95a345cfa1dc347 |
| AWS::Logs::LogGroup | 8614d83fb64a3f33 |
| AWS::SecretsManager::Secret | f6b785ff8e74d121 |
| AWS::CertificateManager::Certificate | 65b8cba690f9f435 |
| AWS::Route53::RecordSet, AWS::IAM::Role, AWS::S3::Bucket, AWS::S3::BucketPolicy | 3abf869017806816, a6ff87083c7886f4, 112018f236e91c5c, 052a5ef1e32d1349 |

## Headline

Two things would fail as written, and the sources settle them:

1. **The public Function URL needs a second permission, and the role cannot add it.** Lambda now wants `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` in the resource policy. vault.yaml adds only the first, so every request through the URL would answer 403. The role's `AddPermission` is allowed only with `lambda:FunctionUrlAuthType = NONE`, and the documented second call does not carry that parameter. (Items 9 and the table below.)
2. **`cloudfront:CreateFunction` is scoped to a function ARN, but it supports no resource type.** The statement does not match, so creating the health function is refused. It needs `Resource: "*"`.

Two more are very likely to fail, and need a live or twin test: tagging at create for the **distribution** and the **certificate** (items 7 and 11). The extra action needed is settled; how IAM evaluates the tag conditions at that moment is not.

## Item 5: AWS::Lambda::Function, image package, reserved concurrency

Source: schema `3baeaa66f3dc0b87.json`, `handlers` and `tagging`. Read 23 Nov 2026.

| Handler | Permissions listed | Needed for this template |
|---|---|---|
| create | `lambda:CreateFunction`, `lambda:GetFunction`, `lambda:TagResource`, `iam:PassRole`, `lambda:PutFunctionConcurrency`, `lambda:GetFunctionCodeSigningConfig`, `lambda:GetRuntimeManagementConfig`, `lambda:GetFunctionRecursionConfig`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` | all of these |
| create, property-gated | `s3:GetObject`, `s3:GetObjectVersion` (zip from S3); `ec2:Describe*` for security groups, subnets, VPCs, `elasticfilesystem:DescribeMountTargets`, `s3files:ListMountTargets` (VPC, file systems); `kms:CreateGrant/Decrypt/DescribeKey/Encrypt/GenerateDataKey` (KMS key); `lambda:GetCodeSigningConfig`, `lambda:GetLayerVersion`, `lambda:PutRuntimeManagementConfig`, `lambda:PutFunctionRecursionConfig`, `lambda:PutFunctionScalingConfig`, `lambda:PassCapacityProvider`, `lambda:AssociateRuntimeAlias` | not for the Vault's properties |
| update | `lambda:UpdateFunctionCode`, `lambda:UpdateFunctionConfiguration`, `lambda:PutFunctionConcurrency`, `lambda:DeleteFunctionConcurrency`, `lambda:TagResource`, `lambda:UntagResource`, `lambda:GetFunction`, `iam:PassRole`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, the three Get configs above, plus the property-gated set and `lambda:PublishVersion`, `lambda:PutFunctionCodeSigningConfig`, `lambda:DeleteFunctionCodeSigningConfig` | the first ten and the Get configs |
| delete | `lambda:DeleteFunction`, `lambda:GetFunction`, `ec2:DescribeNetworkInterfaces` | first two; the EC2 call is for VPC functions (to confirm) |
| tagging | `lambda:ListTags`, `lambda:TagResource`, `lambda:UntagResource` | all |

- **Only for an image function:** `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`, in both create and update. Lambda's guide says the creating principal needs them (see item 6).
- **Only for reserved concurrency:** `lambda:PutFunctionConcurrency` (create and update) and `lambda:DeleteFunctionConcurrency` (update only, for when the cap is emptied). Delete does not list it.
- **cloudformation.aws.a's item 5 is confirmed:** `GetFunctionCodeSigningConfig`, `GetRuntimeManagementConfig` and `GetFunctionRecursionConfig` are in the create handler list. The role already holds all three.
- Whether the create handler calls the property-gated Put and KMS actions when the properties are absent is not stated. To confirm on a first live run; an AccessDenied names the action.

## Item 6: ECR for a Lambda image

Source: AWS Lambda Developer Guide, "Creating a Lambda function using a container image" (https://docs.aws.amazon.com/lambda/latest/dg/images-create.html), section "Amazon ECR permissions". Read 23 Nov 2026.

Quotes:

- "Make sure that the permissions for the user or role that creates the function includes GetRepositoryPolicy, SetRepositoryPolicy, BatchGetImage, and GetDownloadUrlForLayer."
- Same account: "you can grant Lambda access through either the identity-based policy on the execution role or the resource-based policy on the Amazon ECR repository. Only one side needs to allow access." The repository policy statement is `Principal: {Service: lambda.amazonaws.com}` with `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`.
- "If the Amazon ECR repository does not include these permissions, Lambda attempts to add them automatically. Lambda can add permissions only if the principal calling Lambda has ecr:getRepositoryPolicy and ecr:setRepositoryPolicy permissions."
- Cross-account: "both sides must grant access. The identity-based policy on the role in the consuming account must allow ecr:BatchGetImage and ecr:GetDownloadUrlForLayer, and the resource-based policy on the Amazon ECR repository in the owning account must also allow these actions." The repository must be in the same Region as the function.

| Case | What is needed | Deploy role today |
|---|---|---|
| Same account, repository policy already has the Lambda statement | `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` on the caller | Held (`PullTheImage`) |
| Same account, repository policy lacks it | the above, plus `ecr:GetRepositoryPolicy` and `ecr:SetRepositoryPolicy` so Lambda can add it | **Not held** |
| Cross-account (O1 option b) | caller holds the two pull actions (held); the owning repository's policy grants both (1) `Principal.AWS = arn:aws:iam::<customer account>:root` with `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`, and (2) `Principal.Service = lambda.amazonaws.com`, same two actions, `Condition ArnLike aws:sourceARN = arn:aws:lambda:<region>:<customer account>:function:*` | the repository side cannot be in this template |

- Statement (2) exists because "Lambda eventually sets a function's state to inactive if it is not invoked for an extended period" and then must fetch the image again for the function. So it is needed for the Vault to keep working, not only to create it.
- The guide's own example uses one account number for both owner and consumer, which is confusing. The principal and the `aws:sourceARN` account are the **consuming** account (the customer's).
- To add many customers, the guide says to list each account ID in both the Principal and the `aws:sourceARN` lists. Wildcarding the account would defeat the narrow-permissions point. For a shared repository we run, that list grows with every customer, which matters for O1.
- `ecr:GetAuthorizationToken` is in neither the handler list nor the guide's list. Not needed per these sources.
- **Recommendation, to confirm:** do not give the deploy role `ecr:SetRepositoryPolicy` (SAR classes it "Permissions management, Write"). Ask the customer's repository to carry the documented Lambda statement instead. Whether the identity-side grant alone is enough for Lambda's later pulls in the same-account case is the guide's wording ("execution role"), which is ambiguous. To confirm.

## Item 7: AWS::CloudFront::Distribution and Function

Source: schemas `14d24ae8a612f0ef.json` and `a95a345cfa1dc347.json`; Service Authorization Reference for CloudFront (https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncloudfront.html); API reference CreateDistributionWithTags (https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateDistributionWithTags.html). Read 23 Nov 2026.

| Resource | create | update | delete | tagging |
|---|---|---|---|---|
| Distribution | `CreateDistribution`, `CreateDistributionWithTags`, `TagResource`, `GetDistribution`, `GetDistributionConfig`, `CreateConnectionGroup`, `GetConnectionGroup`, `GetVpcOrigin` | `UpdateDistribution`, `UpdateDistributionWithStagingConfig`, `TagResource`, `UntagResource`, `ListTagsForResource`, `GetDistribution`, `GetDistributionConfig`, connection group and VPC origin gets | `DeleteDistribution`, `GetDistribution`, `GetDistributionConfig` | `TagResource`, `UntagResource`, `ListTagsForResource` |
| Function | `CreateFunction`, `PublishFunction`, `DescribeFunction`, `TagResource` | `UpdateFunction`, `PublishFunction`, `DescribeFunction`, `TagResource`, `UntagResource` | `DeleteFunction`, `DescribeFunction` | `TagResource`, `UntagResource`, `ListTagsForResource` |

Answers:

- **Does create with Tags use CreateDistributionWithTags?** The create handler lists both `CreateDistribution` and `CreateDistributionWithTags`, plus `TagResource`. That fits a tagged create using the WithTags call, but the schema does not say which call is made when Tags is set. Probable, to confirm.
- **What IAM actions does it need?** `CreateDistributionWithTags` is an **API operation**, not an IAM action. SAR's operations table maps it to `cloudfront:CreateDistribution` and `cloudfront:TagResource` (plus `CreateConnectionGroup`, `GetVpcOrigin`, which `CreateDistribution` also lists). The API reference says the same: "This API operation requires the following IAM permissions: CreateDistribution, TagResource." So the role must be allowed `cloudfront:TagResource` **at create**. That is exactly what the 0.1.x change removed from the create statement.
- **Does aws:RequestTag apply?** SAR: `cloudfront:CreateDistribution` supports `aws:RequestTag/${TagKey}` and `aws:TagKeys`. `cloudfront:TagResource` supports `aws:RequestTag`, `aws:ResourceTag` and `aws:TagKeys` (on distribution, function and others). `UpdateDistribution` and `DeleteDistribution` support only `aws:ResourceTag`. The CloudFront guide says ABAC support is "Partial" and does not describe tag-at-create. **Not settled:** whether `aws:RequestTag` is populated for the `TagResource` check inside CreateDistributionWithTags, and whether `aws:ResourceTag` is absent at that moment. If it is absent, `DistributionOwnOnly` does not match and `NeverTagOthers` (StringNotEquals, true for a missing key) denies, so a tagged create fails. To confirm.
- **Do the handlers list `cloudfront:DescribeFunction`, `GetCachePolicy`, `GetOriginRequestPolicy`?** The Distribution handler lists none of them. SAR's operations table maps `CreateDistribution` to `CreateConnectionGroup`, `CreateDistribution`, `GetVpcOrigin` only. `DescribeFunction` is a separate read action (resource `function*`). So by both sources they are not needed. Whether CloudFront itself checks them when you associate a function or a managed policy is not documented either way. To confirm on a first run.
- **Function handler:** the role holds every action in the four lists. One mismatch: SAR gives `cloudfront:CreateFunction` **no resource type** (resource column empty; condition keys `aws:RequestTag`, `aws:TagKeys`). The role allows it on `arn:aws:cloudfront::<acct>:function/sws-vault-<id>-health`, which will not match. `DescribeFunction`, `UpdateFunction`, `PublishFunction`, `DeleteFunction` do support the function resource. Fix: `cloudfront:CreateFunction` on `"*"`. IAM then cannot pin the name at create; vault.yaml sets no Tags on the function, so no tag condition helps either.
- Not in the role and probably not needed: `cloudfront:GetFunction` (read handler only), `ListDistributions`/`ListFunctions` (list handlers).
- Property-gated and absent from the role, correctly: `CreateConnectionGroup`, `GetConnectionGroup`, `GetVpcOrigin`, `UpdateDistributionWithStagingConfig`.

## Item 8: AWS::Logs::LogGroup with Tags

Source: schema `8614d83fb64a3f33.json`; SAR for CloudWatch Logs (https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncloudwatchlogs.html); API reference CreateLogGroup (https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_CreateLogGroup.html). Read 23 Nov 2026.

- **Answer: `logs:TagResource` is enough. `logs:TagLogGroup` is not needed.** The schema's create, update and tagging lists name `logs:TagResource` (and `UntagResource`, `ListTagsForResource`); `TagLogGroup` appears nowhere in them.
- The API reference agrees: "To assign tags when you create a log group, you must have either the logs:TagResource or logs:TagLogGroup permission." SAR maps the `CreateLogGroup` operation to `CreateLogGroup`, `TagLogGroup` and `TagResource`; either tag action satisfies it.
- Handler lists: create `DescribeLogGroups`, `CreateLogGroup`, `PutRetentionPolicy`, `TagResource`, `GetDataProtectionPolicy` (all held); the rest (`PutDataProtectionPolicy`, `CreateLogDelivery`, `PutResourcePolicy`, `DescribeResourcePolicies`, `PutIndexPolicy`, `DescribeIndexPolicies`, `PutBearerTokenAuthentication`, `firehose:TagDeliveryStream`, `s3:REST.PUT.OBJECT`) look property-gated. To confirm.
- Update lists `DeleteRetentionPolicy`, `AssociateKmsKey`, `DisassociateKmsKey` and others the role lacks. They matter only if a later template version removes retention or adds a KMS key.
- Delete lists `DeleteLogGroup`, denied on purpose. With `DeletionPolicy: Retain` the handler is not called.
- Resource scope `log-group:/aws/lambda/sws-vault-<id>-api*` covers both the name and the `:*` form. `logs:DescribeLogGroups` has no resource type, so `"*"` is right.

## Item 9: lambda:FunctionUrlAuthType and the Function URL policy

Source: SAR for Lambda (https://docs.aws.amazon.com/service-authorization/latest/reference/list_awslambda.html), actions and condition keys tables; Lambda Developer Guide, "Control access to Lambda function URLs" (https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html); API reference AddPermission (https://docs.aws.amazon.com/lambda/latest/api/API_AddPermission.html). Read 23 Nov 2026.

**Actions that support `lambda:FunctionUrlAuthType` (SAR actions table):** `AddPermission`, `RemovePermission`, `CreateFunctionUrlConfig`, `UpdateFunctionUrlConfig`, `DeleteFunctionUrlConfig`, `GetFunctionUrlConfig`, `ListFunctionUrlConfigs`, `InvokeFunctionUrl`. SAR's key description: "Filters access by authorization type specified in request. Available during CreateFunctionUrlConfig, UpdateFunctionUrlConfig, DeleteFunctionUrlConfig, GetFunctionUrlConfig, ListFunctionUrlConfig, AddPermission and RemovePermission operations." It is a **string** key, values `AWS_IAM` or `NONE`.

**Does a public URL now need `lambda:InvokeFunction` as well? Yes.** Quotes from the current page:

- "Starting in October 2025, new function URLs will require both lambda:InvokeFunctionUrl and lambda:InvokeFunction permissions."
- "If you choose the NONE auth type, Lambda doesn't use IAM to authenticate requests to your function URL. However, your function must have a resource-based policy that allows lambda:InvokeFunctionUrl and lambda:InvokeFunction. When you create a function URL with auth type NONE using the console or AWS Serverless Application Model (AWS SAM), Lambda automatically creates the resource-based policy for you. If you're using the AWS CLI, AWS CloudFormation, or the Lambda API directly, you must add the policy yourself."
- "If a function's resource-based policy doesn't grant lambda:invokeFunctionUrl and lambda:InvokeFunction permissions, users get a 403 Forbidden error code when they try to invoke your function URL. This occurs even if the function URL uses the NONE auth type."

The documented policy for NONE has two statements. The second is `Action: lambda:InvokeFunction`, `Principal: "*"`, `Condition: Bool lambda:InvokedViaFunctionUrl = "true"`. The documented CLI is two calls: `add-permission --action lambda:InvokeFunctionUrl --principal * --function-url-auth-type NONE`, then `add-permission --action lambda:InvokeFunction --principal * --invoked-via-function-url`. The page recommends the `InvokedViaFunctionUrl` key: "This context key ensures that the function can only be invoked through the function URL and not through other invocation methods." The CloudFormation `AWS::Lambda::Permission` has a matching `InvokedViaFunctionUrl` (Boolean) property (schema `273a66a590dfa9f0.json`; CloudFormation template reference).

Consequences:

| Where | Problem | Fix |
|---|---|---|
| vault.yaml 0.3.2 `VaultFunctionUrlPermission` | only `lambda:InvokeFunctionUrl`; a function URL created now would 403 | add a second `AWS::Lambda::Permission`: `Action: lambda:InvokeFunction`, `Principal: "*"`, `InvokedViaFunctionUrl: true` |
| vault-access.yaml `FunctionUrlNoneOnly` | `AddPermission` is allowed only if `lambda:FunctionUrlAuthType = NONE`. The second call carries no auth type, so the key is absent and `StringEquals` is false | add a statement: `lambda:AddPermission` on the function with `Bool lambda:InvokedViaFunctionUrl = true` |
| the `NeverTheseActions` deny of `lambda:InvokeFunction` | stops the role **calling** the function; it does not stop `AddPermission` naming that action | none, but say so in the comment |

**Security check 3, answered.**

- The key is a **request parameter**, not tied to the action named. The API reference documents `FunctionUrlAuthType` as optional on any `AddPermission` call and does not say it is refused with `Action = lambda:InvokeFunction`. So the NONE condition alone does **not** prove the statement cannot add `lambda:InvokeFunction` to `*`. Whether Lambda rejects that combination is not stated. To confirm.
- Since Lambda now needs the `InvokeFunction` grant to `*`, the aim should be that it is **only** granted with `InvokedViaFunctionUrl = true`. SAR says that key is "Available during AddPermission operation" (Bool, "Limits the scope of lambda:InvokeFunction action to Function URLs only"), but the AddPermission row in the actions table lists `aws:ResourceTag`, `lambda:FunctionUrlAuthType` and `lambda:Principal` only, with `InvokedViaFunctionUrl` listed against `InvokeFunction`. The two statements of SAR disagree in detail. To confirm in a real account before relying on the key as the control.

## Item 10: does CloudFormation set aws:SourceArn / aws:SourceAccount for a stack service role?

Sources read 23 Nov 2026: CloudFormation guide, "Cross-service confused deputy prevention" (https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cross-service-confused-deputy-prevention.html); "Service roles" (https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html); StackSets prerequisites (https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stacksets-prereqs-self-managed.html); IAM "The confused deputy problem" (https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html).

**Not settled for ordinary stacks.**

- The CloudFormation confused-deputy page covers **registry roles** (the service principal `resources.cloudformation.amazonaws.com`, with an example `aws:SourceArn` of a type ARN) and points to the StackSets page for StackSets roles (`aws:SourceArn` like `arn:aws:cloudformation:*:<acct>:stackset/*`). It recommends the two keys for those and says nothing of the `cloudformation.amazonaws.com` role a stack is given with `RoleARN`.
- The service-role page does not mention either key.
- The IAM page has no CloudFormation stack example.

So the draft's trust condition (`ArnLike aws:SourceArn = ...:stack/sws-vault-<id>/*` and `...-edge/*`) rests on an unconfirmed assumption. If CloudFormation does not send `aws:SourceArn`, the condition fails closed and the stack cannot assume the role at all. A twin cannot answer this; only a real AssumeRole can. **Correction (boto3.aws.a):** `aws:SourceAccount` is no better documented for a stack service role than `aws:SourceArn`; the confused-deputy page names both only for registry roles (principal `resources.cloudformation.amazonaws.com`) and StackSets. Either key, if CloudFormation does not send it, fails closed and the stack cannot start. **Safe default until tested:** trust `cloudformation.amazonaws.com` with no source condition, rely on the role's own least privilege, and add `aws:SourceAccount`, then `aws:SourceArn`, only after a test stack in a throwaway account shows each is sent. That test is a real AWS action, so it is a plan for Dinis, not ours to run.

**Security check 4, one correction.** The service-role page says: "Other users that have permissions to perform operations on this stack are able to use this role, regardless of whether those users have the iam:PassRole permission or not." So "give `iam:PassRole` on the deploy role only to the people who run the Vault" does not limit who can later **use** the role. It limits who can name it when creating or updating a stack. The customer text should say: anyone who can update or delete a Vault stack uses the deploy role. The page's own advice is to keep the role least-privilege.

## Item 11: Secrets Manager and ACM

Source: schemas `f6b785ff8e74d121.json`, `65b8cba690f9f435.json`; API references CreateSecret (https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_CreateSecret.html) and ACM RequestCertificate; SAR for Secrets Manager, ACM and Route 53; CloudFormation template reference for `AWS::CertificateManager::Certificate`; ACM "DNS validation" (https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html). Read 23 Nov 2026.

### AWS::SecretsManager::Secret (GenerateSecretString, Tags)

| Handler | Listed | Role |
|---|---|---|
| create | `DescribeSecret`, `GetRandomPassword`, `CreateSecret`, `TagResource`, `ReplicateSecretToRegions` | all held except `ReplicateSecretToRegions`, denied on purpose (replica regions not used) |
| update | `UpdateSecret`, `TagResource`, `UntagResource`, `GetRandomPassword`, `GetSecretValue`, `ReplicateSecretToRegions`, `RemoveRegionsFromReplication` | **`GetSecretValue` is held only when `ReadTokenAtDeploy = true`** |
| delete | `DeleteSecret`, `DescribeSecret`, `RemoveRegionsFromReplication` | held |

- `GenerateSecretString` needs `secretsmanager:GetRandomPassword`, which has no resource type, so the separate `"*"` statement is right.
- CreateSecret API: "If you include tags in the secret, you also need secretsmanager:TagResource." Held, and scoped by name (not by tag), so there is no tag-at-create problem here.
- The API lists `kms:GenerateDataKey` and `kms:Decrypt` only for a key other than `aws/secretsmanager`. The Vault uses the default, so not needed.
- SAR lists `PutResourcePolicy` as a dependent action of the CreateSecret operation; the API reference ties it to cross-account replicas only. The role denies it. Expected harmless, to confirm.
- **Gap, update only:** with `ReadTokenAtDeploy = false` a later update of the secret may need `GetSecretValue`, which the role then lacks. To confirm whether the update handler reads the value when only tags or the description change. First deploys are not affected.

### AWS::CertificateManager::Certificate (DomainValidationOptions, HostedZoneId)

| Handler | Listed | Role |
|---|---|---|
| create | `acm:RequestCertificate`, `acm:DescribeCertificate`, `acm:AddTagsToCertificate`, `route53:ChangeResourceRecordSets`, `acm-pca:IssueCertificate`, `acm-pca:GetCertificate` | held, with the conditions below; `acm-pca` is for private CAs, not needed |
| update | `DescribeCertificate`, `UpdateCertificateOptions`, `AddTagsToCertificate`, `RemoveTagsFromCertificate` | held |
| delete | `DeleteCertificate`, `DescribeCertificate`, `RemoveTagsFromCertificate` | held |

- **Route 53: yes.** The create handler lists `route53:ChangeResourceRecordSets` and no other Route 53 action (no Get, List). The template reference says that with HostedZoneId, "ACM adds your CNAME", and that the DomainName must be identical to one in DomainValidationOptions or "failure to create the domain validation records in Route53" follows. The schema shows it is the handler, with the deploy role's credentials, that calls Route 53. The role's `DnsTheseNamesOnly` covers it (CNAME, one zone). Whether the handler uses `CREATE` or `UPSERT` is not stated; both are allowed.
- **Validation name shape: confirmed by example, not by rule.** ACM's guide shows `_a79865eb4cd1a6ab990a45779b4e0b96.example.com.` for `example.com`: an underscore plus 32 hex characters, one label under the name. So the 32 `?` pattern and the `*.*.<domain>` deny both fit. AWS states it only as an example. To confirm that 32 is fixed.
- **Normalisation:** Route 53 condition values must be lower case with no trailing dot (Route 53 guide, "Normalizing the Route 53 condition key values"). The Vault's `DomainName` pattern is lower case, so the policy values are right.
- **No HostedZoneId:** the template reference says validation is automatic only when "the certificate domain is hosted in Amazon Route 53, the domain resides in your AWS account, and you are using DNS validation", and otherwise the stack waits. It does not say whether the handler looks the zone up (it would need `route53:ListHostedZones`) when no HostedZoneId is given. With `HasZone` false the role holds no Route 53 action. To confirm; the schema lists none, so probably no lookup.
- **Tag at create, same risk as the distribution.** SAR's operations table maps `RequestCertificate` to `acm:RequestCertificate` and `acm:AddTagsToCertificate`. The role allows `AddTagsToCertificate` only where `aws:ResourceTag/sws-vault` already equals the id (`CertificateOwnOnly`); a certificate being created has no tag yet. SAR lists `aws:RequestTag` on `AddTagsToCertificate`, so a statement keyed on the request tag would fit. Not settled how ACM evaluates it at create. To confirm. The same hijack worry as security.aws.a's CloudFront point applies: a request-tag condition cannot tell a new certificate from an existing one, though ACM will only let the role delete an unused certificate (to confirm).

### Route 53 hosted zone id length (cloudformation.aws.a item 3)

Route 53 API reference, ChangeResourceRecordSets, `HostedZoneId`: "Length Constraints: Maximum length of 32." (https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html, read 23 Nov 2026.) `^Z[A-Z0-9]{1,31}$` allows exactly 32. vault.yaml and vault-edge.yaml use `{1,32}`, which allows 33. Take iam.aws.a's `{1,31}` in all three.

## Comparison with vault-access.yaml

### Missing (would fail, or very likely fail)

| # | Gap | Strength | Fix |
|---|---|---|---|
| 1 | Second `AddPermission` for `lambda:InvokeFunction` with `InvokedViaFunctionUrl` is not allowed (item 9) | Documented need; the role-side effect follows from the key being absent | New statement on `lambda:AddPermission`, `Bool lambda:InvokedViaFunctionUrl = true`; vault.yaml adds the second Permission |
| 2 | `cloudfront:CreateFunction` scoped to a function ARN | Settled by SAR (no resource type) | Allow `cloudfront:CreateFunction` on `"*"` |
| 3 | `cloudfront:TagResource` not allowed at distribution create, and `NeverTagOthers` denies a not-yet-tagged resource | Action needed: settled. Condition outcome: to confirm | Needs a decision by iam.aws.a and security.aws.a, options below |
| 4 | `acm:AddTagsToCertificate` allowed only by resource tag | Action needed: settled. Condition outcome: to confirm | Add a request-tag statement, or create the certificate untagged |
| 5 | `secretsmanager:GetSecretValue` absent on update when `ReadTokenAtDeploy = false` | To confirm | Test an update on a first run |
| 6 | Same-account ECR: `ecr:GetRepositoryPolicy` and `ecr:SetRepositoryPolicy` | Only if the repository policy lacks the Lambda statement | Prefer a repository policy with the documented statement; do not grant `SetRepositoryPolicy` |

Options for 3 and 4, for the owners to weigh (none is settled by public sources):

- (a) Test the current policy in a real account. If tagged create fails, the AccessDenied names the action.
- (b) Allow `TagResource` / `AddTagsToCertificate` with `aws:RequestTag/sws-vault = <id>` and `ForAllValues:StringEquals aws:TagKeys = [sws-vault]`, and narrow the deny to "the key exists and differs" (`StringNotEquals` plus `Null aws:ResourceTag/sws-vault = false`). That reopens security.aws.a's point 1 for **untagged** customer distributions, since a request tag cannot tell new from existing.
- (c) Create the distribution without Tags, and scope update and delete by distribution id passed back as a parameter (security.aws.a's fallback). It costs an extra step and a role update after the first create.

### Property-gated, absent from the role, correctly not needed today

Lambda: `kms:*`, `ec2:Describe*`, `elasticfilesystem:DescribeMountTargets`, `s3files:ListMountTargets`, `s3:GetObject`/`GetObjectVersion`, layer, code-signing Put, scaling, capacity provider and alias actions. CloudFront: connection group, VPC origin, staging. Logs: KMS, delivery, index, resource policy and data protection Put actions. ACM: `acm-pca:*`. Secrets: `ReplicateSecretToRegions`. IAM: `AttachRolePolicy`, `UpdateAssumeRolePolicy`, `PutRolePermissionsBoundary` (create does not list the last two, so the boundary on the Vault role does not need them).

### Outside items 5 to 11, from the same schemas

- `AWS::S3::Bucket` create and update list `s3:GetBucketMetadataTableConfiguration`, which the role lacks. The tagging list adds `s3:DeleteBucketTagging` and `s3:ListTagsForResource`, also absent. Likely property-gated or tag-change-only. To confirm; iam.aws.a's check_handlers.py shows the full list of Put actions the role lacks.
- `AWS::IAM::Role` update lists `iam:UpdateRole` and `iam:UpdateRoleDescription`, not held. A future change to the role's description or session length would fail.

### Granted but not needed (per the handler lists)

| Action | Note |
|---|---|
| `lambda:GetFunctionConfiguration` | no handler lists it. Harmless read; the O3 comment cites it only as a reader's tool |
| `s3:GetBucketLocation` | no handler lists it |
| `lambda:DeleteFunctionConcurrency` | update only; needed if the cap is later emptied; keep |
| `lambda:UpdateFunctionUrlConfig` | needed by update; it has no `FunctionUrlAuthType` condition, so it could switch the URL to NONE. The `Url` resource sets NONE anyway; note it |
| `cloudfront:ListTagsForResource`, `acm:ListTagsForCertificate`, `logs:ListTagsForResource` | read or tagging lists; keep |

Everything else in the role matches a handler or tagging list.

## For iam.aws.a

- Add `lambda:AddPermission` with `Bool lambda:InvokedViaFunctionUrl = true` (item 9). Keep `FunctionUrlNoneOnly`. Test in a real account that Lambda rejects `Action = lambda:InvokeFunction` with `FunctionUrlAuthType`, and that `InvokedViaFunctionUrl` works as a condition on `AddPermission`.
- Move `cloudfront:CreateFunction` to its own statement on `"*"`.
- Decide with security.aws.a how the distribution and the certificate are tagged at create (options a to c above). Do not rely on the resource-tag condition for create.
- Trust `cloudformation.amazonaws.com` with no `aws:SourceArn` or `aws:SourceAccount` condition until a test shows CloudFormation sends them (item 10, corrected); neither is documented for a stack service role.
- Use `^Z[A-Z0-9]{1,31}$` for `HostedZoneId` (Route 53 documents a 32-character maximum). Fix the header version (the file says 0.1.4).
- Do not add `ecr:SetRepositoryPolicy`. Decide O1 with the list-each-account rule for a shared repository in mind.
- Consider `secretsmanager:GetSecretValue` for update when `ReadTokenAtDeploy` is false, or accept that a later update may need it.
- Revisit the customer text on `iam:PassRole` (item 10).

## For cloudformation.aws.a / security.aws.a

- vault.yaml: add `VaultFunctionUrlInvokePermission` (`Action: lambda:InvokeFunction`, `Principal: "*"`, `InvokedViaFunctionUrl: true`). Without it the Vault answers 403 on a new function URL. This is a functional bug, not only a permission one.
- vault.yaml and vault-edge.yaml: `HostedZoneId` pattern to `{1,31}`.
- Decide whether `Tags` stays on the distribution and certificate, given the tag-at-create risk. A first real test should create both and read the AccessDenied if any.
- security.aws.a check 3: the NONE condition does not pin the action; the control that does is `InvokedViaFunctionUrl`, and its use on `AddPermission` is to confirm. Check 4: `aws:SourceArn` is unconfirmed (item 10), and `PassRole` does not limit who can use the role after the stack exists.
- The 32-character validation token is shown only in an ACM example. Keep the deny on two-label names regardless.
- A first live run, in a throwaway account, should answer the "to confirm" items together: tagged create of the distribution and certificate, `SourceArn`, the second `AddPermission`, and the secret update.
