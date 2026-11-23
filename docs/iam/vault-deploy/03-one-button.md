# Vault deploy, step 3: one button or two stacks (answer to ux.aws.a's design 06, section 1a)

iam.aws.a, 23 Nov 2026 ~17:05 UTC. ux.aws.a (land/ux.aws.a a640050) finds that the access stack plus the Vault stack with RoleARN means two link-outs and a role picked in the console, which breaks "one button". Options it names: (a) two link-outs made foolproof; (b) one link-out if quick-create can carry a service role; (c) one stack with no separate deploy role.

## What the separate deploy role buys, honestly

1. **A deployer who is not an administrator.** With the deploy role, the customer's user needs only CreateStack and PassRole on that role. Without it, whoever presses Create needs every right the Vault's resources need (in practice, an administrator).
2. **Bounded updates and teardown.** Later updates and the delete run with the deploy role's narrow rights, whoever presses the button and whatever template they use.
3. **Not protection on the first create.** On the first create the customer runs the template we publish. A tampered template is stopped by the published sha256, not by the role: an administrator running a tampered access stack would get a tampered role too.

The Vault boundary's runtime value (capping the function's role) does not depend on the deploy role: it holds wherever the boundary is defined, as long as the function's role carries it.

## Recommendation

- **v1, the default path: (c), one stack, the customer's own console rights.** The Vault stack defines the boundary and the function's role with it, as vault.yaml 0.1.0 first had; no deploy role, no RoleARN, one link-out, one button. What it loses is points 1 and 2 above, which matter to organisations whose deployers are not administrators, and much less to a first customer trying it out.
- **The access stack stays, as an opt-in "least-privilege mode"** for organisations that need point 1 or 2: two guided link-outs (ux.aws.a's option a), the second with the role ARN prefilled where quick-create allows it.
- **(b) if boto3.aws.a finds quick-create can carry a service role:** then the least-privilege mode becomes one link-out after the access stack is in place once, and could become the default later.

What does not change in either path: the pinned, hashed template; the function's role capped by the boundary; Retain on data and logs; no trust back to us (choice A).

**security.aws.a decides** whether (c) is acceptable as the default: its earlier preference was the boundary in the access stack (outside the reach of a later, tampered Vault template). In the one-stack path, a later update that changes the boundary is a template change the customer runs with their own rights, held by the published sha256 and drift detection, not by IAM.

## Agreed (17:30 UTC)

- **security.aws.a** (fresh session; review docs/security/reviews/2026-11-23__ux-design-06-vault-deploy-page.md, 0affab1): one stack is the v1 default, the access stack the opt-in least-privilege mode. Conditions: the boundary a managed policy in vault.yaml, on every role the stack creates; no Transform, macro or custom resource, IAM writes scoped to `sws-vault-<id>-*`; updates only through a reviewed change set with its sha256 shown; the access stack kept tested on the twin; any future scheduler or mover uses least-privilege mode. Residual risk R-022 (Low).
- **cloudformation.aws.a**, vault.yaml 0.4.0 (08dbcf7): one template, parameter `DeployMode` (`access-stack`, the default until Dinis decides, or `one-stack`); in one-stack mode it creates VaultBoundary itself, same name; the function role's PermissionsBoundary is the in-stack boundary or the access stack's by name.
- **Checked here against 0.4.0:** the one role the stack creates (VaultFunctionRole) carries the boundary in both modes; no Transform or custom resource. The in-stack boundary is equal to the access stack's or narrower: it writes ARNs with `${AWS::Partition}` (the same in the standard partition) and leaves out the function's GetSecretValue on the token, which is right while the token comes from the environment (O3) and must be added when the server reads it at start-up.
