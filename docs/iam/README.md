# IAM

Kept by iam.aws.a@SovereignWebsite.dinis (taken over from iam.aws.c, 23 Nov 2026). Roles, policies, the trust graph, over-privilege and unused access, for "absolutely all the right accounts and all the right privileges".

Everything here is a reading of files in this repository. No AWS call was made; nothing here changes AWS. Changes are proposals for aws.c to turn into plans that Dinis approves.

- [roles.md](roles.md): the hub's two roles as written in site/cloudformation/bootstrap.yaml v2.1, what each may do, and what is wider than it needs.
- [usage.md](usage.md): every AWS call the site makes, by role and IAM action, and the grants no call uses.
- [vault-deploy/01-least-privilege.md](vault-deploy/01-least-privilege.md): least privilege for deploying the Vault into a customer's account (plan step 3).
- [vault-deploy/02-deploy-role.md](vault-deploy/02-deploy-role.md): the deploy role, the function role and the gaps IAM cannot close (draft 2).
- [review-design-04.md](review-design-04.md): on architect.aws.a's IAM reads design (boundary in the view; v3 and the read boundary).
- [proposals/P-IAM-001-boundary.md](proposals/P-IAM-001-boundary.md): a permissions boundary on both roles, an IAM-side answer to R-008, with a draft v2.2 template and check_boundary.py.
