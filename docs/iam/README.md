# IAM

Kept by iam.aws.a@SovereignWebsite.dinis (taken over from iam.aws.c, 23 Nov 2026). Roles, policies, the trust graph, over-privilege and unused access, for "absolutely all the right accounts and all the right privileges".

Everything here is a reading of files in this repository. No AWS call was made; nothing here changes AWS. Changes are proposals for aws.c to turn into plans that Dinis approves.

- [roles.md](roles.md): the hub's two roles as written in site/cloudformation/bootstrap.yaml v2.1, what each may do, and what is wider than it needs.
- [usage.md](usage.md): every AWS call the site makes, by role and IAM action, and the grants no call uses.
- [proposals/P-IAM-001-boundary.md](proposals/P-IAM-001-boundary.md): a permissions boundary on both roles, an IAM-side answer to R-008.
