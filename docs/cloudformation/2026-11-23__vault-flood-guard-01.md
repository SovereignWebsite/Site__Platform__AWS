# Flood guard for the Vault stack (R-026): WAF option drafted, budget kill switch sketched

Written by cloudformation.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~20:05 UTC. Inputs:
- security.aws.a's R-026 (Medium);
- billing.aws.a's flood model (land/billing.aws.a ddddb44): CloudFront bills every request, and reserved concurrency caps only the Lambda's cost;
- iam.aws.a's WAF proposal (docs/iam/vault-deploy/02-deploy-role.md).

Status: **draft for review**, all off by default until Dinis decides.

## The constraint that shapes it

A WAF web ACL for CloudFront (scope `CLOUDFRONT`) has to be created in us-east-1, as a CloudFront certificate does. One CloudFormation stack creates resources in one region, so the web ACL cannot live in `sws-vault-<id>` when that stack is in London.

This is from memory and the ARN form is marked CHECK in the template: boto3.aws.a to confirm both.

## (a) WAF rate limit: drafted (vault 0.5.0, vault-edge 0.4.0)

- **`vault-edge.yaml`** is now "everything CloudFront takes from us-east-1":
  - the certificate is optional (`DomainName` may be empty);
  - new `EnableRateLimit` (default `false`) and `RateLimit` (default 1000 requests per address per 5 minutes, minimum marked CHECK) create `sws-vault-<id>-waf`: a web ACL that allows by default, with one rate-based rule that blocks any single address above the limit;
  - output `WebAclArn`.
- **`vault.yaml`** takes an optional `WebAclArn`, checked to be a `sws-vault-<id>-waf` ARN in us-east-1, and sets the distribution's `WebACLId`.
- **The cost to the one-button path:** turning the limit on means running `-edge` first, even without a domain. That is one more launch, in us-east-1. Dinis should see this next to the price.
- **What it does not do:** a per-address limit stops one noisy source. It does not stop a flood spread over many addresses.
  - billing.aws.a prices WAF itself.
  - boto3.aws.a checks whether requests WAF blocks still carry CloudFront's request charge.
- **iam.aws.a's deploy role** (access-stack mode) needs `wafv2` create, update and delete on `sws-vault-<id>-waf` in `-edge`, plus `cloudfront:UpdateDistribution` with `wafv2:GetWebACL`/`AssociateWebACL` as CloudFormation's handlers require. To be checked with `check_handlers.py`.

## (b) Budget alert that disables the distribution: sketched, not drafted

security.aws.a asked for `AWS::Budgets::Budget` plus an action role scoped to `UpdateDistribution` on this distribution. Two things stand in the way, both from memory and to be confirmed by boto3.aws.a before anyone builds on them:

1. **Budget actions cannot call CloudFront.** As I understand AWS Budgets, an action can apply an IAM policy, apply an SCP, or run an SSM document that stops EC2 or RDS instances. None of these disables a distribution, and an IAM policy has no effect on anonymous CloudFront traffic.
   - So (b) needs a budget notification to SNS, then a small Lambda, holding `cloudfront:GetDistributionConfig` and `UpdateDistribution` on this distribution only, that sets `Enabled: false`.
   - That is custom code in the customer's account: the template would no longer be "no custom code" in spirit, though it is not a custom resource.
2. **Budget data is not real time.** Cost data reaches Budgets with a delay of hours. At billing.aws.a's flood rate, that delay is the expensive part.
   - A faster trigger is a CloudWatch alarm on the distribution's request count. CloudFront metrics live in us-east-1, so the alarm and its Lambda would go in `-edge`.

If Dinis wants (b), I would draft it as **CloudWatch alarm → SNS → one small Lambda in `-edge`**, with an optional budget alert as a second, slower trigger that only notifies. The Lambda and its role would follow the same rules as the server's: named `sws-vault-<id>-*`, bounded, and no wildcard resources.

## (c) Kill switch on the deploy page; (d) say it plainly

These are for the page (dev.2.aws.a, ux.aws.a). Under D3 the page holds no credential in the customer's account, so its kill switch can only be a link: a pre-filled stack update that sets `Enabled: false`, or a console link to the distribution. Nothing the page does on its own.

## Recommendation

For v1: (d) always. (a) as an option, since it is cheap to offer and already drafted. (c) as a link.

(b) only if Dinis wants spend protection without the customer watching. Then build the alarm-and-Lambda form, not a budget action, which as I understand it cannot do the job.

The checks pass on both templates: cfn-lint, and `test_vault_template.py`, which now also checks that the rate limit is off by default, the web ACL's scope and name, and that `WebAclArn` is optional.
