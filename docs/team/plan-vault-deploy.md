# Plan: deploy the Vault into a customer's AWS account, EC2, ephemeral deployments

Owner of this plan: conductor.aws.a, 23 Nov 2026 15:00 UTC. Source: Dinis Cruz's word in maestro.a's session (~14:55 UTC), record PrompTugal__News__Website board/team/maestro.a/decisions/2026-11-23-deploy-the-vault-page-and-ec2.md. Material for every agent; Dinis decides.

## What Dinis asked

1. A dedicated page to deploy the Vault (the Secure Send S3 API) into a customer's AWS account, "literally as simple as possible": account id and a couple of details, log in, run the CloudFormation (or Terraform) stack, pick a domain, end with DNS and a fully configured deployment in the chosen region; "maybe visualization on this". A domain-specific environment.
2. EC2 control in our environment, and EC2 as a second way to deploy the Vault.
3. Ephemeral deployments: start for a couple of hours, destroy; a workflow to move our deployments across regions every day.

## Rules that hold

- Twin first: every step works end to end against the twin before any real account.
- Real AWS changes only as a plan Dinis approves on the site. Nothing creates or destroys real resources on a schedule until Dinis has approved a decision page for it.
- The new site is an IaC request to aws.c and factory.c (maestro.a relays).
- Decisions go to Dinis as one batch with a presentation and a decision video (pm.aws.a).

## Steps and owners

| # | Step | Owner | With |
|---|------|-------|------|
| 1 | Vault deployment design: what the customer's account holds (S3, Lambda, API, CloudFront, Route 53), inputs (account id, region, domain), outputs | vaults.aws.a | architect.aws.a, boto3.aws.a |
| 2 | The stack: CloudFormation template for one Vault, parameters, outputs, drift and teardown; Terraform as an option, not first | cloudformation.aws.a | vaults.aws.a |
| 3 | Least privilege in the customer's account: the deploy role, a boundary, what the page may and may not do; the trust story for the customer | iam.aws.a | security.aws.a |
| 4 | The twin: a "customer account" in the twin that the stack deploys into, with DNS answering at the end | dev.1.aws.a (twin) | architect.aws.a |
| 5 | The page: a wizard of at most five steps (account, sign in, region, domain, deploy), progress from the stack's events | dev.2.aws.a (site/api) and dev.1.aws.a | ux.aws.a |
| 6 | "As simple as possible": walk the wizard as a first-time customer, cut every step that is not needed | sherpa.aws.a | ux.aws.a |
| 7 | Visualisation of the deployment as it happens (resources appearing, DNS going live) | viz.aws.a | ontology.aws.a (graph) |
| 8 | Cost of one Vault per region and per ephemeral hour | billing.aws.a | |
| 9 | Audit trail of a deployment (who deployed what, where) | cloudtrail.aws.a | |
| 10 | EC2: control in our environment and EC2 as a second deploy path | ec2.aws.a (new agent, start prompt in docs/team/handover/ec2.aws.md) | lambda.aws.a, iam.aws.a |
| 11 | Ephemeral deployments and the daily region move: design and twin only until Dinis approves a decision page | ec2.aws.a with cloudformation.aws.a | billing.aws.a, security.aws.a |
| 12 | Security review of every step before it lands | security.aws.a | |
| 13 | User-facing article: deploying a Vault in five steps | journalist.aws.a | video.aws.a |
| 14 | The decision batch for Dinis (presentation and video) | pm.aws.a | video.aws.a |
| 15 | New site request (IaC) to aws.c and factory.c | conductor.aws.a, via maestro.a | |

## Decisions this raises for Dinis (to pm.aws.a's batch)

- D1 Where the deploy page lives: a new site (deploy.<domain>) or a tab of this one.
- D2 CloudFormation first, Terraform later (recommended), or both from the start.
- D3 How the customer signs in to their account: their own console session with a one-click stack link (recommended, no credential ever reaches the page) or a role the page assumes.
- D4 EC2 as a second deploy path: in scope now, or after the CloudFormation path works.
- D5 Ephemeral and daily region moves: the guard rails (maximum lifetime, regions allowed, cost cap, kill switch) before anything runs outside the twin.
- D6 Start a new agent ec2.aws.a.

## Order

Twin first: 1, 2, 3 and 4 together, then 5 and 6, then 7, 8 and 9. EC2 (10, 11) runs alongside once ec2.aws.a starts. pm.aws.a puts D1 to D6 to Dinis once steps 1 to 3 have a first draft.
