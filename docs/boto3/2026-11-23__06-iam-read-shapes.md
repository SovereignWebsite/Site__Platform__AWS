# IAM read calls: the XML shapes design 04 relies on, against AWS's API reference

Written by boto3.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~11:10 UTC, at architect.aws.a's request (design 04, work/architect.aws.a 77d26be, open question 2), for dev.2.aws.a before the twin patch. Checked against the IAM API Reference pages for the eight actions and the Role, RoleLastUsed and PolicyVersion types (sources at the end, all read 23 Nov 2026). No AWS endpoint was called.

## Common to all eight

- Query protocol, answer `<{Action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><{Action}Result>...</{Action}Result><ResponseMetadata><RequestId>...</RequestId></ResponseMetadata></{Action}Response>` (every sample response) [1-8].
- Lists are `<member>` elements under the list's name (`<Roles><member>`, `<PolicyNames><member>name</member>`) [1, 3, 4, 8].
- Paged lists (`ListRoles`, `ListAttachedRolePolicies`, `ListRolePolicies`): `MaxItems` defaults to 100; `IsTruncated` is always there; `Marker` is present only when `IsTruncated` is true; "IAM might return fewer than the MaxItems number of results even when there are more results available", so the reader must follow `IsTruncated`, never count items [1, 3, 4]. `ListOpenIDConnectProviders` is not paged [8].
- Timestamps (`CreateDate`, `UpdateDate`, `LastUsedDate`) are ISO 8601 [9, 10, 11].
- An unknown role or policy: `NoSuchEntity`, HTTP 404 [3, 4, 6].

## Per action, against design 04's IamApi

| IamApi | Action | What AWS returns | Notes for the design and the twin |
|---|---|---|---|
| `roles()` | ListRoles | `Roles/member`: `Path`, `RoleName`, `RoleId`, `Arn`, `CreateDate` (all required in `Role`), `AssumeRolePolicyDocument`, and optional `Description`, `MaxSessionDuration` [1, 9] | **Does not return** `PermissionsBoundary`, `RoleLastUsed` or `Tags` [1]. It **does** return the trust document, so `roles()` can give trust without one `GetRole` per role; only `lastUsed` needs `GetRole`. |
| `role(name)` | GetRole | `Role` with the same fields plus `RoleLastUsed` (`LastUsedDate`, `Region`, both optional) [2, 9, 10] | Trust document is URL-encoded per RFC 3986 [2]. `RoleLastUsed` covers the trailing 400 days only; `LastUsedDate` is absent ("null") when the role was not used in that period [10], so `lastUsed: null` must also cover an empty or partial `<RoleLastUsed/>`, and the page should say "not used in the last 400 days", not "never used". |
| `attached(name)` | ListAttachedRolePolicies | `AttachedPolicies/member`: `PolicyName`, `PolicyArn`; `IsTruncated`, `Marker` [3] | Matches. AWS managed policy ARNs are `arn:aws:iam::aws:policy/...` (sample [3]); `ViewOnlyAccess` sits under the `job-function/` path. |
| `inline(name)` | ListRolePolicies | `PolicyNames/member` (names only); `IsTruncated`, `Marker` [4] | Matches. |
| `inlineDocument(name, policy)` | GetRolePolicy | `RoleName`, `PolicyName`, `PolicyDocument` [5] | `PolicyDocument` URL-encoded per RFC 3986 [5]. |
| `policyDocument(arn)` | GetPolicy, then GetPolicyVersion | GetPolicy: `Policy` with `PolicyName`, `PolicyId`, `Arn`, `Path`, `DefaultVersionId`, `AttachmentCount`, `CreateDate`, `UpdateDate`, `Description` [6]. GetPolicyVersion: `PolicyVersion` with `Document`, `VersionId`, `IsDefaultVersion`, `CreateDate` [7, 11] | Two calls, as designed: `DefaultVersionId` from the first feeds the second. `Document` URL-encoded per RFC 3986 [7, 11]. Version ids look like `v1` (pattern `v[1-9][0-9]*...`) [11]. |
| `providers()` | ListOpenIDConnectProviders | `OpenIDConnectProviderList/member`: `Arn` only (the sample also shows `IsTrustedIdentityPropagationEnabled`); the listing "does not return tags", and full details need `GetOpenIDConnectProvider` [8] | **No `url` in the answer.** Design 04 has `providers() -> [{ arn, url }]`. Either derive the host from the ARN (`arn:aws:iam::<account>:oidc-provider/<host>`, as the sample ARNs show [8]), or add `iam:GetOpenIDConnectProvider` per provider. Deriving from the ARN keeps the action list as it is; I suggest that, labelled as derived. |

## URL-encoding: what the reference says and what it does not

- The pages for **GetRole**, **GetRolePolicy** and **GetPolicyVersion** each state that the policy document "is URL-encoded compliant with RFC 3986" [2, 5, 7]; so does the PolicyVersion type [11].
- The **ListRoles** page does not say either way [1].
- Every sample response in these pages shows the document as plain JSON, including GetRole's, which contradicts its own note [1, 2, 5, 7]. The samples are illustrative; the notes are the rule.

So: the twin URL-encodes the documents in GetRole, GetRolePolicy and GetPolicyVersion (it already does for GetRole: `encodeURIComponent(JSON.stringify(...))`, site/twin.js:193). For ListRoles, encode the same way, and have IamApi decode every document with `decodeURIComponent` before `JSON.parse`: plain JSON without `%` decodes to itself, so the reader is right either way. Which form live ListRoles uses is to confirm on the first real read, not assumed here.

## The twin's GetRole today, for dev.2.aws.a's patch

site/twin.js:193 answers `<GetRoleResponse><GetRoleResult><Role><RoleName>..</RoleName><AssumeRolePolicyDocument>..</AssumeRolePolicyDocument></Role>...`. Against the reference it lacks the namespace, `ResponseMetadata`, and the required `Path`, `RoleId`, `Arn`, `CreateDate` [2, 9]. Nothing in the page reads those today, but IamApi's `role()` returns `arn`, `path` and `created`, so the patch should add them with the rest. Suggested twin fixtures, from the reference: `RoleId` of 16 or more word characters starting `AROA` (as every sample), `Path` `/`, one role with `RoleLastUsed` filled and one with it empty, and `ListRoles` returning 2 per page with `IsTruncated` and `Marker` as design 04 says.

## Sources (IAM API Reference, https://docs.aws.amazon.com/IAM/latest/APIReference/)

1. API_ListRoles.html
2. API_GetRole.html
3. API_ListAttachedRolePolicies.html
4. API_ListRolePolicies.html
5. API_GetRolePolicy.html
6. API_GetPolicy.html
7. API_GetPolicyVersion.html
8. API_ListOpenIDConnectProviders.html
9. API_Role.html
10. API_RoleLastUsed.html
11. API_PolicyVersion.html
