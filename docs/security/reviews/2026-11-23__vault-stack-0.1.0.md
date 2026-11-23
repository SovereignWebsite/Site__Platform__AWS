# Vault stack draft 0.1.0: security review

security.aws.a, 23 Nov 2026 ~15:55 UTC. Reviewed:
- docs/cloudformation/vault/vault.yaml and vault-certificate.yaml on work/cloudformation.aws.a (42677c7).
- Checked against iam.aws.a's step 3 drafts (work/iam.aws.a 339295f) and my step 3 review (2026-11-23__vault-deploy-step3-draft1.md).

Design review only; no AWS call was made.

## Verdict

Not ready for a real account; it says so itself. It is a good base. What it gets right:
- Block Public Access on the bucket.
- BucketOwnerEnforced, encryption, versioning, and TLS only.
- A role trusted only by Lambda, in this account.
- An in-stack boundary and a narrow inline policy.
- A token from GenerateSecretString (64 characters) that is never an output.
- DNS records that reference the distribution through GetAtt, so they are deleted first.
- No role back to us.

Items 1 to 5 must change before the template is pinned. Items 6 to 10 are smaller.

## Must change before pinning

1. **The image is not pinned.** `ImageUri` is a free string.
   - A pinned template that runs a mutable image tag pins nothing: whoever can push that tag changes the code that holds the customer's token and reads their secrets.
   - Require a digest: `AllowedPattern` ending in `@sha256:[0-9a-f]{64}`.
   - The deploy link fills in a digest that is published next to the template's sha256.
   - O1 (whose ECR) decides who can publish. Cross-account pull from our registry makes us the customer's supply chain; that goes in the trust paragraph.
2. **The boundary sits in the same template it caps.** A tampered or mistaken Vault template can widen its own boundary, so the boundary guards nothing against the template.
   - iam.aws.a's design puts the boundary in the bootstrap stack (`sws-vault-<id>-access`), where the deploy role cannot change it.
   - Move it there and reference it by ARN (an import or a parameter).
3. **Names do not match the deploy role, and they collide.**
   - The template uses `${VaultName}-vault*`, with VaultName `^[a-z][a-z0-9-]{1,20}$`.
   - The deploy role is scoped to `sws-vault-<id>-*`.
   - With `-` allowed, names overlap between Vaults (my point 17). Example: Vault `a`'s scope `a-vault*` does not match, but Vault `a-b` and `a-b-c` can.
   - Use one scheme, `sws-vault-<id>-<part>`, with the id lower-case hex or base32, a fixed length, and no `-`. Give the customer a friendly name in a tag or description only.
4. **The bucket policy lets in principals outside the account.** It has TLS only, but nothing that refuses other accounts (my point 2, iam.aws.a draft 2).
   - Add `Deny s3:*` where `aws:PrincipalAccount` is not `${AWS::AccountId}`.
   - Add `aws:PrincipalOrgID` instead, if the customer has an organisation.
   - Without it, a role or bucket grant made later, by the template or by hand, can expose the store.
5. **Teardown policy conflicts with the deploy role.**
   - The template has the bucket `DeletionPolicy: Delete`. iam.aws.a draft 2 denies `s3:DeleteBucket` to the deploy role (Retain).
   - With the deploy role, the stack delete fails on the bucket. Without it, a bucket emptied by mistake is deleted.
   - Pick one: Retain (recommended; the store is the customer's secrets) plus a documented empty-and-delete step. Then say in the customer text that the bucket stays.
   - The same applies to the log group: it is `Delete` now, and I asked for Retain (point 19, audit trail).

## Smaller

6. **No reserved concurrency** on VaultFunction. It is condition (c) of my phase 1 ruling: the Function URL is public, and unauthenticated calls still run and bill. Add it as a parameter with a small default.
7. **Caching must stay disabled.** The responses are gated by the token, so a cache policy that caches them would serve one caller's data to the next.
   - `4135ea2d-...` is CachingDisabled and `b689b0a8-...` is AllViewerExceptHostHeader, as far as I know. The template rightly says to check both ids against AWS's pages.
   - Make that check a test on the template (the id must equal the documented CachingDisabled id), not a comment.
   - Also check that the token's header is forwarded and is not part of any cache key.
8. **Parameter checks.**
   - `DomainName` in vault.yaml has no `AllowedPattern`; the certificate stack has one, so reuse it.
   - `HostedZoneId` should be `AWS::Route53::HostedZone::Id`.
   - Both feed Route 53 changes, so a typo should fail at the parameter, not in DNS.
9. **Viewer TLS.** `MinimumProtocolVersion: TLSv1.2_2021` applies only with a custom domain. The default CloudFront certificate accepts older TLS for the `*.cloudfront.net` address. Say so in the notes; the default name is the phase 1 address.
10. **The certificate stack leaves its ACM validation CNAME in the zone** after delete. It points at ACM, so it is not a takeover risk. Document it, so the customer is not surprised.

## Already tracked, unchanged

- **O3, the token in the function's configuration.** Acceptable in the twin only. The server should read the token from Secrets Manager at start-up before a real customer; that goes in Dinis's batch.
- **O4, Function URL `AuthType: NONE`.** Accepted for v1 on my phase 1 conditions (a)-(e) in the step 3 review. Condition (b) needs the list of routes: which, if any, answers without the token (/health).

## Addendum, 16:10: draft 0.2.0 (cloudformation.aws.a 7ea995f)

### Fixed
- **Item 1:** ImageUri is ECR with an `@sha256:` digest by AllowedPattern.
- **Item 2:** the boundary is referenced from the `-access` stack. The stack runs as its deploy role.
- **Item 3:** names are `sws-vault-<id>-*`, with the id `^[a-z0-9]{4,12}$` and no `-`.
  - A fixed length is not needed now. Without `-` in the id, the `-` straight after it ends every match, so `sws-vault-abcd-*` can never match `sws-vault-abcde-...`.
  - iam.aws.a's 12 hex characters fall inside that pattern, so either is fine.
- **/health:** a CloudFront Function on viewer-request that never reaches the server.
  - CORS for one origin, GET only, no-store.
  - `DeployPageOrigin` (`^https://[a-z0-9.-]+$`) and `VaultId` are substituted into the function's code. Their patterns allow no quote or backslash, so they cannot break out of the string.

### Still open from my 0.1.0 review
- **Item 4:** the bucket policy still has TLS only. Add the Deny where `aws:PrincipalAccount` is not this account.
- **Item 5 / O7:** cloudformation.aws.a's note reads my teardown position as favouring Delete. It does not.
  - I asked for **Retain** on the bucket (the store is the customer's secrets) and on the log group (the audit trail). iam.aws.a's deploy role also denies `s3:DeleteBucket` and `logs:DeleteLogGroup`, so Delete will fail with that role anyway.
  - "Teardown removes what the stack made" was about leaving nothing dangling: DNS, roles, functions and the distribution. It was not about deleting data.
  - Make it Retain on both, with a documented empty-and-delete step for the customer.
- **Item 6:** no reserved concurrency yet.
- **Item 7:** no test that the cache policy id is CachingDisabled yet.
- **Item 8:** `DomainName` in vault.yaml has no AllowedPattern (vault-edge.yaml has one), and `HostedZoneId` is a plain String.

### New
22. **`AccessTokenSecretArn` (bring your own secret).**
    - The dynamic reference resolves with the deploy role's rights. iam.aws.a scopes secrets to `secret:sws-vault-<id>-*` with no GetSecretValue beyond that one secret.
    - So an arbitrary ARN either fails, or pushes the deploy role towards GetSecretValue on any secret, which would let a tampered template read every secret in the customer's account.
    - Drop the parameter for v1. If it stays, pin it by AllowedPattern to `secret:sws-vault-<id>-*` in this account and region.

### O4
Accepted for v1, as ruled in the step 3 review, on conditions (a) to (e).
- Condition (b) is now met by design: /health is not a server route.
- Conditions (a) and (c) stay open: constant-time compare and no logging of the token in the server; reserved concurrency in the template.
