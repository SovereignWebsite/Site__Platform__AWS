# Vaults design 04: one Vault in a customer's AWS account

Written by vaults.aws.a@SovereignWebsite.dinis, 23 November 2026 ~15:10 UTC. Status: **first draft, proposed**. Step 1 of conductor.aws.a's plan (docs/team/plan-vault-deploy.md on work/conductor.aws.a, ea9f61d), from Dinis's word relayed by maestro.a (~14:55 UTC): a page to deploy the Vault into a customer's account, "literally as simple as possible", ending with DNS and a working deployment in the chosen region. For architect.aws.a and boto3.aws.a (with me on this step), cloudformation.aws.a (step 2 builds from it), iam.aws.a (step 3), dev.1.aws.a (step 4, the twin). Twin first; nothing here touches AWS.

## 0. Sources, and what is not known

Stated by sgit.ai (site v0.7.87; [self-hosting](https://sgit.ai/docs/self-host-for-agents.html), tested there on 8 Oct 2026 with sgraph-ai-app-send 0.33.0):

- The server is one process (API and vault UI) in the image `diniscruz/sg-send-vault:v0.33.0` (amd64 and arm64, about 90 MB, port 8080), or `pip install sgraph-ai-app-send`.
- Four settings: `SGRAPH_SEND__ACCESS_TOKEN` (gates every route, reads included; header `x-sgraph-access-token`; 401 without it), `SEND__STORAGE_MODE` (`disk`, `s3`, `memory`), `SEND__DISK_PATH`, `SEND__S3_BUCKET` ("for `s3` mode, with the usual AWS credentials. Needed for more than one replica").
- Health: `GET /api/info/health` with the token answers `{"status":"ok"}`.
- Lambda runs "the same FastAPI app ... with the web adapter", with `s3` storage "because Lambda has no disk that lasts"; it scales to zero.
- Servers do not replicate to each other: a second region is a second Vault, and a client pushes to both.
- "The deployment docs have CloudFormation templates for Lambda, Fargate and EC2, marked as written and lint-clean with live validation in progress", each with a public endpoint (a Function URL, a load balancer, or an instance with its own certificate).

**Not known (each a question in section 8):** those templates themselves (they sit in an encrypted deploy vault behind sgit.ai/deploy/, readable only in a browser with its key); how the Lambda is packaged (image or zip, which registry); the CORS setting; the exact S3 actions the server uses. Facts about AWS below are AWS's documented behaviour; boto3.aws.a checks each against AWS's documentation before cloudformation.aws.a builds on it (marked *check*).

## 1. The shape, recommended

```
customer's account, chosen region (stack sws-vault-<id>)            us-east-1 (stack sws-vault-<id>-edge, only with a domain)
  S3 bucket  <--  Lambda (SG/Send, s3 mode)  <--  Function URL        ACM certificate for the domain
  Secrets Manager secret (the access token)            ^
                                                       |
  CloudFront distribution (*.cloudfront.net) ----------+   /health answered by a CloudFront Function
  Route 53 alias --> the same distribution (phase 2, with a domain)
```

**Lambda, not Fargate or EC2, first.** It scales to zero (a Vault nobody uses costs almost nothing, which also suits ephemeral deployments, plan step 11), has no instance to patch, and sgit.ai names it as a target with `s3` storage. Fargate needs a load balancer that is billed by the hour; EC2 is plan step 10, the second path.

**Two phases, so the customer has a working Vault before any DNS:**

1. **Deploy** (stack `sws-vault-<id>`, the chosen region): bucket, secret, function, Function URL, and a CloudFront distribution in front of it on its own `*.cloudfront.net` address, which also answers `/health` (section 4a). The output is that address. A customer can stop here.
2. **Domain** (stack `sws-vault-<id>-edge` in us-east-1, then an update of the first): certificate, the domain on the same distribution, DNS. CloudFront takes certificates from us-east-1 only (confirmed (boto3.aws.a, docs/boto3/2026-11-23__08-vault-deploy-design-check.md, ef27841 on work/boto3.aws.a)), so the certificate is its own small stack; that one stack creates resources in one region is not stated by AWS as a sentence, and `Fn::GetStackOutput` may read the edge stack's certificate ARN across regions (untested), which would save the manual update. A Function URL is a fixed generated endpoint (AWS's documentation; it names no custom-domain option), which is why CloudFront sits in front.

## 2. What the customer's account holds

**Names:** every resource is named `sws-vault-<id>-<part>` (for example `sws-vault-<id>-data` for the bucket, `sws-vault-<id>-api` for the function) and tagged with the Vault id, matching iam.aws.a's step 3 draft (docs/iam/vault-deploy/01-least-privilege.md, e145f1e on work/iam.aws.a): its deploy role is scoped to those names and tags. The stacks are `sws-vault-<id>` and `sws-vault-<id>-edge`. `<id>` matches `^[a-z0-9]{4,16}$` (design 05's check) and is chosen by the page, not by the customer, so two Vaults in one account never collide; the longest bucket name, `sws-vault-<id>-data`, is then 31 characters, inside S3's 3 to 63 lowercase letters, digits and hyphens.

**One bucket.** Append lanes are not a separate store: sgit.ai puts them at `bare/append/{token}/` inside the vault's own `bare/` tree, outside the commit tree but in the same storage, so `SEND__S3_BUCKET` is the only bucket.

| Resource | Stack | Settings |
|---|---|---|
| S3 bucket | vault | Block Public Access on (all four), default encryption, versioning on (a vault's objects are its memory: sgit.ai says "back it up"), no bucket policy beyond denying non-TLS requests, `DeletionPolicy: Retain`, settled with cloudformation.aws.a (template 0.3.1, cc6fc6a), security.aws.a and iam.aws.a: the deploy role holds no `s3:DeleteBucket` at all, and the template documents an explicit empty-and-delete step for the customer, so a removed Vault leaves neither lost data nor a forgotten bucket |
| Secrets Manager secret | vault | Always made by the stack (bringing your own secret is out of v1, at security.aws.a's request, template 0.3.1). The access token, generated by CloudFormation (`GenerateSecretString`, *check*), never typed, never shown to our page or to any agent; the customer reads it once in their own console |
| IAM role for the function | vault | The S3 actions the server needs on this bucket only (list to settle from the source, section 8), read on this one secret, and logs; nothing else. iam.aws.a owns the policy (step 3) |
| Lambda function | vault | SG/Send with the web adapter; `SEND__STORAGE_MODE=s3`, `SEND__S3_BUCKET=<bucket>`, the token from the secret; architecture arm64 (the image is published for it) |
| Function URL | vault | Auth type NONE at the AWS layer: the server's own token gates every route. Its resource policy must grant both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` (required for new Function URLs, (boto3.aws.a, docs/boto3/2026-11-23__08-vault-deploy-design-check.md, ef27841 on work/boto3.aws.a)). Locking it to CloudFront (origin access control) needs auth type AWS_IAM and a client-computed `x-amz-content-sha256` on every POST and PUT, which sgit and browser clients do not send: not in v1 |
| CloudWatch log group | vault | Retention set (not "never expire"); retention period a decision for the customer, default proposed 30 days |
| ACM certificate | vault-edge | DNS validated; automatic when the domain's hosted zone is in this account (confirmed). With DNS elsewhere the stack waits in CREATE_IN_PROGRESS until the customer creates the validation record (AWS documents no timeout), and AWS documents `HostedZoneId` as required for public certificates in this resource, so the "DNS elsewhere" variant is still to confirm |
| CloudFront distribution | vault | Origin: the Function URL; HTTPS only; caching off for `/api/*` except `-imm-` objects, which the API marks immutable (design 02); `/health` answered by a CloudFront Function (section 4a); the custom domain added as alternate name in phase 2 |
| CloudFront Function | vault | `sws-vault-<id>-health`: answers `/health` only (section 4a) |
| Route 53 records | vault (update) | Alias A and AAAA to the distribution, only when the hosted zone is in this account |

Outputs of `vault`: `Endpoint` (the domain if set, else the CloudFront address), `HealthCheck` (the endpoint plus `/api/info/health`), `TokenSecretArn` (the ARN, never the value), `BucketName`, and, when DNS is elsewhere, `DnsRecords` (the CNAME for the domain only: the certificate resource exposes no attribute for its validation record, so the customer reads that one in the ACM console in us-east-1, confirmed (boto3.aws.a, docs/boto3/2026-11-23__08-vault-deploy-design-check.md, ef27841 on work/boto3.aws.a)).

## 3. Inputs: the fewest that work

| Input | Needed for | Default |
|---|---|---|
| Region | phase 1 | the customer's nearest; the page offers the regions that have been tested |
| Domain (for example `vault.example.com`) | phase 2 only | none: phase 2 is optional |
| Where the domain's DNS lives | phase 2 | Route 53 in this account if a hosted zone for it is found, else "elsewhere" (then the page shows the two records to create) |

The **account id** is not an input to the stack: the customer deploys in whatever account their console session is in, and the page only displays it back to them so they see where it is going ("is this the right account?"). This follows the plan's D3 recommendation: the customer's own console session and a one-click stack link, so no credential ever reaches the page.

## 4. The flow the page drives (input to plan steps 5 and 6)

1. **Region.** The page builds a CloudFormation quick-create link for the `vault` template in that region. Its `templateURL` must be an Amazon S3 URL, not any HTTPS address (confirmed (boto3.aws.a, docs/boto3/2026-11-23__08-vault-deploy-design-check.md, ef27841 on work/boto3.aws.a)), so each published template version lives at its own S3 object, never overwritten.
2. **Deploy.** The customer opens it in their own console, reads what will be created, confirms. Minutes later: the endpoint and the health check.
3. **Check.** The page asks the customer to paste the endpoint (never the token) and shows whether it is reachable; the token check is done by the customer with sgit or the vault UI sign-in.
4. **Domain (optional).** A second quick-create link for `vault-edge` in us-east-1, then an update of `vault` with the certificate ARN.
5. **DNS.** Automatic with Route 53 in the account; otherwise the page shows the records and waits until the domain answers the health check.

Five steps, two of them optional: matches the plan's "at most five".

## 4a. `/health`: proof the page can read (iam.aws.a's progress design, 68f4b8b on work/iam.aws.a)

The page has no credential in the customer's account, so at the end it proves the deployment from outside: `GET https://<domain or CloudFront address>/health` answers, with CORS for the deploy page's origin only,

```json
{ "vault_id": "<id>", "template_version": "<version>" }
```

- **Not the SG/Send server.** Its own health route (`/api/info/health`) needs the access token and returns neither field, and the server is not ours to change. So `/health` is a **CloudFront Function** on the viewer request for that one path: it returns this fixed JSON and the CORS headers and never reaches the function or the bucket. CloudFront Functions can return a response themselves on the viewer request, with the code inline in the template (`FunctionCode`, runtime `cloudfront-js-2.0`, 10 KB at most), confirmed (boto3.aws.a, docs/boto3/2026-11-23__08-vault-deploy-design-check.md, ef27841 on work/boto3.aws.a). This is why CloudFront is in phase 1: it gives the Vault a stable address and `/health` even without a domain.
- **`template_sha256`.** A file cannot contain its own hash. The template carries a constant `TemplateVersion`; the published file's sha256 is in the deploy page's own index of published templates (one immutable URL per version, iam.aws.a's pinned-template section). The JSON carries `template_version` only, and the page takes the sha256 from its index, never from the answer (agreed with iam.aws.a; architect.aws.a's design 05 section 4, 2b95ddc on work/architect.aws.a.s2, checks `vault_id` and `template_version` and treats anything else as not-a-vault or mismatch).
- **CORS:** `Access-Control-Allow-Origin` is the deploy page's exact origin (a template parameter with the published default), never `*`; `GET` only; no credentials. The vault routes' own CORS stay the server's (not stated on sgit.ai; section 8).
- **What it proves:** that this address runs a stack made from that template version with that Vault id. Not that the Vault works: the customer's own check with the token (section 4, step 3) does that. Nor that nothing was tampered with: anyone controlling the account can make `/health` say anything, so it catches a wrong or stale link, not tampering (security.aws.a, via iam.aws.a). Agreed with iam.aws.a: `template_version` only, the sha256 looked up by the page; its deploy role is scoped to `function/sws-vault-<id>-health`.

## 5. The twin (plan step 4)

The twin's "customer account" needs, for this design: CloudFormation create and update of the two stacks with their events (the page shows progress from them), the resources of section 2 as Cloud Control reads, a CloudFront address in front of a Function URL host that answers `/api/info/health` with 401 without the token and `{"status":"ok"}` with it, `/health` with section 4a's JSON and CORS for the deploy page's origin, and DNS that "goes live" at the end. The vault routes behind that endpoint are the vault twin of design 02, so the worked example (docs/vaults/example/) can run against a twin customer's Vault unchanged. Agreed by architect.aws.a (15:00 UTC, carried in docs/team/handover/architect.aws.a.md): the twin's router maps the customer's Function URL host (later its custom domain) to the vault service twin, answering from that customer account's own world (one journal per account); the batch route stays 501 until the SG/Send library source is in hand.

## 6. Security notes (for security.aws.a and iam.aws.a)

1. The token lives only in the customer's Secrets Manager and the customer's own clients. Our page, our agents and our logs never see it. If it goes into the function as an environment variable (the server reads `SGRAPH_SEND__ACCESS_TOKEN`), it is visible to anyone who can read the function's configuration in that account: iam.aws.a weighed it (02-deploy-role.md, 339295f on work/iam.aws.a): recommended that the server read the secret at start-up (the function's role holds GetSecretValue on that one secret, the deploy role never does); a dynamic reference resolves into the function's configuration and needs GetSecretValue on the deploy role. That is a change in the server, so it is question 3 below for its owners; until then v1 uses the dynamic reference.
2. The Function URL is public. The server's token gates every route, but anything public is scanned (the twin's attack pack shows the pattern). CloudFront adds a place for rate limiting or AWS WAF later; not in v1, to keep it simple and cheap. The Function URL stays reachable directly as well as through CloudFront; restricting it to CloudFront only needs auth type AWS_IAM and a signed body hash that sgit and browser clients do not send (see the Function URL row), so it waits for a server or client change.
3. Deleting a customer's data is never a side effect: the bucket is retained when the stack goes, and removing it is the customer's explicit, documented step.
4. The image is pulled from a public registry by tag. Pin it by digest in the template, so a re-pushed tag cannot change what a customer runs.

## 7. Regions and ephemeral deployments

One Vault per region; sgit.ai says servers do not replicate, so "moving a Vault across regions" (plan step 11) is: deploy in the new region, `sgit push` every vault to it, switch DNS, then delete the old stack (its bucket kept or emptied by an explicit step). A vault's data is encrypted client-side, so the copy can go through any client that holds the vault key, and the server never sees plaintext. Lambda container images come from Amazon ECR in the same region as the function (confirmed (boto3.aws.a, ef27841)), so a multi-region service needs the image in each region; how sgit.ai's Lambda template solves this is in the deploy vault (section 8).

## 8. Questions

For maestro.c or Dinis (via pm.aws.a's batch, they block step 2):

1. **The official deploy templates.** The Lambda, Fargate and EC2 templates exist in sgit.ai's encrypted deploy vault. May cloudformation.aws.a and I read them (the vault's key, or a copy in a repository), so step 2 starts from them rather than writing a second set? Recommendation: yes, and build from the Lambda template.
2. **The server's source** (SGraph-AI__App__Send), read only: the exact S3 actions (for the least-privilege role and the boundary), the CORS setting, how the Lambda is packaged. Same ask as decision 8 on pm.aws.a's page.
3. **For the server's owners** (via maestro.c): can the server read its access token from Secrets Manager at start-up (a secret ARN in an environment variable) instead of `SGRAPH_SEND__ACCESS_TOKEN` in plain configuration?
4. **Where the image comes from on Lambda** (cloudformation.aws.a's O1 and O2, docs/cloudformation/2026-11-23__vault-stack-01.md, 42677c7). sgit.ai publishes the image on Docker Hub; Lambda runs container images from Amazon ECR in its own region only and cannot use an ECR pull-through cache (confirmed (boto3.aws.a, ef27841)), and sgit.ai does not say whether the image runs on Lambda as it is or needs the web adapter added. Options: (a) follow the official Lambda template (blocked on question 1); (b) an ECR repository per region in an account we run, which customers' functions pull from across accounts (allowed with a repository policy; cross-Region replication fills one repository per region, confirmed (boto3.aws.a, ef27841)), with a copy step per release; (c) the customer's own ECR, filled by a step the customer runs. Recommendation: (a); if refused, (b), as it keeps the customer's steps to the five of section 4. iam.aws.a needs the answer for the function role.

boto3.aws.a checked the *check* items (docs/boto3/2026-11-23__08-vault-deploy-design-check.md, ef27841); still to check: `GenerateSecretString` and the DNS-elsewhere certificate variant. For architect.aws.a: whether the vault twin (design 02) becomes the "customer Vault" of plan step 4. For billing.aws.a (plan step 8): an idle Vault's cost per region (Secrets Manager, CloudFront, logs, S3) and per ephemeral hour.
