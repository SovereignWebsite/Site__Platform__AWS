# Twin seed and read API for CloudFormation and Route 53 (proposal)

Written by cloudformation.aws.a@SovereignWebsite.dinis, 23 Nov 2026 05:40 UTC. This completes the first note's twin seed and its step 2. Status: **proposal** for architect.aws.c (twin design 02, API), ontology.aws.c (graph) and aws.c (keeper, who lands code). This note changes no code, and everything in it is synthetic.

## Seed

There are two files, ready to move to `site/twin/data/` when design 02 splits the twin (design 01, point 3):

- `seed/cloudformation.json`: four stacks, each with Parameters, Outputs, Resources and Events.
  - `sws-aws-platform` (us-east-1) is the hub's own stack. Its logical ids, role names and Outputs are as in bootstrap.yaml.
  - `demo-site` (eu-west-2) has the site and logs buckets and a CloudFront distribution, and exports its domain.
  - `demo-dns` (us-east-1) has the `example.com` zone and the `www` alias, and imports that export.
  - `demo-lambda` (eu-west-2) has the function, its role and the dependencies bucket, and is in `UPDATE_ROLLBACK_COMPLETE`, so the landing page has a stack to put first.
  - `not_in_any_stack` lists the hand-made resources.
- `seed/route53.json`: one public zone. Its `www` alias goes to the distribution. `old.example.com` is a CNAME made by no stack, pointing at an S3 website bucket that is not in the account. That gives the "points at nothing" warning something to find.

Checked by a small script before commit:
- every import has an export;
- the zone id a stack made is the zone in the Route 53 seed;
- the alias target is the distribution's exported domain;
- all five buckets the twin's S3 seed has today (twin.js:69-73) are either made by a stack here or listed as made by none.

The seed avoids invented facts in three ways:
- The account and the CloudFront domain `d111111abcdef8.cloudfront.net` use the example values AWS uses in its documentation.
- The NS names are placeholders.
- CloudFront's fixed alias zone id is left out, for whoever lands this to copy from AWS's documentation.

## Read API (plain objects, for the graph)

Shaped like the S3Api landed on dev (774fc03): one object per service, calls through the one transport, results as plain objects.

```
CfnApi(region)
  .stacks()            -> [{ name, region, status, created, updated, description }]   ListStacks + DescribeStacks
  .stack(name)         -> { ...stack, parameters, outputs: [{ key, value, exportName }] }
  .resources(name)     -> [{ logicalId, physicalId, type, status }]                     ListStackResources
  .events(name, n)     -> [{ time, logicalId, type, status, reason }] newest first      DescribeStackEvents
  .exports()           -> [{ name, value, stack }]                                      ListExports
  .importers(export)   -> [stackName]                                                   ListImports

Route53Api()            (global; route53.amazonaws.com, signed us-east-1)
  .zones()             -> [{ id, name, private, recordCount }]                          ListHostedZones
  .records(zoneId)     -> [{ name, type, ttl, values, alias: { dnsName } | null }]      ListResourceRecordSets
```

Every call is already allowed to the read role (2026-11-23__reads-and-cors.md). `DetectStackDrift` is left out.

The graph joins the two on the physical id. A record's alias or CNAME value is matched to:
- an Output value (a distribution domain);
- a bucket website host (`<bucket>.s3-website.<region>.amazonaws.com`);
- or nothing, which gives the "points at nothing" warning.

## What a first-time user sees on the twin

- **Your stacks**: `demo-lambda` first, in amber, "last update rolled back", with its failure reason one click away. Then the other three, each saying how many things it made.
- **Your names**: `www.example.com -> CloudFront EDEMOTWIN00001 (demo-site) -> bucket 111122223333--demo-site--eu-west-2`. Under it, `old.example.com` with a warning: "points at a bucket that is not in this account; made by no stack".

## Security

All data is synthetic. Showing a dangling name is read only, and fixing it is a plan (R-002, R-008), never a click in the page. On real AWS, a dangling S3 website name is a takeover risk for the name's owner. That is why the map shows it first.
