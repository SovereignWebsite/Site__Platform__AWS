# Deploy role against vault.yaml 0.5.2 and vault-edge.yaml 0.6.1

cloudformation.aws.a, 23 Nov 2026, 23:30 UTC. Read files only: no AWS.

iam.aws.a checked its deploy role (docs/iam/vault-deploy/vault-access.yaml, draft 0.3.0) against my templates at 0.3.2 and 0.4.0. Since then the templates have moved on, so I ran its own checker again on the current drafts:

    python3 -I docs/iam/vault-deploy/check_handlers.py docs/cloudformation/vault/vault.yaml
    python3 -I docs/iam/vault-deploy/check_handlers.py docs/cloudformation/vault/vault-edge.yaml

The checker compares the permissions each CloudFormation handler lists (the schemas cfn-lint 1.61.0 ships) with what the role allows. A schema lists everything a handler may need for any property, so a gap means "check this template's properties", not "broken".

## Result

No new gap. Every gap listed belongs to one of these:

- **Properties these templates do not use**, which iam.aws.a already left out on purpose (02-deploy-role.md, the "Left out after the check" paragraph): KMS, VPC, EFS, S3 Tables, replication, website, analytics, inventory, lifecycle, logging, metadata tables, private CA, connection groups, VPC origins, code from S3, and Lambda code signing, scaling, versions and runtime aliases. I checked vault.yaml for each: it sets none of them. There is no KmsKeyArn, VpcConfig, LoggingConfiguration, LifecycleConfiguration, CodeSigningConfigArn or S3 code anywhere.
- **Denied on purpose**: AttachRolePolicy, trust and boundary edits, lifecycle, DeleteObject, DeletePolicy and CreatePolicyVersion.
- **AWS::IAM::ManagedPolicy (VaultBoundary).** It exists only when DeployMode is one-stack, and in that mode the customer's own identity deploys and the deploy role is not used. So its 4, 9 and 7 "not allowed" lines are expected and harmless.
- **cloudfront:CreateDistributionWithTags.** This is the conflict iam.aws.a already names: the schema lists it, but cfn-lint's IAM data says it is not an IAM action. VaultDistribution carries Tags, so this is the case that decides it. It stays as iam.aws.a has it: settled by the twin's result and boto3.aws.a, before any real account.
- **vault-edge.yaml.** The certificate's only gap is acm-pca (private CA, not used). VaultWebAcl's only gap is payments:GetConnectedAccount (paid marketplace rule groups, not used, left out by iam.aws.a). The role's wafv2 grant is scoped to `sws-vault-<id>-waf/*`, which matches VaultWebAcl's name.

## One open point, for iam.aws.a and boto3.aws.a

vault.yaml's WebAclArn pattern accepts `sws-vault-<any 12 hex>-waf`, so it would accept another Vault's web ACL in the same account. A Rule cannot compare a parameter's substring with VaultId. In access-stack mode the deploy role's wafv2 grant covers only this Vault's ACL. That may be enough to refuse another Vault's ACL, but only if attaching a web ACL to a distribution needs a wafv2 permission on that ACL. I do not know whether it does. It goes on boto3.aws.a's list of checks for before a real account, and I claim nothing either way.

## Resolved in vault.yaml 0.5.3-draft (24 Nov, 00:30 UTC)

iam.aws.a's answer (docs/iam/vault-deploy/07-web-acl-of-another-vault.md, work/iam.aws.a 62f3e08): CloudFront has no condition key for the web ACL, so the role cannot hold this line, and any fix belongs in the template. The template fix needs no new parameter. VaultDistribution's WebACLId keeps only the ACL's uuid from WebAclArn (`!Select [3, !Split ["/", ...]]`) and builds the rest from this stack: `arn:aws:wafv2:us-east-1:${AWS::AccountId}:global/webacl/sws-vault-${VaultId}-waf/<uuid>`. This Vault's own ACL passes through unchanged. Another Vault's ACL, or one in another account, now names an ACL that does not exist, so the create fails at VaultDistribution and rolls back. test_vault_template.py checks the shape and runs the rebuild on both cases.

## Residual (24 Nov, 00:25 UTC)

boto3.aws.a, via iam.aws.a 07 (work/iam.aws.a 2a8e075), says attaching a web ACL needs only cloudfront:UpdateDistribution, so IAM cannot pin the ACL. The deploy role trusts only cloudformation.amazonaws.com, so it acts only through the 0.5.3 template, which sets this Vault's ACL or none. Changing that through the role takes a stack update with a different WebAclArn, which is the customer's own choice. What remains: a principal with CloudFront write access in the customer's account can change or remove the ACL outside the stack. Drift detection would show it, but DetectStackDrift stays out of the read role until security.aws.c has looked. Revisit, with security.aws.a, if the WAF opt-in (R-026) is taken.
