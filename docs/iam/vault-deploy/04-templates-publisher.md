# Vault deploy: the role that publishes templates

iam.aws.a, 23 Nov 2026 ~17:55 UTC, for cloudformation.aws.a's templates bucket (docs/cloudformation/vault/templates-bucket.yaml, 7eb0f1d), which takes PublisherRoleArn. Draft: [templates-publisher.yaml](templates-publisher.yaml), cfn-lint 1.61.0 clean. A plan for Dinis; for review by security.aws.a and aws.c.

## Shape

- **Home:** its own stack, `sws-vault-publisher`, in our account, applied by console. The hub's change role cannot create roles (P-IAM-001), and the publisher should not live in a stack the hub's page can update.
- **Trust:** the account's existing GitHub OIDC provider; `aud` = `sts.amazonaws.com`; `sub` exactly `repo:<owner>/<name>:environment:<env>` (parameters; default environment `vault-release`). An environment subject, not a branch or tag wildcard, so the protection lives in GitHub: the environment gets a required reviewer (Dinis) and is limited to protected tags, and AWS hands out credentials only after a person approves that run.
- **Rights:** `s3:PutObject` on `sws-vault-templates-<account>-*/templates/*` only with `s3:if-none-match` = `*` (new files only); GetObject and GetObjectVersion there to read back; deny every delete, ACL, retention, legal hold, governance bypass, tagging and bucket-setting change; deny PutObject anywhere else.

## Why If-None-Match, with Object Lock already on

The bucket is versioned with Object Lock in compliance mode, so a published version can never change or be deleted. But a second PutObject to the same key creates a new version that becomes the current one, and a quick-create link naming only the key would then serve the new file, while the page shows the old sha256. Two ways to close that, and the draft does the first:

1. The publisher can only create keys that do not exist (`If-None-Match: *`, enforced by the `s3:if-none-match` condition key). *To confirm (boto3.aws.a):* that IAM offers this key on PutObject; if it does not, the condition fails closed and nothing can be published, visibly.
2. Quick-create links pin `versionId` as well as the key. Recommended in any case (for cloudformation.aws.a and dev.2.aws.a): the page's index of published templates records key, versionId and sha256 together.

## Not here

No permissions boundary: the role's policy is fixed in its own stack, nothing else can edit it, and it creates no roles. If security.aws.a wants one for consistency, it is a short managed policy with the same two allows.

## Review (18:00 UTC)

security.aws.a: reviewed and fine (exact trust; environment with required reviewer and protected tags; new files only under templates/; explicit denies; no boundary needed). Optional, not a blocker: pin the release workflow file too (GitHub's `job_workflow_ref` claim), so another workflow in the same environment cannot publish. Two ways, to confirm with boto3.aws.a: an IAM condition key for that claim, if AWS offers one for GitHub tokens; or GitHub's OIDC subject customisation, putting `job_workflow_ref` into `sub`, which the trust already matches exactly (then the sub value in this template changes to that format).

boto3.aws.a (docs/boto3/2026-11-23__12-templates-bucket.md): `s3:if-none-match` is a condition key of s3:PutObject in the S3 Service Authorization Reference (String, "the request's If-None-Match conditional header"), so AddNewTemplateFilesOnly works as written; `StringEquals "*"` (create-only) is boto3.aws.a's reading of a String key, AWS's own example checks presence with Null. Multipart parts carry no conditional header, so the policy also means single PUT only, which suits templates under 1 MB. Version pinning: the CloudFormation console guide documents `?versionId=` on a template URL; quick-create's templateURL is the same field, so links should carry key and versionId, URL-encoded, confirmed on the first link.
