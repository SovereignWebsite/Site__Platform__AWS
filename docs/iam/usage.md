# What the site calls, and what the roles grant but the site never uses

From iam.aws.a, 23 Nov 2026, reading site/*.js at dev 003976e (not twin.js). Every AWS call the page makes, the role it assumes for it, and the IAM action it needs. Then the reverse: grants no call uses. A grant no call uses is reach without a reason; each is a candidate to drop in a later template, as a proposal for aws.c.

## Calls by role

### Before any role: sts:AssumeRoleWithWebIdentity (app.js:156)

Unsigned, with the Google ID token. Governed by the trust policies, not by permissions.

### sws-aws-platform-read

| Call | Where | IAM action |
|---|---|---|
| STS GetCallerIdentity | app.js:231 | none (always allowed) |
| Cost Explorer GetCostAndUsage | app.js:238 | ce:GetCostAndUsage |
| Cloud Control ListResources, AWS::S3::Bucket | s3.js:43 | cloudformation:ListResources, plus the handler's s3:ListAllMyBuckets |
| Cloud Control GetResource, AWS::S3::Bucket | s3.js:66 | cloudformation:GetResource, plus the handler's s3:GetBucket* reads |
| S3 ListObjectsV2 (list-type=2) | s3.js:115 | s3:ListBucket |
| S3 GetObject, whole or Range | s3.js:200, :228, :236 | s3:GetObject |

### sws-aws-platform-change

| Call | Where | IAM action |
|---|---|---|
| IAM GetRole | app.js:190 (trust plans) | iam:GetRole |
| IAM UpdateAssumeRolePolicy | app.js:400 (trust plans) | iam:UpdateAssumeRolePolicy |
| CloudFormation GetTemplate, DescribeStacks | app.js:319, :436, :447 | cloudformation:GetTemplate, DescribeStacks |
| CloudFormation CreateChangeSet (TemplateBody, CAPABILITY_NAMED_IAM, previous parameters) | app.js:457 | cloudformation:CreateChangeSet, then CloudFormation's own IAM calls under the caller's rights |
| CloudFormation DescribeChangeSet, ExecuteChangeSet | app.js:429, :471 | cloudformation:DescribeChangeSet, ExecuteChangeSet |
| Cloud Control UpdateResource, GetResourceRequestStatus, AWS::S3::Bucket | s3.js:90, :93 | cloudformation:UpdateResource, GetResourceRequestStatus, plus the handler's s3:PutBucketCORS and s3:GetBucket* reads |

Plans that use the change role: site/plans/*.json, all three with `"role": "sws-aws-platform-change"`.

## Granted, never called

### Read role

- **ViewOnlyAccess and SecurityAudit.** No view calls any service but STS, Cost Explorer, Cloud Control on S3 buckets and S3. These two managed policies are the widest grants on the role and are used by nothing today. They are the base for views planned in stage 2 (IAM, CloudTrail, Lambda), so keep them for now; when those views exist, replace them with the actions the views call.
- **costs-read beyond GetCostAndUsage**: budgets:ViewBudget, DescribeBudgetAction, DescribeBudgetActionsForAccount, ce:GetCostForecast, ce:GetDimensionValues. Unused; billing.aws.c's views may need them.
- **`s3:Get*` beyond GetObject and the bucket reads**: for example s3:GetObjectAcl, GetObjectTagging, GetObjectVersion, GetBucketPolicy, GetAccessPoint*, GetStorageLens*. Nothing calls them; Cloud Control's handler needs some GetBucket* reads.

### Change role

- **`s3:Get*` and `s3:List*` on `*` (s3-cors), object reads included.** The change role never reads an object: the browser reads with the read role (s3.js:33). Cloud Control's bucket handler needs bucket-level reads, not objects. Candidate: deny `s3:GetObject*` on the change role, keep bucket reads. This replaces I-1's earlier reason in roles.md: change-role credentials are no longer kept in the sealed store (app.js:57, after R-003), so the case is now plain least privilege, not exposure at rest.
- **cloudformation:DeleteChangeSet, DescribeStackEvents, GetTemplateSummary, ValidateTemplate.** Not called. DeleteChangeSet would let the page clean up a change set Dinis does not execute (none does today, so they pile up: one per "1. Approve" press, name sws-aws-platform-<ms>). DescribeStackEvents would let the page show why an execute failed. Keep both and use them, or drop them; GetTemplateSummary and ValidateTemplate are unused and harmless.
- **The 13 IAM actions on sws-aws-platform-* (v2.1).** Used only by CloudFormation inside a change set, as designed. Of them, iam:UpdateRole (MaxSessionDuration) and iam:UpdateAssumeRolePolicy on the platform roles' own trust have no use in the current template and are the ones that loosen the roles from inside (roles.md I-2, P-IAM-001).

## What follows for R-008 (b)

security.aws.c suggests a `cloudformation:TemplateUrl` condition on CreateChangeSet. The page sends `TemplateBody` today (app.js:457), so that condition would refuse every plan until the page uploads templates to a bucket and passes TemplateURL. The condition is a code change plus a bucket plus a role that writes it, not an IAM-only change; P-IAM-001's boundary is the IAM-only step.
