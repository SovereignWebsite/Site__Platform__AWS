# Storyboard 02: watch a Vault deploy into your account

viz.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Step 7 of docs/team/plan-vault-deploy.md (conductor.aws.a, from Dinis's word ~14:55 UTC: "maybe visualization on this"). Twin first; nothing here touches a real account.

## What the customer sees

The last screen of the wizard (step 5 of the plan). One sentence: "Your Vault is being built in your account. This takes a few minutes." Below it, the scene and, beside it, a plain list with the same facts.

- **The stack** in the middle: a hub labelled with the stack name and region.
- **Each resource** appears as it starts: a line travels out from the hub, a box appears labelled in plain words (storage, delivery network, address) with the AWS type underneath. Grey while working, green when done, red when it fails, with AWS's own reason.
- **The address last**: when the DNS record is created, a final step asks whether the name answers. "vault.example.org answers" (green) or "does not answer yet" (amber, checked again).
- **The list** beside the scene: each resource's latest state, in the order it appeared. A keyboard or screen reader user gets the whole story from the list.
- **Replay** afterwards at 1x, 4x or 16x (the shared player), so a slow CloudFront distribution does not have to be sat through twice.

## Where the data comes from

- Stack events: `CfnApi(region).events(name)` as cloudformation.aws.a designed it (newest first; time, logicalId, type, status, reason). Converted by `docs/viz/deploy-steps.mjs` into the same step shape the packet view and the swarm view use; played by `docs/viz/player.mjs`. 4 tests (15 in docs/viz).
- DNS: a lookup result passed in (`{ name, answers }`); who looks it up (the page through a DNS-over-HTTPS endpoint, or the twin) is for architect.aws.a and security.aws.a to decide.
- Resource meaning and links: ontology.aws.a's graph (docs/ontology/twin-graph.json) gives each type its plain-words label and what connects to what, so a box can show "serves files from" the bucket.

## Rules the view keeps

- Never a made-up status: every box is an event AWS (or the twin) reported. A gap is drawn as "waiting".
- No credentials on the page; the view only reads events (decision D3 is the customer's own console session).
- Failure is shown as calmly as success: what failed, AWS's reason, and that the stack rolls back by itself.

## Asks

- dev.1.aws.a (twin, plan step 4): `DescribeStackEvents` for the customer-account stack, events appearing over time so the view can be watched live on the twin.
- ontology.aws.a: plain-words label per resource type for the Vault's types (S3 bucket, CloudFront distribution, Route 53 record, Lambda, API).
- vaults.aws.a / cloudformation.aws.a: the template's logical ids once fixed, so the scene can lay out the stations in a sensible order before the events arrive.
- billing.aws.a: the hourly cost of what has appeared so far, shown under the list (plan step 8).
