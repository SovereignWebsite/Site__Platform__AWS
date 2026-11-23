# CloudFormation with Route 53: what the twin shows today, and the first map

Written by cloudformation.aws.c@SovereignWebsite.dinis, 23 Nov 2026, first wake (03:26 UTC). Read from site/twin.js, site/app.js, site/cloudformation/bootstrap.yaml, the memo (sections 9, 10, 17 to 21), docs/board/ (CF-1, R53-1, S3-4) and docs/security/risks.md, at dev 4433914. No live AWS and no request to any AWS endpoint: everything here is from the code and the twin. Status: **proposal**, for architect.aws.c (API and twin design), ontology.aws.c (graph), aws.c (keeper) and security.aws.c.

## What a first-time user can do today

On the twin, nothing that says "CloudFormation" or "Route 53" to them. The one stack is only reached through the plan flow (update the platform's own stack), and there is no page that answers the two questions this area exists for:

1. **This stack: what did it make?** (CF-1)
2. **This name: what does it point at, and who made it?** (R53-1)

## What the twin has today (site/twin.js)

| Service | Answers | Gaps for this area |
|---|---|---|
| CloudFormation | `GetTemplate`, `CreateChangeSet`, `DescribeChangeSet` (fixed answer: two IAM roles modified), `ExecuteChangeSet`, `DescribeStacks` (one stack, `sws-aws-platform`) | No `ListStacks`, `ListStackResources` / `DescribeStackResources`, `DescribeStackEvents`, `ListExports`. `DescribeStacks` returns no `Outputs`, `Parameters`, `CreationTime` or tags. Only one stack exists. |
| Route 53 | Nothing: `route53.amazonaws.com` is not routed, so in twin mode the transport answers 501 (fail closed, c8cece5). | Everything. |
| Cloud Control | `ListResources` / `GetResource` for buckets | Not for `AWS::Route53::HostedZone` or stack-made resources. |

The twin's seed already implies a story this area can complete, and nothing more should be invented beyond it: a demo site bucket "served from S3 through CloudFront", a CloudFront logs bucket for `demo-distribution`, a Lambda dependencies bucket, a CloudTrail bucket, and the IAM role `sovereignwebsite-factory-dns` (its name says DNS; what it may do in Route 53 is not in the twin, see R-005).

Note for aws.c: app.js calls CloudFormation in `us-east-1` (app.js:190, :409), and the twin answers any region. A stack lives in one region; the map must list stacks per region (London and Ireland first, memo section 9) and the twin should answer `ListStacks` differently per region, so a region bug shows on the twin, not first on real AWS.

## The map: two graphs that meet at the resource

```
 Stack --made--> Resource (logical id, physical id, type)
   |                 |
   +--exports--> Output --imported by--> Stack
                     |
 Zone --holds--> Record (name, type) --points at--> CloudFront distribution | bucket website | API | another name
```

- **Stack to resource**: `ListStackResources` gives logical id, physical id and type for every resource a stack made. The physical id is the join key to every other area (a bucket name, a role name, a distribution id, a zone id).
- **Resource to stack** (the reverse, what S3-4 needs): the tag `aws:cloudformation:stack-name` that CloudFormation puts on most resources, or the reverse of the stack-to-resource map. One `ListStackResources` per stack is cheap when stacks are few (memo: "assets are few").
- **Record to target**: alias records name a target (CloudFront `*.cloudfront.net`, S3 website endpoint, another record); CNAMEs name a host. Each target resolves to a resource of another area, so a name is one click from the bucket behind it.
- **Drift**: a resource changed outside its stack. Shown per stack as a later step, after the read is in place (the drift calls need checking against the read role first, see below).

## Proposed twin seed (synthetic only, account 111122223333)

All names in the reserved `example.com` domain or prefixed `demo-`, so nothing reads as a real customer or a real zone.

| Stack (region) | Makes | Why it is in the pack |
|---|---|---|
| `sws-aws-platform` (us-east-1, already there) | `PlatformRead`, `PlatformChange` (IAM roles), with Outputs `ReadRoleArn`, `ChangeRoleArn` | The hub's own stack, so a user sees the roles they are using |
| `demo-site` (eu-west-2) | the demo site bucket, a CloudFront distribution, its logs bucket; exports the distribution domain | Connects to what the S3 browser already shows |
| `demo-dns` (us-east-1) | hosted zone `example.com`; alias `www.example.com` to the distribution (imported from `demo-site`) | Exercises exports and imports between stacks |
| `demo-lambda` (eu-west-2) | one function, its role, the deps bucket | Joins lambda.aws.c's area |
| one resource with no stack | a record `old.example.com` CNAME to a name nothing serves | So the "made by nobody / points at nothing" finding has something to find |

Twin calls to add, in order: `ListStacks`, `DescribeStacks` with Outputs and Parameters, `ListStackResources`, `DescribeStackEvents`, `ListExports`; Route 53 `ListHostedZones`, `ListResourceRecordSets`. The seed should be JSON apart from the code, as design 01 point 3 asks, so it can become a demo pack (memo section 19).

## Reads and permissions (to check, not assumed)

The read role already has `ViewOnlyAccess` and `SecurityAudit` (bootstrap.yaml:36-37). Before any plan, check against the published managed policy documents which of these they already grant: `cloudformation:ListStacks`, `DescribeStacks`, `ListStackResources`, `DescribeStackEvents`, `ListExports`, `ListImports`, `GetTemplate`; `route53:ListHostedZones`, `ListResourceRecordSets`, `GetHostedZone`. If any is missing it becomes a least-privilege line in template v3 (memo section 2), prepared by aws.c, for Dinis's Approve. `DetectStackDrift` starts a detection, so it is not a pure read: leave it out of the read role until security.aws.c has looked.

Open question for architect.aws.c: whether the Route 53 API answers a browser (CORS) the way the CloudFormation query API evidently does for the hub. If it does not, the fallback is Cloud Control for hosted zones, or a GitHub Actions workflow writing a snapshot to a vault (memo section 9). To be checked in AWS's documentation, not guessed; the twin must then behave the same way (fail as a browser would, like it does for S3 CORS).

## From a user's point of view (first sketch, for ux.aws.c and sherpa.aws.c)

- Landing: "Your stacks" as cards, one line each: name, region, status, how many things it made, when last changed. Failed or drifting stacks first.
- Open a stack: what it made, grouped by type, each a link to its area (bucket to the S3 browser, role to IAM). Outputs and who imports them. The last events as a short timeline, newest first.
- "Your names": each record as `www.example.com -> CloudFront demo-distribution -> bucket demo-site`, the whole chain in one line, and a warning on any name that points at nothing.
- Every view works on the twin, linked from "Try the twin".

## Next three steps

1. Ask architect.aws.c to fold the CloudFormation and Route 53 twin calls above into the twin design (design 02), and agree the seed as JSON.
2. Write the read API shape (`CfnApi.stacks()`, `.resources(stack)`, `Route53Api.zones()`, `.records(zone)`) as plain objects for ontology.aws.c's graph.
3. Check the permissions and CORS questions above against AWS's documentation and record the answers here.

## Security note

This note changes no code. The stack-made resources include the hub's own roles; showing them is read only. Any future "fix the drift" or "delete the dead record" is a plan for aws.c and Dinis's Approve, never a click in the page (R-002, R-008).
