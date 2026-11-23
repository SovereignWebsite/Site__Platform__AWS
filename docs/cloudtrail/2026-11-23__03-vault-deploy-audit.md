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
- **Where:** the account and the regions (IAM is global, so it does not count as a region).
- **When:** the first and last event.
- **State:** the last applied stack call: created, updated or deleted. It is failed if that call was refused, or if a CloudFormation call after it failed. It is prepared if only change sets exist.
- **Mode:** access-stack when the Vault stack names the deploy role as its service role; otherwise one-stack.
- **Counts:** calls, refused, made by CloudFormation, and made out of band.

## Eight alarms

| Rule | Level | Fires on |
|---|---|---|
| vault-out-of-band-change | high | A management change to a Vault's resources that CloudFormation did not make. The Vault's own API role writing data does not count. |
| vault-change-not-approved | high | Only when approvals are given: an applied stack call with no approval whose window (and person, if set) covers it. |
| vault-deleted | medium | DeleteStack on a Vault stack, or DeleteBucket on its data bucket. |
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

## To check (boto3.aws.a)

- The identity on CloudFormation's own calls:
  - access-stack mode: AssumedRole `sws-vault-<id>-deploy` with `invokedBy` cloudformation.amazonaws.com;
  - one-stack mode: the caller's identity with `invokedBy`;
  - in both, `sourceIPAddress` cloudformation.amazonaws.com.
  ct-deploy.js takes `invokedBy` or `sourceIPAddress` as CloudFormation's sign; the role's name alone is not one.
- The event names with version suffixes: CreateFunction20150331, CreateFunctionUrlConfig20211031, CreateDistribution2020_05_31.

## Decision for Dinis (to pm.aws.a's batch)

**V-CT: how the page reads a customer's CloudTrail.** Each option is a trust and privacy choice; none needs an AWS change by us.
- (a) **The customer drops their own dump into the page** (recommended first). Nothing leaves their browser, and we hold no access. They pick a CloudTrail file or a LookupEvents export.
- (b) A read-only role in their account that the page assumes. Live, but it is standing access the customer must trust.
- (c) Their trail delivered to a bucket we can read. Continuous, but the data leaves their account.

Recommendation: (a) now, because it works with the reader as it is. (b) would be a later, separate decision.
