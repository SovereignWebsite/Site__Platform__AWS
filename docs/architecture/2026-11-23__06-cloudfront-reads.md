# Design 06: CloudFront reads

architect.aws.a@SovereignWebsite.dinis, 23 Nov 2026, session https://claude.ai/code/session_018yvwtMBzo4iQ9dN7icjvXK. Status: proposed; AWS facts checked (boto3.aws.a), agreed by iam.aws.a, ontology.aws.a and security.aws.a (fe4e2ad). Follows design 03 (every service in one shape) and its refinements; closes the golden graph's last edges that wait on an API (serves_from with evidence `api`), and gives the Vault deploy (design 05, plan step 7) its distribution node.

Facts about AWS were checked by boto3.aws.a (docs/boto3/2026-11-23__18-cloudfront-reads.md, botocore cloudfront 2020-05-31, read 23 Nov 2026): confirmed unless marked otherwise below.

## 1. Why now

- The golden graph names the demo distribution only by naming and content: `urn:sws:cloudfront-distribution:demo-distribution-1` comes from log file names, and its one `serves_from` edge to the site bucket comes from a sentence in index.html. With a CloudFront API, that edge has evidence `api` and trust `verified`, and the distribution gets its real ARN.
- The Vault deploy makes a distribution in front of a Function URL with a CloudFront Function on `/health` (vaults.aws.a design 04). The deploy view and viz.aws.a's step 7 need it as a node, with its origin and its function.
- cloudformation.aws.a's twin already lists `AWS::CloudFront::Distribution` resources (`EDEMOTWIN00001` in demo-site; one per Vault stack), and CfnApi derives their ARNs (design 03 refinement 1, `arnDerived`). This design makes the owning service's answer exist, so the derived ARN gives way to it (dev.2.aws.a's rule in af1e62f).

## 2. CloudFrontApi

CloudFront is global: one endpoint, `https://cloudfront.amazonaws.com/2020-05-31/...`, signing name `cloudfront`, credential scope `us-east-1`, REST with XML answers, paged by `Marker` and `MaxItems`. `DistributionList` has `IsTruncated` and `NextMarker`; `FunctionList` has `NextMarker` and no `IsTruncated`, so functions page on `NextMarker` alone. The hub's CSP already allows `https://*.amazonaws.com`. **CORS is not known:** AWS's SDK notes list CloudFront as allowing CORS only up to API version 2018-11-05, and the current 2020-05-31 is not listed. One browser call would settle it, but agents make no calls to AWS; so CloudFront reads are twin-only until aws.c or Dinis checks it on the real account, and the page says so.

```
var api = CloudFrontApi(send, { account });
api.distributions({ next })   -> { items: [distribution], next }              ListDistributions
api.distribution(id)          -> distribution + { logging, defaultRoot }       GetDistribution
api.functions({ next, stage }) -> { items: [fn], next }                       ListFunctions
distribution = { id, arn, domain, aliases: [host], enabled, status, priceClass, origins: [origin],
                 functions: [{ arn, event, behaviour }], lastModified }
origin       = { id, domain, kind, target, path, oac, customHeaders: [name] }
fn           = { name, arn, runtime, stage, status, lastModified }
```

- **arn on everything** (design 03 rule 2): `arn:aws:cloudfront::<account>:distribution/<id>` is given by AWS in the summary (`ARN` is a required member of `DistributionSummary`); a function's ARN likewise.
- **origin.kind and origin.target**, decided in the API, not the graph, so every UI shows the same:
  - `<bucket>.s3.<region>.amazonaws.com` or `<bucket>.s3.amazonaws.com`: kind `s3`, target the bucket's ARN.
  - `<bucket>.s3-website-<region>.amazonaws.com` or `.s3-website.<region>.`: kind `s3-website`, target the bucket's ARN.
  - `<url-id>.lambda-url.<region>.on.aws`: kind `lambda-url`, target `null` (a Function URL id does not name its function; resolving it needs Lambda's `ListFunctionUrlConfigs` per function, step 2).
  - anything else: kind `custom`, target `null`; the domain is shown as text, never fetched.
- **Origin custom headers: names only** (iam.aws.a): `OriginCustomHeaders` come back with their values, which are often a shared secret between CloudFront and the origin (the Vault's Function URL may rely on one). CloudFrontApi keeps the header names and drops every value as it parses, before anything can render, log, cache or put it in the graph; a test plants a value and checks it appears nowhere in the API's output, error paths and anything kept for Decode or debugging included; the raw XML body is never retained (security.aws.a). Comment and aliases are owner-set text and render as text only. The value still crosses the browser's network panel for the person using the read role: accepted, it is their account. Same for any `OriginAccessControl` signing detail beyond its id.
- **No function code:** `ListFunctions` is metadata only; `DescribeFunction` and `GetFunction` (which return code) are not called and not in the contract.
- **functions**: the default behaviour's and each cache behaviour's function associations (`viewer-request`, `viewer-response`), with the behaviour's path pattern (`*` for the default).
- **logging**: `GetDistribution` gives the legacy standard logging bucket and prefix when it is on (`{ bucket, prefix }` or `null`). Standard logging v2 (deliveries to S3, CloudWatch Logs or Firehose) is configured through CloudWatch Logs' delivery APIs (`PutDeliverySource` with the distribution's ARN and log type `ACCESS_LOGS`, a delivery destination, `CreateDelivery`), not CloudFront's, so it is step 3.
- **Errors, paging, Decode:** as S3Api and CfnApi (design 03): `Error` with `.code` and `.status`, opaque `next`, a CORS `TypeError` passes through, XML parsed with the same small member walker CfnApi uses (no DOMParser, no HTML).
- **Contract:** `site/api/cloudfront.openapi.json` 0.1.0, `x-aws-actions`: `cloudfront:ListDistributions`, `cloudfront:GetDistribution`, `cloudfront:ListFunctions`. Three reads, `Resource: "*"` (the list actions have no resource type in AWS's service authorization reference). For iam.aws.a: these are not in the read role or ReadBoundary today; they join template v3's inline statement next to design 04's nine IAM reads, the same console apply.

Not in v1: cache policies, origin request policies, OAC details beyond its id, invalidations, field-level encryption, real-time log configs, WAF, distribution config writes. Reads only.

## 3. Graph.add.cloudfront

`g.add.cloudfront({ distributions, functions })`, design 03's adapter shape, ontology.aws.a's schema:

- A node per distribution, id its ARN, type `distribution`, label its domain (aliases as attribute), `cfn_type: AWS::CloudFront::Distribution`.
- `serves_from` from the distribution to each origin's target, evidence `api`, source "CloudFront GetDistribution (origin <id>)". An origin with no target makes no edge (the domain stays an attribute), never a guess.
- `invokes` (ontology.aws.a; read back as "is invoked by") from the distribution to each associated function, the event (`viewer-request` and so on) and path pattern as edge attributes. A CloudFront Function is a node of type `function` with `cfn_type: AWS::CloudFront::Function`.
- `logs_to` the logging bucket, evidence `api`, when legacy logging is on.
- **One node per distribution** (ontology.aws.a): CfnApi's derived ARN, `arn:aws:cloudfront::<account>:distribution/<id>` (no region), is the same id this adapter uses, so they are one node. A naming node `urn:sws:cloudfront-distribution:<name>` merges into the ARN node when `<name>` is the distribution's id; its edges move with their own evidence and source, and attributes the ARN node lacks are copied. A name that matches no id stays its own node.
- **Where the id comes from in logs** (boto3.aws.a): logs delivered through Firehose are named `<prefix><stream>-<version>-<yyyy>-<mm>-<dd>-<hh>-<mi>-<ss>-<uuid><ext>`; the distribution id is **not** in the object name unless the stream's prefix adds it, it is in the records. So the content adapter takes the distribution from the records, and makes `records` edges to `arn:aws:cloudfront::<account>:distribution/<id>` directly, evidence `content`; the naming rule from file names stays only for logs whose names carry an id.
- Golden: once the twin answers (section 4), ontology.aws.a re-runs its builder with the CloudFront answers, the `serves_from` edge becomes `api` / `verified`, and the urn node is the ARN node. The set-aside count in test/api/graph.test.mjs goes down by the edges this closes.

## 4. The twin

- **ListDistributions / GetDistribution / ListFunctions** answered from each account's world (design 02: one journal per account): in 111122223333, `EDEMOTWIN00001` (domain `d111111abcdef8.cloudfront.net`, origin the demo-site bucket's REST endpoint, alias `www` from the demo-dns stack, no functions); in a customer account, each Vault stack's distribution once its create has settled on the clock, with its Function URL origin and its `sws-vault-<id>-health` function on `viewer-request` for `/health`. A deleted stack's distribution leaves when its delete settles.
- **The log files** (boto3.aws.a): the twin's CloudFront log objects are named `demo-distribution-1-...`, which matches neither AWS nor the stack's `EDEMOTWIN00001`. They become Firehose's names (`cloudfront/<yyyy>/<mm>/<dd>/<hh>/demo-cloudfront-logs-1-<yyyy>-<mm>-<dd>-<hh>-<mi>-<ss>-<uuid>.gz`, the uuid from the pack's seeded stream), never the v1 `<id>.<date>` names, and each record carries the distribution id `EDEMOTWIN00001`. That is a golden change: its own commit, golden re-taken, data.aws.a and ontology.aws.a told (as with the network split).
- **Not yet:** the twin answering `/health` for a Vault's distribution host (design 05 section 5) is the transport's part, not CloudFront's API; it uses the same world.

## 5. Steps

1. CloudFrontApi with its contract and tests (dev.2.aws.a), over the twin's three answers (dev.1.aws.a, on the journal). boto3.aws.a's checks are back (18:41Z).
2. Graph.add.cloudfront with the giving-way rules and tests; ontology.aws.a re-runs the golden; the log-name change in the twin as its own commit.
3. Later: logging v2 through CloudWatch Logs' delivery reads (`logs:DescribeDeliveries`, `logs:DescribeDeliverySources`, `logs:DescribeDeliveryDestinations`, confirmed by boto3.aws.a), which gives `logs_to` the Firehose stream with evidence `api`; Function URL to function via Lambda's `ListFunctionUrlConfigs`.

## 6. Asks

- **boto3.aws.a:** done (18:41Z); six of seven confirmed, CORS open.
- **aws.c, for Dinis:** CORS on `cloudfront.amazonaws.com` 2020-05-31 from the hub's origin is unknown; checking it is one read on the real account, which only aws.c's plan with Dinis's approval may do. Until then CloudFront reads are twin-only.
- **ontology.aws.a:** agreed (18:41Z): `invokes`, the merge rule with the stack-resource id as the ARN node; golden re-run after step 2.
- **iam.aws.a:** agreed (18:41Z): the three reads, inline statement plus ReadBoundary in v3's console apply; condition taken: custom header names only, values dropped in the API layer with a test; no DescribeFunction or GetFunction.
- **dev.2.aws.a and dev.1.aws.a:** steps 1 and 2 once the checks are back.
- **security.aws.a:** origin domains are shown as text and never fetched; nothing new in the CSP.
