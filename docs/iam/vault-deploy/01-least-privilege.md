# Vault deploy, step 3: least privilege in the customer's account (first draft)

iam.aws.a, 23 Nov 2026 ~15:05 UTC, for docs/team/plan-vault-deploy.md (work/conductor.aws.a ea9f61d), with security.aws.a. Status: **draft for review**. The resource list below is the plan's (S3, Lambda, API, CloudFront, Route 53); vaults.aws.a's step 1 design replaces it when it lands, and every action list here is redrawn from that design's template, not guessed. No AWS call was made.

## The trust story, in one paragraph for the customer

"You run one CloudFormation stack in your own account, from your own AWS console, with your own sign-in. We never see a password, key or token of yours, and our page cannot call your account. The stack makes a deploy role that can create, change and delete only the Vault's own resources, named `sws-vault-<id>-*` and tagged `sws-vault=<id>`, and nothing else. Every role the stack makes for the Vault is capped by a boundary you can read in the template. Deleting the stack deletes everything it made."

## Three choices, and the recommendation (feeds D3)

| | How it works | What the vendor (we) can do in the customer's account | Recommendation |
|---|---|---|---|
| **A. Console quick-create** | The page builds a CloudFormation quick-create link (template URL, parameters filled); the customer opens it in their own console and presses Create. | Nothing. | **First version.** No credential reaches the page; the customer's own rights run the stack. |
| B. Customer's sign-in in the page | The customer signs in to their own identity provider in the page and assumes a role in their account (as this site does for Dinis). | Nothing directly, but our page code runs with the customer's role while they are signed in (R-002's shape, now in someone else's account). | Later, only with the R-002 split (a page with no other code on it) and only for read and teardown. |
| C. Cross-account role trusting our account | The customer's role trusts an AWS account of ours, with an ExternalId. | Whatever that role allows, at any time, until the customer deletes it. | No. It makes us a standing path into every customer account, and a target. |

Under A, progress and "DNS is live" come from outside the account: the page polls the public endpoint (DNS answer, HTTPS on the domain) and the customer pastes the stack's outputs or the page reads them from the quick-create return. No read role is needed. If the plan's progress view (step 5, step 7) needs the stack's events live, that is choice B for reads only, and a decision for Dinis.

## The deploy role (the stack's CloudFormation service role)

Why a service role, even under A: the customer's console user then needs only `cloudformation:CreateStack` and `iam:PassRole` on this one role, not admin; the customer can read in one place everything the deployment can do; and teardown runs with the same narrow rights.

Two stacks, so the role exists before the Vault stack uses it:

1. **Bootstrap stack** (`sws-vault-<id>-access`), created by the customer: the deploy role, the boundary for the Vault's own roles, and nothing else.
2. **Vault stack** (`sws-vault-<id>`), created with `RoleARN` = the deploy role.

Shape of the deploy role's policy (actions to be filled from step 1's template; the scoping is the point):

| Statement | Actions | Scope |
|---|---|---|
| Own stack | cloudformation Create, Update, Delete, Describe on the Vault stack | `stack/sws-vault-<id>/*` |
| Buckets | s3 create, configure, delete the Vault's buckets | `arn:aws:s3:::sws-vault-<id>-*` |
| Functions | lambda create, update, delete, tag | `function:sws-vault-<id>-*` |
| API, CloudFront, certificate | the create, update, delete actions step 1 needs | tag condition `aws:RequestTag/sws-vault` = `<id>` on create, `aws:ResourceTag/sws-vault` = `<id>` on change and delete, where the service supports it |
| DNS | route53 ChangeResourceRecordSets, GetChange | the one hosted zone the customer names, record names under the chosen domain (`route53:ChangeResourceRecordSetsNormalizedRecordNames`) |
| Roles for the Vault | iam CreateRole, DeleteRole, PutRolePolicy, DeleteRolePolicy, AttachRolePolicy, DetachRolePolicy, TagRole | `role/sws-vault-<id>-*`, **only with** `iam:PermissionsBoundary` = the Vault boundary's ARN |
| Pass those roles | iam PassRole | `role/sws-vault-<id>-*`, with `iam:PassedToService` = `lambda.amazonaws.com` (and only the services step 1 needs) |
| Deny | iam Put/DeleteRolePermissionsBoundary, CreatePolicyVersion, SetDefaultPolicyVersion, DeletePolicy on the boundary; CreateUser, CreateAccessKey; any IAM action outside `sws-vault-<id>-*` | `*` |

Lessons carried over from this site's own roles (P-IAM-001, security.aws.a's B1 and B2): no `Resource: "*"` on any write; the boundary cannot be edited, swapped or removed by the role it caps; no PassRole without `iam:PassedToService`; no trust edits to roles outside the Vault.

## The Vault boundary

A customer-managed policy in the bootstrap stack, the most any role the Vault stack creates may ever do: the Vault's runtime needs (its buckets' objects, its own logs), named by step 1. The deploy role can create roles only with this boundary attached, so even a mistaken or tampered Vault template cannot give a Lambda function more than the boundary.

## What the page may and may not do

- May: build the quick-create link; show the template and the deploy role's policy in plain words before the customer clicks; poll the public endpoint and DNS; show the stack's outputs the customer gives it.
- May not: hold, ask for or store any credential of the customer's; call any API in the customer's account (under choice A); create anything on a schedule (steps 10 and 11 stay design and twin until Dinis approves their decision page).

## Open, for the batch (pm.aws.a)

1. D3: choice A for the first version (recommended), B later for reads and teardown, never C.
2. Live progress: public-endpoint polling only (A), or a read-only role in the customer's account (B), which is a second trust ask.
3. Region and domain: whether the customer's hosted zone already exists (the deploy role then edits records in it) or the stack creates one (then the customer delegates the name servers themselves, outside AWS).

## Next

Redraw the action lists from vaults.aws.a's step 1 and cloudformation.aws.a's step 2 template as soon as they exist; a draft bootstrap template with the deploy role and the boundary; check_boundary-style checks that every action the Vault template needs is inside the deploy role, and nothing more. Then security.aws.a's review.
