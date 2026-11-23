# What each role may do, in plain words

For the deploy page, beside the AWS acknowledgement box ("I acknowledge that AWS CloudFormation might create IAM resources"). iam.aws.a, 23 Nov 2026, for sherpa.aws.a's finding 3 (docs/sherpa/2026-11-23__vault-deploy-02-template-check.md) and ux.aws.a. Written for a first-time customer; each line matches the templates on dev (docs/cloudformation/vault/) and docs/iam/vault-deploy/.

## Why AWS asks

AWS asks you to tick that box whenever a stack creates IAM roles or policies, because a role can act in your account. These stacks create the few roles the Vault needs, and each is limited to the Vault's own things.

## The Vault stack (`sws-vault-<id>`) creates

**The Vault's own role, `sws-vault-<id>-api`.** The Vault server runs as this role. It may:
- read, write and delete files in the Vault's one bucket, and nowhere else;
- write its own logs.

It cannot reach any other bucket, read your other secrets, create users or keys, or change any role.

**A cap on that role, `sws-vault-<id>-boundary`.** A permissions boundary: the most the Vault's role can ever do, whatever a future version of the template says. It lists the same three things above.

## The cost alarm stack (`sws-vault-<id>-alarm`), only if you switch on the kill switch, creates

**`sws-vault-<id>-killswitch`.** If the cost alarm fires, this pauses your Vault. It may:
- turn off the Vault's one CloudFront distribution;
- set the Vault's one function to accept no requests;
- mark both as paused, and write its own logs;
- send a failure note to your cost-alert email topic, if you set one.

It cannot delete anything, undo a pause (you do that, deliberately), or touch IAM, your files, secrets, instances or anything else.

## Only in least-privilege mode: the access stack (`sws-vault-<id>-access`)

For organisations whose deployers are not administrators. It creates a deploy role, `sws-vault-<id>-deploy`, that CloudFormation uses to build and update the Vault. It may create, change and remove only the Vault's own resources, named `sws-vault-<id>-...`. It can never delete your data bucket's contents or its logs once the Vault is running, never create users or access keys, never act on your instances, and never change its own rights. Anyone allowed to create or update the Vault's stacks can use it, so limit who may do that.

## What none of them can do

Reach anything outside this Vault; give anyone outside your account access; delete your data as a side effect (the data bucket and its logs are kept when the stack is deleted, until you delete them yourself).

You can read every one of these in the template before you press Create; the page shows its sha256 so you can check it is the one we published.
