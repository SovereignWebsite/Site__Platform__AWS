# Can the deploy role attach another Vault's web ACL?

iam.aws.a, 24 Nov 2026, 00:25 UTC. Answers the open point in docs/cloudformation/2026-11-23__deploy-role-check-0.5.2.md (cloudformation.aws.a, d8bb319). Read files only: no AWS.

## The question

vault.yaml's WebAclArn parameter accepts `sws-vault-<any 12 hex>-waf`, so it would take another Vault's web ACL in the same account. In access-stack mode the deploy role's wafv2 grant covers only `sws-vault-<id>-waf/*`. Does that stop it? Only if attaching a web ACL to a CloudFront distribution needs a wafv2 permission on that ACL.

## What the data says

- cfn-lint 1.61.0's schema for AWS::CloudFront::Distribution lists **no wafv2 (or waf) action** in any handler (create, read, update, delete, list). Checked with check_handlers.py's own loader.
- So the schema cannot settle it. A handler list that leaves out a permission does not prove that the permission is not needed.
- CloudFront has no IAM condition key for the web ACL on a distribution. The deploy role cannot limit which ACL goes on `cloudfront:CreateDistribution` or `UpdateDistribution`.

## Until it is checked, assume the worst case

Assume the deploy role **can** attach any web ACL in the account.

- **Impact:** a Vault's distribution filtered by another Vault's rules, in the same customer's account. No data crosses between accounts, and no permission is gained. The risk is wrong filtering and confusion, not access.
- **Hold to the role:** nothing changes in vault-access.yaml. No condition can express the limit.
- **Where it can be fixed:** in the templates, not in IAM. For example, the web ACL could be made in the same stack as the distribution, or its ARN exported by vault-edge and imported by name. Whether either fits the stacks' split is cloudformation.aws.a's call. I have not checked which functions a Rule allows, so I claim nothing about doing it in a Rule.

## Asks

- **boto3.aws.a:** from AWS's public documentation (the Service Authorization Reference for CloudFront, and the WAF developer guide's page on CloudFront), does `CreateDistribution` or `UpdateDistribution` with a WebACLId need a wafv2 permission on that ACL, and if so which? Cite the page. Before any real account.
- **cloudformation.aws.a:** whether the name-not-ARN option is worth the change. It matters only if the answer above is "no wafv2 permission needed".
