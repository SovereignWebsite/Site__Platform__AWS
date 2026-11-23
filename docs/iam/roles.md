# The hub's roles (bootstrap.yaml v2.1)

Source: site/cloudformation/bootstrap.yaml at dev 3e0ffdf (v2.1, d67b560). Not applied in the account yet (R-001 pending Approve). Read on 23 Nov 2026 by iam.aws.a; no live check.

## Trust graph

| Principal | May become | How | Limits |
|---|---|---|---|
| Owner's Google account, through the site's OAuth client | sws-aws-platform-read | sts:AssumeRoleWithWebIdentity | `aud` = site client ID and `sub` = owner, StringEquals; 1 h |
| Same token, same conditions | sws-aws-platform-change | sts:AssumeRoleWithWebIdentity | Same; 1 h |
| sws-aws-platform-change | trust of sovereignwebsite-factory-dns | iam:UpdateAssumeRolePolicy | Any principal (R-005) |
| sws-aws-platform-change, through CloudFormation | trust and policies of both sws-aws-platform-* roles | change set on stack sws-aws-platform | Whatever the template says (R-008) |

Both roles trust the same token, so whoever holds it in the page holds both (R-002). Nothing in IAM separates "look" from "change".

## sws-aws-platform-read

| Policy | Grants | Note |
|---|---|---|
| ViewOnlyAccess (AWS managed) | List and describe across services | AWS changes it over time |
| SecurityAudit (AWS managed) | Read of configuration, including IAM | Overlaps ViewOnlyAccess |
| costs-read | budgets view, ce:GetCostAndUsage, GetCostForecast, GetDimensionValues | Fine for the billing views |
| s3-browse | `s3:Get*`, `s3:List*` on `*`; Cloud Control ListResources, GetResource | Opens every object in every bucket, except objects encrypted with a KMS key (no kms:Decrypt) (asked for: "also open file[s]") |

Wider than needed: `s3:Get*` reads every object in the account not encrypted with a KMS key, including any bucket that holds logs or state later. Fine for one owner today; when other people or agents get a read role, it should be a named list of buckets.

## sws-aws-platform-change

| Policy | Grants | Note |
|---|---|---|
| dns-role-trust-only | iam:GetRole, iam:UpdateAssumeRolePolicy on sovereignwebsite-factory-dns | Can set that role's trust to any principal (R-005) |
| s3-cors | `s3:Get*`, `s3:List*`, s3:PutBucketCORS, Cloud Control Get, List, UpdateResource, GetResourceRequestStatus on `*` | UpdateResource with this role's rights (R-006) |
| self-update | Describe, template, change set create, execute, delete on stack sws-aws-platform; ValidateTemplate | The change-set path (R-008) |
| self-update (v2.1) | 13 IAM actions on role/sws-aws-platform-*, only via CloudFormation; AttachRolePolicy only ViewOnlyAccess or SecurityAudit | R-001 fix |

Wider than needed, new here (not in risks.md):

1. **I-1, `s3:Get*` on `*` in s3-cors.** Setting a CORS rule needs `s3:GetBucketCORS` and `s3:PutBucketCORS`, not every object. Today the read role already opens every object, so this adds no reach for the owner, and since R-003's fix (app.js:57) change-role credentials are no longer sealed. The case is plain least privilege: the change role never reads an object (usage.md). Suggest: narrow it, but test first. Through Cloud Control the AWS::S3::Bucket handler reads many bucket settings (several `s3:GetBucket*` and `s3:ListBucket`), so a short list may break UpdateResource. Simplest: drop `s3:GetObject*` from the change role and keep `s3:GetBucket*`, `s3:ListBucket`, `s3:ListAllMyBuckets`; or set CORS with `s3:PutBucketCORS` and `s3:GetBucketCORS` directly, without Cloud Control.
2. **I-2, v2.1 IAM actions reach the change role itself.** `role/sws-aws-platform-*` matches the change role, so a change set may give it any inline policy (`PutRolePolicy`) or any trust (`UpdateAssumeRolePolicy`). This is R-008 seen from IAM: the CalledVia condition stops direct calls, not change sets. v2.1's `iam:UpdateRole` also lets a change set raise MaxSessionDuration from 1 h to 12 h. P-IAM-001 caps the policies, not the trust.

## What is not here

No IAM users, no access keys, no service role for CloudFormation, no permissions boundary, no SCP (single account, no Organizations seen in this repository). The role sovereignwebsite-factory-dns is outside this stack; what it may do is not written in this repository (R-005 asks for it).
