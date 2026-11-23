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

## Update (20:20 UTC): the cost alarm drafted; WAF stays off

billing.aws.a's pricing (cfe70fb) finds that WAF **adds** cost rather than capping it: about +$21.6/h at 10,000 req/s. billing.aws.a recommends a request alarm as the guard. So `vault-edge.yaml` 0.5.0 adds an optional cost alarm, and WAF stays in the template but off by default.

**The new parameters:**
- `DistributionId`: from the Vault stack's output, added by a stack update once the Vault exists.
- `RequestAlarmThreshold`: requests per 5 minutes; 0 means no alarm. The customer chooses it, and the page can suggest one from billing.aws.a's model.
- `AlertEmail`: optional. AWS sends a confirmation first.

**The new resources:**
- `sws-vault-<id>-requests`: an `AWS::CloudWatch::Alarm` on `AWS/CloudFront` `Requests`, Sum over 300 s, with dimensions `DistributionId` and `Region=Global`. The namespace, metric and dimensions are marked CHECK, for boto3.aws.a.
- `sws-vault-<id>-cost`: an SNS topic with the email subscription, only when an email is given.
- Both names fall under iam.aws.a's grant `alarm:sws-vault-<id>-*` (vault-access 0.2.7). iam.aws.a also needs the `sns` topic `sws-vault-<id>-cost`.

**Limits:**
- The alarm **notifies**; it does not stop anything. The kill switch is still the deploy page's link, or the alarm-driven Lambda sketched above, which is not built until Dinis picks it.
- CloudFront's request metrics come in near real time, unlike Budgets.

The checks pass: cfn-lint on all templates, plus `test_vault_template.py`, which now also checks that the alarm is optional and that its name and the topic's name are in scope. The email pattern was tested: good addresses and empty are accepted; spaces, a missing dot after `@` and a trailing newline are refused.

## boto3.aws.a's checks (note 15), applied (20:30 UTC, vault 0.5.1, vault-edge 0.5.1)

- **Confirmed:**
  - a CloudFront web ACL must be created in us-east-1;
  - its ARN is `arn:aws:wafv2:us-east-1:<acct>:global/webacl/<name>/<id>`, which matches `WebAclArn`'s pattern; that CHECK is removed.
- **Rate limit:**
  - the minimum is 10 and the maximum 2,000,000,000, so `RateLimit`'s minimum is now 10;
  - the window is not fixed: it is 60, 120, 300 or 600 s, now `RateWindowSec` (default 300).
- **Blocked requests:** whether they are free on pay-as-you-go is **not** confirmed, and WAF also bills per inspected request. So WAF stays off by default, as availability protection only.
- **Budgets:** an action can only apply an IAM policy or SCP or target EC2 or RDS instances, so none can disable a distribution. The data updates up to three times a day. Budgets is therefore rejected as the flood signal, and CloudWatch `Requests` is the fast one.
- **Still CHECK:** the alarm's metric dimensions (`Region=Global`), asked of boto3.aws.a.
- **An automatic disable is a real AWS change in the customer's account.** It is a plan for Dinis and is wired only after ec2.aws.a's design 03.

## vault-edge 0.5.2 (20:40 UTC): security.aws.a on cfae61e

- **New `CostAlarmTopicPolicy`:**
  - `sns:Publish` is allowed only for `cloudwatch.amazonaws.com` with `aws:SourceArn` set to this alarm's ARN;
  - it is denied to anyone else, so "cost" mail cannot be spoofed from inside the account;
  - the alarm's ARN is built from its name, so there is no circular dependency.
- **`AlertEmail`** is typed by the customer in their own console. The deploy page never asks for it, prefills it or stores it; the parameter's description now says so.
- **`AlarmActions`** is only the cost topic (iam.aws.a's condition in vault-access 0.2.9), and the test checks it.
- **For iam.aws.a:** the topic policy needs `sns:SetTopicAttributes` on `sws-vault-<id>-cost`, plus whatever the `AWS::SNS::TopicPolicy` handler lists.
- **For security.aws.a:** cfn-lint and the test run here on every change. A run is in each note, and the test file runs with `pip install cfn-lint`.

**Metric confirmed (20:45 UTC, boto3.aws.a note 16):** `AWS/CloudFront` `Requests`, dimensions `DistributionId` and `Region=Global`, from us-east-1 only, a default metric at no extra charge. The alarm itself bills as a CloudWatch alarm. The last CHECK in the flood guard is cleared.

## The alarm moves to its own stack (20:55 UTC): security.aws.a's R-027

**The problem:** in access-stack mode, `-edge` runs as the deploy role, and that role cannot safely be allowed to create alarms. No IAM key pins an alarm's OK or insufficient-data actions or its metric, and EC2 alarm actions need only a service-linked role.

**What changed:**
- **New `vault/vault-alarm.yaml`** (draft 0.1.0), stack `sws-vault-<id>-alarm` in us-east-1. It holds only the alarm `sws-vault-<id>-requests`, the optional email topic `sws-vault-<id>-cost` and its publish-only-by-this-alarm policy.
- **Always run with the customer's own console identity, in both modes, never with the deploy role.** It is run after the Vault stack exists, since it needs `DistributionId`, so it was already a separate step. Its threshold is now required (at least 1); the stack itself is the opt-in.
- **`vault-edge.yaml` 0.6.0** no longer holds any alarm or topic. It is back to the certificate and the optional WAF.
- **The test** checks that `-edge` holds no alarm or topic, and that the alarm stack holds only those three resource types. The no-OK and no-insufficient-data actions check and the alarm-actions check stay.

**For iam.aws.a:** the deploy role's alarm and topic rights (vault-access 0.2.7 to 0.2.10) can be removed. Nothing the deploy role runs creates them any more.
