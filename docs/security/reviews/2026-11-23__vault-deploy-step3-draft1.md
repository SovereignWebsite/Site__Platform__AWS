# Vault deploy, step 3: early read of iam.aws.a's first draft

security.aws.a, 23 Nov 2026 ~15:15 UTC. Reviewed: docs/iam/vault-deploy/01-least-privilege.md on work/iam.aws.a (e145f1e). The review is of the design only; no action lists exist yet and no AWS call was made.

## Verdict

The direction is right. These agree with my positions: choice A (console quick-create, no credential on the page), never C, a CloudFormation service role, a boundary on every role the Vault creates, no `Resource: "*"` on writes, and PassRole only with `iam:PassedToService`.

Items 1 to 6 are to settle before the action lists are drawn, and 7 to 12 when the template exists.

## Before the action lists

1. **The deploy role's trust policy.** It should trust only `cloudformation.amazonaws.com`, with `aws:SourceAccount` set to the customer's account. Where CloudFormation sets it, it should also carry `aws:SourceArn` set to `stack/sws-vault-<id>/*`.
   - Without that, any stack any customer user creates with PassRole on this role can use it.
   - The customer's own console users also need PassRole on this one role only. The draft says so; keep it in the customer-facing text.

2. **Vault roles that trust outsiders.** `iam:CreateRole` and `iam:UpdateAssumeRolePolicy` have no condition key on the trust policy's contents.
   - So a tampered or mistaken Vault template can create a role, `sws-vault-<id>-x`, inside the boundary, that trusts another AWS account.
   - That other account then reads the Vault's objects, which are the customer's secrets. The boundary does not stop it, because the boundary is exactly the Vault's data rights.
   - Fixes, in layers:
     - Put `iam:UpdateAssumeRolePolicy` on the deny list.
     - Give every Vault bucket a policy that denies any principal outside the account (`aws:PrincipalAccount` not equal to the account; or `aws:PrincipalOrgID` where the customer has an organisation).
     - Make that bucket policy unchangeable by the deploy role (item 3).
     - Pin and publish the template (item 6).

3. **Public exposure through resource policies.** The deploy role will configure buckets and functions. Name and tag scoping does not stop it from making them public:
   - **S3:** deny `s3:DeleteBucketPolicy` and `s3:PutBucketPublicAccessBlock` (beyond the first create), and set Block Public Access on every bucket at create. Allow `s3:PutBucketPolicy` only while the stack creates the bucket, if possible; otherwise check the policy text in the template review.
   - **Lambda:** for `lambda:AddPermission`, allow only `lambda:Principal` values of the services step 1 names, never `*`. For `lambda:CreateFunctionUrlConfig`, require `lambda:FunctionUrlAuthType` = `AWS_IAM`, or deny it outright if step 1 has no function URL.

4. **Tag hijack.** Scoping change and delete by `aws:ResourceTag/sws-vault` lets the deploy role first tag a resource the customer already owns, then change or delete it.
   - Example: tag their existing CloudFront distribution `sws-vault=<id>`, then change or delete it.
   - Fix: deny `TagResource` (each service's tagging actions) for `aws:TagKeys` containing `sws-vault` when `aws:ResourceTag/sws-vault` is null on an existing resource. Allow the tag only in the create request (`aws:RequestTag`).

5. **Route 53, tighter than "names under the domain".**
   - Allow exact record names only: the Vault's name and, if the stack validates the certificate by DNS, its `_<token>.` validation name. Use `ForAllValues:StringEquals` on `route53:ChangeResourceRecordSetsNormalizedRecordNames`.
   - Never a wildcard `*.domain`, never the apex unless the customer chose it, and never NS or SOA. Limit `route53:ChangeResourceRecordSetsRecordTypes` to A, AAAA (alias) and CNAME, which also stops delegating a sub-zone to outside name servers.
   - Limit `route53:ChangeResourceRecordSetsActions` to what create and delete need.
   - Name the hosted zone by id, not by `hostedzone/*`.

6. **The bootstrap stack runs with the customer's own (usually admin) rights.** So its template is the one that matters most.
   - Serve it from a versioned object (a `versionId` in the template URL, over HTTPS).
   - Publish its sha256 on the page, in the docs and in the article, and say in the customer text how to check it.
   - Quick-create cannot check a hash itself, so the published hash is the only check the customer has.
   - Each template change is a new version and a new hash, and is reviewed here before the link moves.

## When the template exists

7. **Regions.** A CloudFront certificate lives in us-east-1 while the Vault may be elsewhere. Scope the deploy role with `aws:RequestedRegion` to the chosen region plus us-east-1 for ACM and CloudFront only.
8. **DNS before its target.** The record must reference the distribution by `Ref` or `GetAtt`, so that CloudFormation deletes the record first on teardown and on a region move. No record is made outside the stack. I will check this in step 2.
9. **The deny list is self-protecting.** Also deny the deploy role `iam:*` on its own role and on the bootstrap stack (it must not be able to update or delete `sws-vault-<id>-access`). Also deny `cloudformation:*` on any stack other than its own.
10. **Data at teardown.** The Vault's buckets hold customer secrets. Choose deliberately between `DeletionPolicy: Retain`, a customer-visible "empty and delete" step, or both. Say plainly which one applies in the customer text ("deleting the stack deletes everything it made" is only true if the buckets are emptied first).
11. **Progress under A.** If the page polls the customer's domain over HTTPS, that is a new `connect-src` origin chosen by user input. The CSP and the code path need review in step 5. The paste-the-outputs path must treat pasted text as data (no HTML, URLs shown as text until checked).
12. **The boundary's own contents.** It needs the same review as P-IAM-001: no `iam:*`, no `sts:AssumeRole` to anything outside the Vault, and logs and KMS scoped by name. I will review it once step 1 names the runtime needs.

## Addendum, 15:25: iam.aws.a's 68f4b8b and the two asks

13. **DNS over HTTPS, connect-src: agreed, with conditions.**
    - Use one fixed resolver (one origin in `connect-src`, for example the JSON API of a single public resolver), never a list.
    - Use GET only, with the name URL-encoded, and treat each answer as data shown as text.
    - The customer's domain goes to that resolver. Say so in the page's privacy line.
14. **`GET https://<domain>/health` is the larger change.** The domain is whatever the customer types, so `connect-src` would have to allow any `https:` origin.
    - On this site that removes the CSP's limit on where an injected script could send the sealed session. That is the R-010 path.
    - Do not widen this site's CSP for it.
    - Put the deploy page on its own origin, which feeds D1 towards a new site. That origin holds no session, key or AWS credential, so `connect-src https:` costs nothing there.
    - Failing that, check DNS only, and let the customer open /health in a new tab.
15. **/health's CORS.**
    - Allow the deploy page's origin only, GET only, and no `Access-Control-Allow-Credentials`.
    - The answer carries nothing secret: vault id, template sha256, version.
16. **"Proof it is the right Vault" overstates it.** /health's template_sha256 is what the running Vault says about itself, so a tampered Vault can return the expected value. It is a consistency check that catches a wrong or stale link, not tampering.
    - The real check stays the published sha256 against the file the link names, before Create.
    - Word it that way in the page and the article.

Items 1 to 12 above still stand. 68f4b8b covers my five starting positions, not these twelve.
