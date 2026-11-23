# Over-privilege rules v1.1, for Desk

iam.aws.a, 23 Nov 2026 ~20:55 UTC, for ux.aws.a's design 08 (Desk console, land/ux.aws.a 243d735, section 7). The first rules Desk may show. Each has an evidence level and the reads it needs; Desk shows nothing for a rule whose reads it does not have.

## Evidence levels

- **Confirmed:** AWS's own record of use says it (a role's last use, a service's last access). Still "as AWS reports it", with AWS's tracking limits.
- **Claimed:** read from policy text, not evaluated. Design 04 does no policy evaluation in the page, and conditions, permissions boundaries, SCPs and resource policies can narrow what the text grants. Desk words these as "the policy says", never "this role can".

## The reads

The nine of design 04 and P-IAM-001 v2.5's read role: iam ListRoles, GetRole, ListAttachedRolePolicies, ListRolePolicies, GetRolePolicy, GetPolicy, GetPolicyVersion, ListOpenIDConnectProviders, GetOpenIDConnectProvider. Rule U2 needs two more (step 2, below).

## Rules

Service-linked roles (path `/aws-service-role/`) are shown grouped as "AWS manages these" and never flagged.

| Id | Rule | Evidence | Reads |
|---|---|---|---|
| U1 | **Unused role:** GetRole's RoleLastUsed has no date, or a date more than 90 days ago | Confirmed (AWS's last-used record, kept for about 400 days and possibly lagging: "never used" means "not in that window") | ListRoles, GetRole |
| W1 | **Anything on anything:** an identity policy (inline or customer-managed attached) has an Allow with Action `*` and Resource `*`, or an Allow with NotAction (it grants everything not listed) | Claimed | ListRolePolicies, GetRolePolicy, ListAttachedRolePolicies, GetPolicy, GetPolicyVersion |
| W2 | **A whole service on anything:** an Allow with Action `<service>:*` and Resource `*`, or with NotResource | Claimed | as W1 |
| W3 | **Admin by AWS policy:** AWS managed AdministratorAccess, PowerUserAccess or IAMFullAccess attached | Claimed (attachment is a fact; what it allows after boundaries is not evaluated) | ListAttachedRolePolicies |
| E1 | **A way to more rights:** an Allow on Resource `*` (or with NotAction or NotResource), matching wildcards as AWS does (`iam:*`, `iam:Put*`, `iam:*Policy*`), for: iam:CreateRole, Put/AttachRolePolicy, Put/AttachUserPolicy, Put/AttachGroupPolicy, AddUserToGroup, CreateAccessKey, CreateLoginProfile, UpdateLoginProfile, CreatePolicyVersion, SetDefaultPolicyVersion, UpdateAssumeRolePolicy, Put/DeleteRolePermissionsBoundary; or sts:AssumeRole on `*`. **iam:PassRole** is an E1 finding only with a service that runs code as the passed role in the same policies (lambda:CreateFunction or UpdateFunctionCode, ec2:RunInstances, cloudformation:CreateStack, glue:CreateJob, ecs:RunTask); alone it is information. A permissions boundary does not exempt the role: Desk shows "a boundary is present, not evaluated" beside the finding | Claimed | as W1, plus GetRole (PermissionsBoundary) |
| T1 | **Anyone may become it:** a trust statement with Principal `*` or `{"AWS": "*"}` and no condition that pins the caller (aws:PrincipalAccount, aws:PrincipalOrgID, aws:SourceArn or aws:SourceAccount); aws:SourceIp alone does not pin it | Claimed (from the trust text) | GetRole |
| T2 | **Any repository may become it:** a trust on GitHub's OIDC provider with no `token.actions.githubusercontent.com:sub` condition; a sub of `*` or `repo:*`; or an owner prefix without its slash (`repo:org*` also matches `org-evil`). A wildcard sub under StringEquals matches nothing: flagged as a mistake. `repo:org/name:*` (any branch or environment of one repository) is information, not a finding. Also checked: `aud` is `sts.amazonaws.com` | Claimed | GetRole, ListOpenIDConnectProviders, GetOpenIDConnectProvider |
| T3 | **Any app may become it:** a trust on an OIDC provider (Google included) with no `aud` condition | Claimed | as T2 |
| T4 | **A third party without ExternalId:** a trust naming another AWS account, not in the platform's own list of known accounts, with no `sts:ExternalId` condition (ExternalId matters for third parties) | Claimed | GetRole |
| U2 | **Granted, never used:** a service the role's policies name that AWS records no access to in its tracking period (step 2) | Confirmed | iam:GenerateServiceLastAccessedDetails and GetServiceLastAccessedDetails, not in v2.5: a template change and a console apply |

## What Desk shows with each finding

The role, the rule id and its plain sentence, the evidence level in words, the policy statement or trust statement it comes from (as text), and what would remove it. Nothing is "fixed" from Desk: a change is a plan, and IAM changes to the platform's own roles are console acts (P-IAM-001).

## Not in v1, on purpose

Users and access keys (design 04: a later, separate design), resource-based policies (bucket, key, function policies), SCPs and permission evaluation. Each would need its own reads and, for evaluation, an AWS answer (`iam:SimulatePrincipalPolicy`), not ours.

## Desk's mapping (ux.aws.a, design 08 section 5)

Claimed rules rest on the policy document AWS returned, so Desk shows them as Findings that may lead to "Ask for a plan", worded "The policy says ...". Desk's "Question" kind stays for evidence from files or names (security.aws.a's R-020), which can never lead to a plan. Agreed: a plan is reviewed and approved before anything changes.

## v1.1 (21:05 UTC)

security.aws.a's review (c4f1c6d) folded in: wildcard and NotAction/NotResource matching (W1, W2, E1); user, group, login-profile, access-key, boundary and sts:AssumeRole paths in E1; PassRole only with a code-running service, else information; no exemption for a boundary; T1 pinning conditions; T2 sub patterns, the StringEquals-wildcard mistake, and aud; T4 for third parties only, with a list of the platform's own accounts.
