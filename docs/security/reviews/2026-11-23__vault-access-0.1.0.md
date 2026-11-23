# Vault access stack draft 0.1.0: security review

security.aws.a, 23 Nov 2026 ~16:35 UTC. Reviewed: docs/iam/vault-deploy/vault-access.yaml on work/iam.aws.a (3d0cb5a). This is the stack the customer runs with their own (usually admin) rights, so it gets the closest read. Design and template review only; no AWS call was made.

## Verdict

A careful draft. What it gets right:
- Every write is scoped by name to `sws-vault-<id>-*`.
- CreateRole only with the boundary, and PassRole only to Lambda.
- Self-protection denies on the role and the boundary.
- The trust, data, audit and secret denies.
- A deny on any other stack.
- The dynamic-reference read limited to the one secret and switchable off.

Item 1 must change, and 2 needs tightening. Items 3 and 4 are checks before the twin run; 5 to 7 are notes.

## Must change

1. **Tag hijack is still open through CloudFront.** `DistributionCreateTagged` allows `cloudfront:TagResource` on `Resource: "*"` with only `aws:RequestTag/sws-vault = <id>`.
   - That condition is just as true when the role tags one of the customer's *existing* distributions with `sws-vault=<id>`. After that, `DistributionOwnOnly` lets it update or delete that distribution.
   - This is exactly my point 4.
   - Fixes:
     - Allow only `cloudfront:CreateDistribution` (with the request tag) in the create statement.
     - Allow `cloudfront:TagResource` only where `aws:ResourceTag/sws-vault` already equals `<id>`.
     - Add an explicit Deny of `cloudfront:TagResource` and `cloudfront:UntagResource` when `aws:ResourceTag/sws-vault` is not `<id>`, unless the call is the create.
   - How CloudFront authorises the tag in CreateDistributionWithTags is the open check for boto3.aws.a.
     - If the create's tag cannot be told apart, create untagged and scope update and delete by the distribution's id. The id is a stack output; on an update it is passed back as a parameter. Do not use a tag that the role itself can add.

## Tighten

2. **The Route 53 validation name `_*.${DomainName}` is wider than ACM needs.** With `StringLike`, `*` also matches dots.
   - If the customer chooses the apex (`example.com`), the role may create CNAMEs such as `_acme-challenge.example.com`. Under a tampered template, that lets someone else get TLS certificates for the customer's domain by DNS-01 delegation. It also allows `_dmarc.example.com` and other underscore names.
   - Limit it to the shape ACM uses: one label of `_` plus a fixed-length token directly under the name, with no further dots. If ACM's token is 32 hex characters, as I recall, that is `_` plus 32 `?` wildcards then `.${DomainName}`. boto3.aws.a to confirm the exact length.
   - Also limit `route53:ChangeResourceRecordSetsActions` to what create, update and delete need.
   - Note: UPSERT lets the role overwrite a record the customer already has at DomainName. That is the chosen name, so it is accepted, but say it in the customer text.

## Checks before the twin run (boto3.aws.a)

3. **`lambda:FunctionUrlAuthType` on AddPermission.** Check that it is present only when the permission is for `lambda:InvokeFunctionUrl`, so this statement cannot grant `lambda:InvokeFunction` to `*`.
   - Also check whether current Lambda requires a separate `lambda:InvokeFunction` permission alongside `InvokeFunctionUrl` for a public URL. I recall a recent change in this area, but not its details; do not take this as a fact.
   - If it does, that permission must be limited to calls through the URL, not open to `*`.
4. **`aws:SourceArn` on the deploy role's trust.** The draft rightly says the twin must test whether CloudFormation sets it.
   - If it does not and the condition is removed, `aws:SourceAccount` alone lets any stack in the account use the role. The only users who can do that are those with PassRole on it.
   - So say in the customer text: give `iam:PassRole` on `sws-vault-<id>-deploy` only to the people who run the Vault.

## Notes

5. **Inline code.** `lambda:CreateFunction` and `UpdateFunctionCode` do not restrict the package type.
   - A tampered Vault template could ship `ZipFile` inline code instead of the pinned image. The ECR pull scope would not apply, and that code runs with the Vault's data rights.
   - The boundary still caps it, and the bucket still refuses other accounts. But outbound network from Lambda is open, so data could leave that way.
   - This is the same trust as the image itself. Record it in the trust paragraph: "the template you checked by hash decides what code runs".
   - If Lambda offers a condition key for the package type or a code-signing config, use it. That is a check, not a fact.
6. **`ReadTokenAtDeploy` defaults to `true`.** That is consistent with O3 until the server change. Make the page show it as a known gap whenever it is true outside the twin.
7. **`VaultId` is `^[a-z0-9]{4,12}$` here, but `^[0-9a-f]{12}$` in vault.yaml 0.3.0.** Use the same pattern in all three stacks. Then the deploy role's scope and the Vault's names can never disagree.

## Re-review, 17:05: 0.1.2 (9f0841b on work/iam.aws.a)

**Item 1: closed in the template.**
- The create statement carries no tagging right.
- TagResource is allowed only where the distribution already carries `sws-vault = <id>`.
- NeverTagOthers is an explicit Deny on Tag and UntagResource where the ResourceTag differs or is missing. StringNotEquals is true when the key is missing, so untagged customer distributions are covered.
- That Deny may also refuse the tag in CreateDistributionWithTags. The twin will show it, and the fallback (scope by the distribution id) is written down.

**Item 2: much better, with one Low left.**
- In StringLike, `?` matches any one character, including `.`. So `_` plus 32 `?` plus `.<domain>` still matches a two-label name of the same length.
  - Example: `_acme-challenge.` plus a 16-character label, then `.example.com`. That is a DNS-01 record for a new subdomain of the customer's domain.
  - Impact is Low: only under a tampered template, only for a new subdomain of that exact length, and a certificate alone serves nothing without DNS.
- To close it, add a Deny on `route53:ChangeResourceRecordSets` where `ForAnyValue:StringLike` NormalizedRecordNames matches `*.*.<domain>`. That refuses any name with two or more labels under the Vault's name. ACM's one-label token and the Vault's own name both still pass.
- Naming ChangeResourceRecordSetsActions is fine as documentation.

**Items 3 and 4:** with boto3.aws.a. The PassRole line for the customer text is written down.

**Item 5:** accepted as written in the trust text.

**Item 6:** with dev.2.aws.a and ux.aws.a.

**Item 7:** closed (`^[0-9a-f]{12}$` in all three stacks).

**Verdict:** no objection to the twin run. Before a real account it still needs:
- the outcome of the boto3 checks (3 and 4, plus cloudformation.aws.a's handler permissions);
- the twin's answer on CreateDistributionWithTags;
- O1 and O3.
