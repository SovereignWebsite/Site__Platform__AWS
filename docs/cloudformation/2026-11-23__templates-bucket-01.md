# The publishing bucket for pinned Vault templates (plan draft 0.1.0)

Written by cloudformation.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~19:05 UTC.

It is for:
- aws.c, which prepares the plan;
- iam.aws.a, for the publisher role;
- security.aws.a, for review;
- boto3.aws.a, for two checks.

Dinis approves on the site. This changes nothing in AWS. File: `vault/templates-bucket.yaml`, which passes cfn-lint. Stack `sws-vault-templates-<region>`, in **our** account.

## What it holds

Published files at `templates/<name>/<version>/<name>-<12 hex of sha256>.yaml`, where the name is `vault`, `vault-edge`, `vault-access` or `vault-alarm`. That is the key form dev.2.aws.a's page checks (14c434a).

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

## 0.1.1 (19:20 UTC): security.aws.a's review (docs/security/reviews/2026-11-23__templates-bucket-0.1.0.md)

- **Must fix, done:** the loosening deny now also covers `s3:PutBucketPolicy`. Without it, any admin in our account could replace the whole policy and undo create-only and no-deletes. It also covers `PutBucketPublicAccessBlock` and `PutBucketOwnershipControls`, all for everyone but the account root. Consequence: once the policy is in place, any later change to it, a stack update included, needs the root user.
- **Root's exception stays.** Any use of root on this bucket is an alarm: a CloudTrail and EventBridge rule, for cloudtrail.aws.a to propose.
- **`RetentionYears` default is now 1** (security.aws.a's recommendation; it was 10). Compliance mode makes every publish permanent and public for that long, mistakes included. Only closing the account removes one. This is a decision for Dinis.
- **The publisher pipeline, never by hand.** Before `PutObject` it needs the leak scan and a signed, reviewed commit. If the publisher is the repository's GitHub OIDC role, its `sub` is pinned to repository, branch and environment, with `PutObject` on `templates/*` only (iam.aws.a is drafting it).
- **For the twin (dev.1.aws.a):** a test that the publisher cannot change the bucket policy, cannot overwrite an existing key and cannot delete.

## 0.1.2 (19:35 UTC): boto3.aws.a's answers (docs/boto3/2026-11-23__12-templates-bucket.md, b54a25d) and iam.aws.a's publisher role

- **`s3:if-none-match` is confirmed** as a bucket-policy condition key; the CHECK is cleared. boto3.aws.a found two holes, both closed:
  - **A, delete markers:** a conditional PUT succeeds over a delete marker, and Object Lock does not stop delete markers. `NobodyDeletes` denies the versionless `s3:DeleteObject` too, so no delete marker can be made.
  - **B, multipart:** `CreateMultipartUpload` and `UploadPart` cannot carry `If-None-Match`. They are authorised as `s3:PutObject`, so the create-only deny refuses them, which suits templates well under 1 MB. That is my reading of how S3 authorises multipart, to be tested in the twin.
- **`?versionId=` is documented** for a CloudFormation template URL. So the page's index now holds **key, versionId and sha256**, and each link names one exact locked version. That is stronger than create-only keys alone. iam.aws.a pointed out the same. This replaces my earlier "no versionId", which rested on it being unconfirmed. dev.2.aws.a to add it.
- **One bucket serves every region's console.** The template need not be in the stack's region; only some resources need that.
- **Cross-account read:** the customer "needs read permissions" to the template. Public read of `templates/*` stays as the only option that fits a quick-create link for any customer. Presigned URLs expire. Whether CloudFormation fetches with the caller's credentials is not stated.
- **Publisher role:** iam.aws.a's `templates-publisher.yaml` (work/iam.aws.a):
  - stack `sws-vault-publisher`;
  - GitHub OIDC trust, `sub` pinned to one repository's environment, which needs a reviewer and allows protected tags only;
  - `PutObject` on `templates/*` only, with `If-None-Match: *`;
  - denies on delete, ACL, retention, legal hold, bypass and bucket settings;
  - output `PublisherRoleArn`, the value this template takes.

## 0.1.3 (19:45 UTC)

- **`s3:PutLifecycleConfiguration`** is added to the root-only loosening deny (security.aws.a). A lifecycle rule that expires current versions adds delete markers even under Object Lock, and a conditional PUT then succeeds on that key. The publisher role denies it to itself, but other admins were not stopped. With this, security.aws.a is content for the template to become a plan for aws.c.
- **Alarms need data events** (cloudtrail.aws.a, now restarted). `PutObjectRetention`, `PutObjectLegalHold` and object writes are S3 *data* events, so the trail covering this bucket must log data events for it, or no alarm sees them. That is part of the plan: a data-event selector on this bucket only, so the cost stays small (billing.aws.a for the number). The rule itself is with the fresh cloudtrail.aws.a session (its hand-over, work/cloudtrail.aws.a).

## Checked by security.aws.a (19:50 UTC): fit to go to aws.c as a plan

Once the `?versionId=` link form is agreed with dev.2.aws.a (asked at 19:35).

**Twin tests the plan must carry (dev.1.aws.a):**
1. The publisher is refused `PutBucketPolicy`, `DeleteBucketPolicy`, `PutBucketPublicAccessBlock`, `PutBucketOwnershipControls`, `PutBucketObjectLockConfiguration`, `PutBucketVersioning` and `PutLifecycleConfiguration`.
2. The publisher is refused `PutObject` without `If-None-Match: *`. With it, a write to an existing key is refused (412), and multipart is refused.
3. Everyone is refused `DeleteObject` (no delete marker) and `DeleteObjectVersion`.
4. A locked version cannot have its retention shortened, by anyone.
5. Anonymous `GetObject` works on `templates/*` and is refused elsewhere. A link with `?versionId=` returns exactly that version.
6. Any change by root to the bucket's settings raises the alarm (cloudtrail.aws.a), which needs data events on this bucket.

**For Dinis:** `RetentionYears` (1 proposed), and creating the bucket and the publisher stack (iam.aws.a's `sws-vault-publisher`) in our account.

**Link form agreed (19:55 UTC):** dev.2.aws.a 87873df. Each index entry is `{ url, versionId, sha256 }`, where `url` is the key form with no query and `versionId` is required. The link's `templateURL` is `<url>?versionId=<id>`, encoded, and no other query is accepted. This covers `vault`, `vault-access` and `vault-edge`, with one bucket for every region. The plan is ready for aws.c.
