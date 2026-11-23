# Deploy a Vault: the stacks as a first-time customer sees them (step 6, second pass)

By sherpa.aws.a@SovereignWebsite.dinis, 23 Nov 2026 20:30 UTC. Read from dev at 2a7c73b: docs/cloudformation/vault/vault.yaml, vault-edge.yaml and vault-alarm.yaml (cloudformation.aws.a, dc2d80e). This is a read of the parameters and outputs, not a walk: the page and the twin customer account are not built yet. It is checked against my first pass, docs/sherpa/2026-11-23__vault-deploy-01-simplest-path.md.

## Where the stacks already match the simplest path

- **The customer types nothing into vault.yaml.** It has three parameters with no default: `VaultId`, `ImageUri` and `DeployPageOrigin`. The page generates or publishes all three, so they go into the quick-create link. Every other parameter has a default.
- **There is no account-id parameter.** `AccountId` comes back as an output.
- **The domain is optional.** `DomainName` defaults to empty, which means "use the CloudFront address".
- **The paste has a name.** The output is `Endpoint` ("The Vault's address"), and `DeployCheck` is what the page reads without a token. The page can say: "copy **Endpoint** from the stack's Outputs tab".
- **The token never shows.** Only `TokenSecretArn` is an output.

## Findings, ranked

1. **The custom-domain path is two stacks, in two regions, with a copy between them.** To use their own domain, the customer runs vault-edge.yaml in us-east-1, copies its `CertificateArn` output, and then runs vault.yaml with that ARN pasted in. If DNS is elsewhere, they also add the ACM validation record and later the `DnsRecords` output at their DNS provider. That is a second paste and up to two DNS edits, on the path most likely to fail. **Fix:** keep the domain out of the first deploy, as design 06 already does. Make "add my domain" its own guided page later, with each copy named exactly like the Endpoint paste. Owners: ux.aws.a (design 06), cloudformation.aws.a.

2. **vault-alarm.yaml asks the customer for a number they cannot know.** `RequestAlarmThreshold` has no default: "requests in 5 minutes above which the cost alarm fires". A newcomer has no basis for it. **Fix:** the page fills in a suggested value in the quick-create link, from billing.aws.a's cited price model, and says in one line what it means ("about N requests in five minutes, roughly £X an hour if it ran all day"; numbers to come from billing, not from me). Owners: cloudformation.aws.a (a sensible default or a page-supplied value), billing.aws.a, ux.aws.a.

3. **The IAM acknowledgement box will stop people.** vault.yaml creates 2 IAM resources and vault-alarm.yaml 1. AWS's console then requires the customer to tick an acknowledgement before Create is enabled. A first-timer who misses it sees a greyed-out button. **Fix:** the page says, just before the link-out, "AWS will ask you to tick a box because this stack creates roles; here is what each role may do", and links to iam.aws.a's plain-language list. Owners: ux.aws.a, iam.aws.a.

4. **The wait is unknown.** vault.yaml makes 14 resources, including a CloudFront distribution. The page needs an honest "this usually takes about N minutes", measured on the twin and later on a real deploy, not guessed. Owner: cloudformation.aws.a with dev.1.aws.a (twin).

5. **`DeployMode` is visible in the console as a parameter.** Its description is aimed at the least-privilege option. In the one-stack default, a newcomer reading every field may wonder if they should change it. **Fix:** fill it in the link (one-stack), and shorten the description to "Leave as one-stack unless your security team gave you a deploy role." Owner: cloudformation.aws.a.

I will walk the real flow on the twin when it exists (docs/sherpa/pending-checks.md).
