# The audit trail of a Vault deployment (Vault deploy plan, step 9)

Written by cloudtrail.aws.a@SovereignWebsite.dinis, 23 Nov 2026 16:45 UTC. Status: **twin-first draft**: code and tests in docs/, no real account, no AWS call. Material for vaults.aws.a, cloudformation.aws.a, iam.aws.a, dev.1.aws.a (twin), dev.2.aws.a and viz.aws.a; Dinis decides.

## The question

Who deployed what, where and when, for each Vault in a customer's account, read from that account's CloudTrail.

## One deployment

- **One deployment is one Vault id**, the 12 hex digits the deploy page makes (vault.yaml 0.4.0, cloudformation.aws.a). Its events are everything that names `sws-vault-<id>`:
  - the stacks `sws-vault-<id>` and, in access-stack mode, `sws-vault-<id>-access` (iam.aws.a's vault-access.yaml);
  - its resources, all named `sws-vault-<id>-*`;
  - the deploy role `sws-vault-<id>-deploy` as the caller.
- **Who deployed:** the identity of the first applied stack call (CreateStack, UpdateStack, ExecuteChangeSet), never CloudFormation itself.
- **Where:** the account and the regions (IAM and CloudFront are global, so they do not count as regions).
- **When:** the first and last event.
- **State:** the last applied stack call: created, updated or deleted. It is failed if that call was refused, or if a CloudFormation call after it failed. It is prepared if only change sets exist.
- **Mode:** access-stack when the Vault stack names the deploy role as its service role; otherwise one-stack.
- **Counts:** calls, refused, made by CloudFormation, and made out of band.

## Eight alarms

| Rule | Level | Fires on |
|---|---|---|
| vault-out-of-band-change | high | A management change to a Vault's resources that CloudFormation did not make. The Vault's own API role writing data does not count. |
| vault-change-not-approved | high | Only when approvals are given: an applied stack call with no approval whose window (and person, if set) covers it. |
| vault-deleted | medium | DeleteStack on a Vault stack, DeleteBucket on its data bucket, or DeleteLogGroup on its log group (vault.yaml 0.4.5 lets the deploy role do this on rollback; it is still the Vault's audit trail going away). |
| vault-deploy-refused | medium | A refused stack call, or a refused CloudFormation call (e.g. stopped by the boundary). |
| vault-deploy-role-outside-cloudformation | high | The role sws-vault-<id>-deploy acting without CloudFormation's sign. It trusts only CloudFormation, so its credentials are loose or its trust was changed. |
| vault-root-activity | high | The account root acting on any Vault resource, reads included. |
| vault-direct-change-refused | medium | A refused direct change to a Vault's resources. |
| vault-token-read | medium | GetSecretValue on sws-vault-<id>-token, or GetFunction / GetFunctionConfiguration on its function (the token is in its configuration, O3), by anyone other than CloudFormation or the Vault's API role. |

The four rules after the first four come from security.aws.a's review of 7eda626.

**What counts as CloudFormation:** a call with CloudFormation's sign (`invokedBy`, or `sourceIPAddress` cloudformation.amazonaws.com). The deploy role's name alone is not enough. In access-stack mode (the Vault stack was given the deploy role), the Vault stack's calls must also run as that role; only the access stack's own two resources (the deploy role and its boundary) may be made as the customer.

**Stated limit:** in one-stack mode, a call that another stack makes on this Vault's resources looks the same as one by the Vault's own stack. The trail does not carry the stack's name on those calls.

The platform alarms (ct-alarms.js) still run on the same events. Example: a change to a Vault from a new network also raises new-network.

## Files

- `docs/cloudtrail/reader/ct-deploy.js`: `group(events)` and `alarms(deployments, { approvals })` over the reader's events.
- `docs/cloudtrail/scenarios/vault-deploy.js`: the twin-first scenario. It gives the records one access-stack deployment leaves, with options for out of band, refused and teardown. dev.1.aws.a uses it as the expected output: the twin derives its customer account's trail from its journal, and a test compares the two (step 4).
- `docs/cloudtrail/reader/ct-deploy.test.mjs`: 37 cases (run: `node docs/cloudtrail/reader/ct-deploy.test.mjs`).

## Checked by boto3.aws.a (note 09 addendum, work/boto3.aws.a b2a8e2c; AWS's pages, 23 Nov 2026)

- **Identity on CloudFormation's own calls.** All three points are consistent with AWS's pages, but no page shows a CloudFormation example; confirm them on the first real trail.
  - With the deploy role: AssumedRole of that role, with `invokedBy`.
  - Without a role (one-stack mode): the caller, with `invokedBy`.
  - `sourceIPAddress`: the service's DNS name.
- **Event names:**
  - CreateFunction20150331: confirmed.
  - CreateFunctionUrlConfig: no suffix; corrected in the scenario.
  - CloudFront: CreateDistributionWithTags when tags are passed, as vault.yaml does, in us-east-1; to confirm. Corrected in the scenario. CloudFront, like IAM, is global, so it does not count as a deployment's region.

## The Vault templates bucket (ct-alarms.js rule vault-templates-bucket)

Asked by cloudformation.aws.a at security.aws.a's request (16:53 UTC). It covers `sws-vault-templates-<account>-<region>`, the Object Lock bucket in templates-bucket.yaml (316ce63 on work/cloudformation.aws.a). It is high and fires on:
- the account root as caller on any PutBucket* or DeleteBucket* call for that bucket, refused attempts included;
- PutObjectRetention or PutObjectLegalHold by anyone. The publishing role is allowed these calls, so a planned use will fire too; that is meant, because every change to a template's lock should be seen.

Two more rules, from security.aws.a (17:26 UTC):
- **vault-templates-write** (high): a PutObject, CopyObject or CompleteMultipartUpload anywhere in the bucket by any principal other than the publishing role, refused attempts included.
- **vault-templates-published** (low, a notice): a successful write under templates/ by the publishing role, so every release is seen.

The publishing role is the stack's PublisherRoleArn. ct-alarms.js takes it as `run(events, { templatesPublisher })`, an ARN or a role name, with "sws-vault-templates-publisher" as the default.

PutObject, PutObjectRetention and PutObjectLegalHold are S3 data events, so the trail must log data events for this bucket or these rules never see them (*to check* with boto3.aws.a: which events and selectors).

Drafted as EventBridge patterns for aws.c to plan (*to check*; no AWS change without Dinis's yes):

```json
{ "source": ["aws.s3"], "detail-type": ["AWS API Call via CloudTrail"],
  "detail": { "eventSource": ["s3.amazonaws.com"], "userIdentity": { "type": ["Root"] },
              "eventName": [{ "prefix": "PutBucket" }, { "prefix": "DeleteBucket" }],
              "requestParameters": { "bucketName": [{ "prefix": "sws-vault-templates-" }] } } }
```

```json
{ "source": ["aws.s3"], "detail-type": ["AWS API Call via CloudTrail"],
  "detail": { "eventSource": ["s3.amazonaws.com"], "eventName": ["PutObjectRetention", "PutObjectLegalHold"],
              "requestParameters": { "bucketName": [{ "prefix": "sws-vault-templates-" }] } } }
```

## Decision for Dinis (to pm.aws.a's batch)

**V-CT: how the page reads a customer's CloudTrail.** Each option is a trust and privacy choice; none needs an AWS change by us.
- (a) **The customer drops their own dump into the page** (recommended first). Nothing leaves their browser, and we hold no access. They pick a CloudTrail file or a LookupEvents export.
- (b) A read-only role in their account that the page assumes. Live, but it is standing access the customer must trust.
- (c) Their trail delivered to a bucket we can read. Continuous, but the data leaves their account.

Recommendation: (a) now, because it works with the reader as it is. (b) would be a later, separate decision.
