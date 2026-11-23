# Over-privilege rules v1, for Desk

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
| U1 | **Unused role:** GetRole's RoleLastUsed has no date, or a date more than 90 days ago | Confirmed (AWS's last-used record; AWS tracks a limited history and the date can lag; "never used" may mean "not in the tracked period") | ListRoles, GetRole |
| W1 | **Anything on anything:** an identity policy (inline or customer-managed attached) has an Allow with Action `*` and Resource `*` | Claimed | ListRolePolicies, GetRolePolicy, ListAttachedRolePolicies, GetPolicy, GetPolicyVersion |
| W2 | **A whole service on anything:** an Allow with Action `<service>:*` and Resource `*` | Claimed | as W1 |
| W3 | **Admin by AWS policy:** AWS managed AdministratorAccess, PowerUserAccess or IAMFullAccess attached | Claimed (attachment is a fact; what it allows after boundaries is not evaluated) | ListAttachedRolePolicies |
| E1 | **A way to more rights:** an Allow on Resource `*` (or on roles not its own) for iam:PassRole, iam:CreateRole, iam:Put/AttachRolePolicy, iam:CreatePolicyVersion, iam:SetDefaultPolicyVersion or iam:UpdateAssumeRolePolicy, with no permissions boundary on the role | Claimed | as W1, plus GetRole (PermissionsBoundary) |
| T1 | **Anyone may become it:** a trust statement with Principal `*` or `{"AWS": "*"}` and no condition | Claimed (from the trust text) | GetRole |
| T2 | **Any repository may become it:** a trust on GitHub's OIDC provider with no `token.actions.githubusercontent.com:sub` condition, or a `sub` with a wildcard over the repository part | Claimed | GetRole, ListOpenIDConnectProviders, GetOpenIDConnectProvider |
| T3 | **Any app may become it:** a trust on an OIDC provider (Google included) with no `aud` condition | Claimed | as T2 |
| T4 | **Another account without ExternalId:** a trust naming another AWS account with no `sts:ExternalId` condition | Claimed | GetRole |
| U2 | **Granted, never used:** a service the role's policies name that AWS records no access to in its tracking period (step 2) | Confirmed | iam:GenerateServiceLastAccessedDetails and GetServiceLastAccessedDetails, not in v2.5: a template change and a console apply |

## What Desk shows with each finding

The role, the rule id and its plain sentence, the evidence level in words, the policy statement or trust statement it comes from (as text), and what would remove it. Nothing is "fixed" from Desk: a change is a plan, and IAM changes to the platform's own roles are console acts (P-IAM-001).

## Not in v1, on purpose

Users and access keys (design 04: a later, separate design), resource-based policies (bucket, key, function policies), SCPs and permission evaluation. Each would need its own reads and, for evaluation, an AWS answer (`iam:SimulatePrincipalPolicy`), not ours.
