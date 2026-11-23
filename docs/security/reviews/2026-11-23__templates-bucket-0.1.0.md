# Review: Vault templates publishing bucket, draft 0.1.0 (cloudformation.aws.a 7eb0f1d)

security.aws.a@SovereignWebsite.dinis, fresh session, 23 Nov 2026 ~18:00 UTC. Design review only, no AWS call.

What it gets right: Object Lock in compliance mode; versioning; TLS only; ACLs blocked with BucketOwnerEnforced; public read limited to `templates/*`, with no public ListBucket; writes only by the publisher role; deletes denied to everyone; create-only writes through If-None-Match, left as a CHECK with boto3.aws.a. Its own note is right that Object Lock alone does not stop a new current version.

## Must fix

1. **PutBucketPolicy is not denied.** NobodyLoosensThisPolicyOrTheLock denies DeleteBucketPolicy, but not s3:PutBucketPolicy. Any principal with that right (any administrator in our account) can replace the whole policy, and with it every deny: the publisher limit, create-only writes and no-deletes. Object Lock still keeps old versions, but the overwrite protection is gone. Add s3:PutBucketPolicy, s3:PutBucketPublicAccessBlock and s3:PutBucketOwnershipControls to that statement (root only). Then test in the twin that the publisher cannot change the policy.

## For Dinis, with the RetentionYears decision

2. **Compliance mode is permanent for whatever is published, mistakes included.** A template published by error, or one later found unsafe, stays publicly readable at its URL until retention ends. Nobody, root included, can remove it before then; only closing the account would. That makes the publish step a one-way door:
   - The publisher pipeline must run the leak scan and need a reviewed, signed commit before PutObject. Never publish by hand.
   - The page's index is the only list customers are offered, so a withdrawn version simply leaves the index. Old links still work, though, so a withdrawn template needs a published notice.
   - Recommend a much shorter default than 10 years. One year is enough to keep every link working through a release cycle, and it bounds the cost of a mistake. Dinis decides.

## Smaller

3. The root exception on loosening is right (break-glass). Say on the plan that using it is an alarm (cloudtrail.aws.a's rules: Root on any resource).
4. The publisher role, chosen by aws.c and iam.aws.a: if it is the GitHub OIDC role, its `sub` is pinned to repository, branch and environment, and its policy allows PutObject on `templates/*` only.
5. Public read is needed only if quick-create across accounts cannot use anything else. That is boto3.aws.a's CHECK. If it is confirmed, the public read of exactly `templates/*` is accepted.

Verdict: not ready for a plan until point 1 is fixed. Point 2 goes to Dinis with RetentionYears.
