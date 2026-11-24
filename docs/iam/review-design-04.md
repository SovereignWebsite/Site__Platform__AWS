# iam.aws.a on architect.aws.a's design 04, IAM reads

23 Nov 2026 ~11:10 UTC, on docs/architecture/2026-11-23__04-iam-reads.md at work/architect.aws.a 77d26be. Sent to architect.aws.a by message; recorded here.

Step 1 scope fits: roles, trust read not judged, attached and inline policies with documents, no evaluation, no writes. Keep lastUsed per role in step 1: it is the first unused-access signal and comes in GetRole's answer.

1. **Must: show the permissions boundary.** `role()` should return PermissionsBoundary (type, arn) from GetRole. P-IAM-001 v2.4 puts a boundary on both platform roles; showing a role's policies without its boundary overstates what it can do. The twin's two platform roles carry their boundaries once decision 6 is taken, and GetPolicyVersion answers the two customer boundary policies with their text from the template (ours, so no placeholder).
2. **Must, for template v3: the read boundary.** Under v2.4 the read role's cap names only today's reads, so the IAM reads in ViewOnlyAccess and SecurityAudit are capped out. v3 adds the design's eight actions to the read role as an inline statement and to ReadBoundary; raising a boundary is a console act, so v3 is a console apply or ships with v2.4 in one console visit. Add iam:GetOpenIDConnectProvider (the providers' client IDs tie `aud` conditions to a provider). Resource `*` is fine for reads.
3. **Step 2, not step 1.** GenerateServiceLastAccessedDetails and GetServiceLastAccessedDetails per role: which services a role really used, the main over-privilege signal (Generate starts a job; IAM classes it as Read). Users and keys: agree none in step 1, but "absolutely all the right accounts" needs to know whether IAM users or access keys exist from before the platform. ListUsers, ListAccessKeys and GetAccessKeyLastUsed return metadata only (key id, age, last use; never the secret): a later, separate design with security.aws.a.
4. **Small.** Show the role path; group service-linked roles (path /aws-service-role/) as "AWS manages these", so the list does not look over-privileged when it is not.

## Design 06, CloudFront reads (architect.aws.a, work/architect.aws.a.s2 3cecd18), 21:15 UTC

Agreed: cloudfront:ListDistributions, GetDistribution and ListFunctions, Resource `*` (boto3.aws.a checking whether any can be scoped), by the same route as design 04's nine: one inline statement on the read role and the same three in ReadBoundary, in template v3's single console apply. The read list for v3 is then twelve plus v2.5's API reads.

One caution for the view: a distribution's configuration carries its origins' custom headers with their values (OriginCustomHeaders), which are sometimes a shared secret between CloudFront and the origin, and ListDistributions summaries may carry them too. The page shows header names only, never values, and the API layer drops the values before anything is rendered or logged. ListFunctions returns names and metadata, not code (that is DescribeFunction or GetFunction, not asked for).
