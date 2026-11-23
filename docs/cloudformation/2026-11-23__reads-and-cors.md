# CloudFormation and Route 53 reads: what the read role already grants, and the CORS question

Written by cloudformation.aws.a@SovereignWebsite.dinis, 23 Nov 2026 04:30 UTC. This is step 3 of the first note (2026-11-23__first-note.md). Sources are the public AWS documentation pages linked below, read today. No request was made to any AWS endpoint. Status: **finding**, for aws.c (template), architect.aws.c (API and twin) and security.aws.c.

## Result in one line

The read role already has every read this area needs: it attaches both `ViewOnlyAccess` and `SecurityAudit` (site/cloudformation/bootstrap.yaml:36-37), and between them they grant all of them. Template v3 needs **no new read line** for CF-1 or R53-1. The one gap is `DetectStackDrift`. Neither policy grants it, and that is a good thing (see below).

## The two managed policies

Sources:
- ViewOnlyAccess, version v49: https://docs.aws.amazon.com/aws-managed-policy/latest/reference/ViewOnlyAccess.html
- SecurityAudit, version v95: https://docs.aws.amazon.com/aws-managed-policy/latest/reference/SecurityAudit.html

Neither has a Deny or a NotAction.

The policies use these patterns:
- ViewOnlyAccess: `cloudformation:DescribeStacks`, `cloudformation:GetTemplateSummary`, `cloudformation:List*`, `route53:Get*`, `route53:List*`.
- SecurityAudit: `cloudformation:DescribeStack*`, `GetStackPolicy`, `GetTemplate`, `GetTemplateSummary`, `ListStack*`, `ListStackResources`, `route53:Get*`, `route53:List*`.

| Action | ViewOnlyAccess | SecurityAudit | Read role (both) |
|---|---|---|---|
| cloudformation:ListStacks | yes | yes | yes |
| cloudformation:DescribeStacks | yes | yes | yes |
| cloudformation:ListStackResources | yes | yes | yes |
| cloudformation:DescribeStackResources | no | yes | yes |
| cloudformation:DescribeStackEvents | no | yes | yes |
| cloudformation:ListExports | yes | no | yes |
| cloudformation:ListImports | yes | no | yes |
| cloudformation:GetTemplate | no | yes | yes |
| cloudformation:GetTemplateSummary | yes | yes | yes |
| cloudformation:DescribeStackResourceDrifts | no | yes (by `DescribeStack*`, inferred from the pattern) | yes |
| cloudformation:DetectStackDrift | no | no | **no** |
| route53:ListHostedZones | yes | yes | yes |
| route53:ListResourceRecordSets | yes | yes | yes |
| route53:GetHostedZone | yes | yes | yes |
| route53:ListTagsForResource | yes | yes | yes |

A caution: each policy alone leaves gaps. ListExports and ListImports come only from ViewOnlyAccess, and DescribeStackEvents and GetTemplate only from SecurityAudit. If a later template drops either policy, this table has to be checked again. These are AWS-managed policies, so AWS can change them, and a new version would also mean checking again.

## Drift

The Service Authorization Reference lists `DetectStackDrift` with "Access level: Read" (https://docs.aws.amazon.com/service-authorization/latest/reference/list_awscloudformation.html). It still starts a drift detection, which then makes its own read calls. The first note therefore keeps it out of the read role until security.aws.c has looked, and nothing here changes that.

The map can show drift that a detection has already found, through `DescribeStackResourceDrifts`, which the read role has. Starting a detection would be a plan for aws.c and Dinis's Approve.

## Route 53 region

Route 53 is signed in `us-east-1` at `route53.amazonaws.com` (https://docs.aws.amazon.com/general/latest/gr/r53.html: "use the same Regions as above to sign requests. The IPv4 service endpoint is route53.amazonaws.com"). This holds outside the China regions and GovCloud.

So Route 53 does not take part in the per-region listing the first note asks for CloudFormation. The twin should answer Route 53 only at that host, and sign-check it as us-east-1.

## CORS: not settled by the documentation

The AWS SDK for JavaScript v3 CORS page (https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/cors.html) says CORS matters for services other than S3. It does not say which services send CORS headers.

None of these pages states whether a browser may call `route53.amazonaws.com` or `cloudformation.<region>.amazonaws.com` directly:
- the CORS page above;
- the Route 53 API reference;
- the browser getting-started guide.

That is absence of evidence, not an answer. The hub's own CloudFormation calls from the page (app.js) are evidence for CloudFormation once they have run on real AWS. Whether they have is for aws.c to say; I have not seen it.

Proposal, for architect.aws.c and aws.c:
- Until a real browser call has been seen to succeed, the twin answers Route 53 as a browser would be refused (fail closed, as it does now with 501).
- The fallback stays as the first note puts it: Cloud Control, or a GitHub Actions snapshot written to a vault.
- Settling it needs one read call from the page on real AWS, which only Dinis can run. That is a question for pm.aws.c's decisions board, not something an agent tests.

## Next

1. The read API shape (`CfnApi`, `Route53Api`) as plain objects. This needs a code path from aws.c and architect.aws.c, and until then it lives here as a sketch.
2. A twin seed as JSON for the stacks and zone in the first note, sent to architect.aws.c.

## Route 53 CORS, mostly settled (23 Nov, 22:45 UTC, boto3.aws.a: docs/boto3/2026-11-23__20-route53-reads.md)

- **The AWS SDK for JavaScript v2's `SERVICES.md`** marks Amazon Route 53 (API 2013-04-01) as "Allows CORS"; Route 53 Resolver is not. That is AWS's own published metadata, so it is no longer an absence of evidence. It still falls short of a documented guarantee. One real browser call confirms it, as for EC2 and CloudFront, and only Dinis can make that call.
- **Shapes (botocore):**
  - rest-xml, global endpoint `route53.amazonaws.com`, signed `us-east-1`;
  - `ListHostedZones` pages by `Marker`/`NextMarker`;
  - `GetHostedZone` returns the zone with its `DelegationSet` name servers;
  - `ListResourceRecordSets` pages by `StartRecordName`/`StartRecordType`/`StartRecordIdentifier`, not by a marker. This matches the opaque `next` agreed in design 03.
- **IAM:** `ListHostedZones` takes `Resource "*"`; the other two can be scoped to hosted-zone ARNs. All three are in the read role already, by `route53:List*` and `route53:Get*` (section above).
- **Decision, mine with architect.aws.a:** the twin may stop answering 501 for these three reads and answer from `seed/route53.json`. The seed has:
  - the `example.com` zone, made by `demo-dns`;
  - the `www` alias to the demo distribution;
  - the dangling `old.example.com`.

  Each answer is marked "CORS per SDK v2 metadata, to confirm with one real call". Every other Route 53 call keeps answering 501.
