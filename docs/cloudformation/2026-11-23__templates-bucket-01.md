# The publishing bucket for pinned Vault templates (plan draft 0.1.0)

Written by cloudformation.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~19:05 UTC.

It is for:
- aws.c, which prepares the plan;
- iam.aws.a, for the publisher role;
- security.aws.a, for review;
- boto3.aws.a, for two checks.

Dinis approves on the site. This changes nothing in AWS. File: `vault/templates-bucket.yaml`, which passes cfn-lint. Stack `sws-vault-templates-<region>`, in **our** account.

## What it holds

Published files at `templates/<name>/<version>/<name>-<12 hex of sha256>.yaml`, where the name is `vault`, `vault-edge` or `vault-access`. That is the key form dev.2.aws.a's page checks (14c434a).

## Security.aws.a's condition: no overwrite and no delete, in fact, not by naming

| Threat | Control |
|---|---|
| Deleting a published file | **Object Lock in compliance mode**, default retention `RetentionYears` (10 proposed: a decision for Dinis). Nobody can delete a locked version before it expires, the account root included. The bucket policy also denies `DeleteObject` and `DeleteObjectVersion` to everyone. |
| Overwriting a published file | Object Lock alone is **not enough**: a write to an existing key adds a new *current* version, and a quick-create link, which has no `versionId`, fetches the current one. So the policy denies any `PutObject` without `If-None-Match: *` (S3 conditional writes, condition key `s3:if-none-match`). **CHECK**: the key's name and behaviour are to be confirmed from AWS's S3 documentation by boto3.aws.a. Without it, this bucket is not safe and must not be used. |
| Someone other than the publisher writing | Deny `PutObject`, `PutObjectRetention` and `PutObjectLegalHold` unless `aws:PrincipalArn` is `PublisherRoleArn`. |
| Loosening the bucket itself | Deny `DeleteBucketPolicy`, `PutBucketObjectLockConfiguration`, `PutBucketVersioning` and `DeleteBucket` to all but the account root. Object Lock cannot be turned off once enabled, whatever the policy says. |
| Reading | `templates/*` is public read. A customer's CloudFormation fetches the quick-create template from S3 with the customer's own credentials, from their account, so the object has to be readable by anyone. `BlockPublicPolicy` and `RestrictPublicBuckets` are therefore off for this bucket only; ACLs stay blocked. **CHECK** with boto3.aws.a: whether a quick-create `templateURL` in another account needs public read, or whether some narrower grant works. |

Versioning is on (Object Lock requires it), so any slip is visible as a version.

## Costs and one-way doors, for Dinis

- **Compliance mode is a one-way door per file.** Once published, a file stays for `RetentionYears`, and the bucket cannot be deleted until the last lock expires. A mistaken publish stays readable too. The page simply stops linking to it, and a new version is a new key.
- The bucket is public read on one prefix. The templates hold no secrets by design: the token is generated in the customer's account, and an image digest is not a secret.
- Region: one bucket per offered region (the URL is regional in form), unless boto3.aws.a confirms that one bucket works from every region's console.

## Next

boto3.aws.a: the two CHECKs. iam.aws.a: the publisher role, with write only to `templates/*` in this bucket, from the repository's release workflow. security.aws.a: review. aws.c: the plan, once the CHECKs pass.
