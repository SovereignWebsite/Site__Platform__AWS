# Design 06: the Vault deploy page

ux.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~16:30 UTC. For step 5 of docs/team/plan-vault-deploy.md (work/conductor.aws.a, ea9f61d): screens, copy and states for the page that deploys one Vault into a customer's AWS account, "literally as simple as possible" (Dinis, ~14:55 UTC). Builders: dev.2.aws.a and dev.1.aws.a. Twin first. Design only: no code, no AWS.

Sources read (all material, none decided here):
- sherpa.aws.a, simplest path and addendum (docs/sherpa/2026-11-23__vault-deploy-01-simplest-path.md, b1281ba on work/sherpa.aws.a);
- vaults.aws.a, design 04 sections 3, 4 and 4a (docs/vaults/2026-11-23__04-vault-deploy-design.md on work/vaults.aws.a);
- cloudformation.aws.a, vault.yaml 0.3.2-draft and notes 01 to 03 (work/cloudformation.aws.a);
- iam.aws.a, 02-deploy-role.md (work/iam.aws.a);
- pm.aws.a, batch 2, V1 to V10 (docs/board/decisions.md on work/pm.aws.a).

This design assumes the recommended answers V1 (a), V3 (a) and V8 (a). Section 7 says what changes if Dinis picks otherwise.

## 1. What the customer does

The plan's five steps were account, sign in, region, domain and deploy. sherpa.aws.a's walk cut account and sign in. Domain moves to after the Vault works. What is left:

| # | Step | Where | Why it exists |
|---|---|---|---|
| 1 | Choose a region (one is already chosen) | our page | It decides where the Vault and its data live. It is the only input the stack cannot work out for itself. |
| 2 | Press "Deploy in my AWS account" | our page, then AWS's console | It opens CloudFormation in the customer's own console, already signed in, with everything filled in. The customer reads it and presses Create. No credential ever reaches our page. |
| 3 | Paste the Vault's address back | our page | In v1 our page cannot see their account (V8 a). The paste is how the page learns where the Vault is, and it checks the address at once. |

Adding their own domain is a separate, later action on the "done" screen. It is not part of deploying.

The account id is never typed. The stack reports its own (`AccountId` output), and the done screen shows it back ("deployed in account ...") so the customer can see it went where they meant.

### 1a. A blocker for "one button": two stacks

vault.yaml 0.3.2 runs "with RoleARN = the deploy role of stack sws-vault-<id>-access" (iam.aws.a, step 3). As drafted, the customer therefore launches two stacks: `-access` first, then `sws-vault-<id>`, choosing the deploy role in the console's permissions section. In the customer's eyes that is two link-outs, a wait between them, and a role to pick from a list. That is the hardest part of the current flow and the most likely place for a first-time customer to fail.

The options, for iam.aws.a, cloudformation.aws.a and security.aws.a (not mine to decide):

- (a) **Two link-outs, made foolproof.** Step 2 becomes "2a Create the permissions" and "2b Create the Vault". The second button stays disabled until the customer says the first finished. The page names the exact role to choose. This is the honest fallback, but it costs a step.
- (b) **One link-out.** If a quick-create link can carry the service role (*check*, boto3.aws.a: I could not find this in the material), the second launch still exists but needs no choice. Otherwise there is no gain.
- (c) **One stack.** The Vault stack creates the boundary and runs as the customer's own console identity, with no separate deploy role. That gives one link-out, but it loses iam.aws.a's guarantee that the stack can do no more than the deploy role allows. This is security.aws.a's call.

My recommendation, from the customer's side only: one link-out if security can live with it. Otherwise (a), drawn below as a variant (screen 2-alt). The rest of this design draws the single link-out and marks where (a) changes it.

**Answers so far (16:02 UTC):**
- **boto3.aws.a (b): no.** A quick-create link takes only `templateURL` (an S3 URL), `stackName` and `param_<Name>`; the service role is a choice on AWS's page ("Permissions"), and a template cannot set its own RoleARN. Sources: AWS CloudFormation User Guide, quick-create links and service role pages, read 23 Nov 2026 (docs/boto3/2026-11-23__08-vault-deploy-design-check.md addendum, 3ce137a on work/boto3.aws.a).
- **cloudformation.aws.a: (c) works** with vault.yaml as it is; the boundary goes back into the stack as a managed policy (as in 0.1.0). A stack that makes its own deploy role and then uses it would need a custom resource: not recommended.
- **iam.aws.a: (c) as the v1 default**, with the `-access` stack kept as an opt-in "least-privilege mode" for organisations whose deployers are not administrators, drawn as screen 2-alt (docs/iam/vault-deploy/03-one-button.md, 2ec2b93 on work/iam.aws.a). The separate role buys a non-admin deployer and bounded later updates; it does not protect the first create, which the published sha256 does.
- **security.aws.a, 16:04 UTC: (c) accepted as the v1 default**, with least-privilege mode as opt-in. This replaces its earlier (a), since the published sha256 protects the first create on both paths. Seven conditions (docs/security/reviews/2026-11-23__ux-design-06-vault-deploy-page.md, 0affab1 on work/security.aws.a):
  1. the boundary is a managed policy in vault.yaml, on every role the stack creates;
  2. no Transform, macro or custom resource, and IAM writes only on `sws-vault-<id>-*`;
  3. the template is a versioned S3 object with its sha256 shown;
  4. updates only through a change set the customer reviews, with the new sha256 beside it, never a direct update link;
  5. screen 1 says the stack runs with the rights of whoever presses Create, plus the least-privilege line;
  6. the `-access` stack and screen 2-alt stay tested on the twin;
  7. nothing schedules updates or teardown in v1.

  The remaining risk on later updates is R-022 (Low), for Dinis to see.

**The agents' recommendation, awaiting Dinis's answer** (through pm.aws.a's Vault batch, with R-022): one stack, one link-out (screen 2), as the main path. If Dinis chooses two launches instead, screen 2-alt becomes the main path and nothing else in this design changes. Screen 1 gains one quiet line under the button: "Your organisation does not let you create IAM roles? Use least-privilege mode", which leads to screen 2-alt. Conditions 1 and 2 are for cloudformation.aws.a, 3 to 5 are in the screens below, and 6 and 7 are in the build order (section 8).

**Consequence for screen 1:** the template must be served from an S3 URL (quick-create accepts no other), so "the template's immutable URL" is an S3 object URL, versioned, whose sha256 the page shows.

## 2. The frame

A page of its own (V1 a: its own address, so its CSP can let it fetch `https://<any host>/health`). It does not use design 05's console shell: there are no console tabs, no account picker and no Ctrl+K. It keeps three parts of the shell so it reads as the same product:

- the twin bar from design 02 rule 4, when the page runs against the twin;
- a one-line status line (`aria-live="polite"`);
- the same type, colour tokens and focus styles as the hub.

Single column, at most 40rem wide. Content Security Policy (security.aws.a): `script-src 'self'` with no inline scripts, and `connect-src 'self' https://*.cloudfront.net`, which is enough for v1's `/health` check and nothing wider. One primary button per screen. No sign-in, no cookies, no tracking (CLAUDE.md). The page keeps where the customer is in the URL fragment only (`#/region`, `#/launched/<id>`, `#/done/<id>`): Back works, a reload does not lose the Vault id, and nothing reaches a server. The fragment holds the Vault id and region, never the address or anything the customer pasted, because links get shared.

## 3. Screens (desktop, then phone)

### Screen 1: Deploy a Vault

```
+----------------------------------------------------------------------+
| Deploy your own Vault                                                |
| Your files, encrypted on your device, stored in your AWS account.    |
|                                                                      |
| Region   [ Europe (London) eu-west-2           v ]                   |
|          Where your Vault and its data live. You can add more later. |
|                                                                      |
| [ Deploy in my AWS account  ↗ ]                                      |
| Opens AWS CloudFormation in a new tab. You sign in to AWS there,     |
| as you normally do. We never see your AWS sign-in. The stack runs    |
| with the rights of whoever presses Create.                           |
| Your organisation does not let you create IAM roles?                 |
|   Use least-privilege mode                                           |
|                                                                      |
| ▸ What this creates in your account                                  |
|   One S3 bucket (kept if you delete the Vault, so you never lose     |
|   data), one Lambda function, one CloudFront address, one secret     |
|   holding your access token, one log group. Names start with         |
|   sws-vault-3f9a0c21b7d4.                                            |
| ▸ What it costs                                                      |
| ▸ The template: version 0.3.2, sha256 9c1e…  [Copy]  [View]          |
+----------------------------------------------------------------------+
```

- **Region list**: only the regions tested end to end on the twin (vaults.aws.a design 04, "the regions that have been tested"). The default is the first entry in the page's published list. No guessing from the browser and no "nearest" until someone has measured what nearest means. The label shows both names ("Europe (London) eu-west-2"), because AWS's console shows the code.
- **Vault id**: 12 hex characters, made in the browser (`crypto.getRandomValues`) when the page opens, and shown only inside "What this creates". The customer never types it or needs it.
- **The button** builds the quick-create link with the stack name `sws-vault-<id>`, the template's immutable URL and the parameters VaultId, ImageUri and DeployPageOrigin (cloudformation.aws.a's group "Filled in by the deploy link"). Domain parameters stay empty. Since vault.yaml 0.4.0 (08dbcf7 on work/cloudformation.aws.a; 0.4.1, 0f72f91, defaults to one-stack) one template serves both paths: the link sets `param_DeployMode=one-stack` for the main path and `access-stack` for least-privilege mode. It opens in a new tab (`rel="noopener noreferrer"`), and our page moves to screen 2.
- **"What this creates"** comes from the template's resources, not hand-written (dev.2.aws.a: generated at build from vault.yaml, so it cannot drift). It is collapsed by default but has to be there: it is what a customer reads before trusting a link that opens their console (sherpa.aws.a).
- **"What it costs"** opens on one honest line that is always there (security.aws.a, R-026): "You pay AWS for what the Vault uses. CloudFront charges for every request, including unwanted ones, so the cost has no fixed ceiling. After deploying we show how to set an alarm and how to turn the Vault off." Below it, billing.aws.a's cited estimate for the chosen region (docs/billing/README.md, vault-cost.mjs, land/billing.aws.a 4231806, from vault.yaml 0.4.1, AWS list prices before free tiers):
  - London (eu-west-2) and Ireland (eu-west-1): "About $0.40 a month with no data, $0.42 with 1 GB stored. Most of it is the secret that holds your access token." Only the figures in the billing file are shown, never rounded or reworded into a promise.
  - "Not included yet: the image registry (ECR), not priced. A new hosted zone for your own domain adds $0.50 a month." An unpriced item is shown as "not priced", never as $0.
  - Any other region in the list: "Not priced yet for this region." No number.

  The figures come from billing.aws.a's file at build time, with its date, so they change only when billing.aws.a changes them. No invented number, and no "costs little".
- **The template line** shows the sha256 from the page's index of published templates (vaults.aws.a 4a option a). View opens the exact file.

Phone (390 px): the same order, all full width. The region select is a native `<select>`, so the phone's own picker opens. The button is 48 px tall. The three "▸" sections stay collapsed. Nothing sits beside anything else.

### Screen 2: Finish in AWS

```
+----------------------------------------------------------------------+
| Finish in your AWS console                                           |
|                                                                      |
| 1. In the tab that opened, check the region (top right) says London. |
| 2. Scroll down, tick "I acknowledge that AWS CloudFormation might    |
|    create IAM resources with custom names", and press Create stack.  |
| 3. Wait for the stack to show CREATE_COMPLETE.                       |
|                                                                      |
| [ I see CREATE_COMPLETE ]                                            |
|                                                                      |
| Tab did not open? [ Open it again ↗ ]                                |
| Changed your mind? See "Remove this Vault" below.         |
+----------------------------------------------------------------------+
```

- The page cannot see progress in v1 (V8 a), so it says so instead of showing a spinner that means nothing. The progress view (plan step 7, viz.aws.a) lives on the twin until a read role exists.
- **How long**: no figure until cloudformation.aws.a has measured a create on the twin and then on a real account. After that: "This usually takes about N minutes" with the measured N. CloudFront distributions are the slow part.
- The acknowledgement wording must be copied from the real console when boto3.aws.a or cloudformation.aws.a has seen it (*check*). The text above is a placeholder.
- The page keeps no timer and polls nothing.
- "Changed your mind" points to the Remove steps (screen 4). Deleting the stack alone leaves the bucket and the log group, by design (Retain).

**Screen 2-alt (if section 1a ends at option a).** Two numbered blocks. "A. Create the permissions" has its own button and opens a quick-create link with stack name `sws-vault-<id>-access`. "B. Create the Vault" is disabled until "A shows CREATE_COMPLETE" is pressed, then opens a quick-create link with stack name `sws-vault-<id>`. Under B: "In Permissions, under IAM role, choose sws-vault-<id>-deploy" with the page's own id filled in. The role is chosen by name, because the page does not know the account and so cannot build its ARN. Same copy rules otherwise.

### Screen 3: Connect your Vault

```
+----------------------------------------------------------------------+
| Connect your Vault                                                   |
| In AWS, open the stack's Outputs tab and copy the value of Endpoint. |
|                                                                      |
| Endpoint [ https://d1a2b3c4d5e6f7.cloudfront.net        ] [ Check ]  |
|                                                                      |
| ✓ This is your Vault 3f9a0c21b7d4, template 0.3.2, in eu-west-2.     |
+----------------------------------------------------------------------+
```

- The page names the exact output key, `Endpoint`, and where it is. It never asks for `TokenSecretArn` or the token.
- **Input forgiveness** (sherpa.aws.a): accept with or without `https://`, with or without a trailing slash, and with spaces around it. Show the cleaned value back.
- **Accepted form**: in v1 the endpoint is always a CloudFront default address, so the page accepts only `https://<id>.cloudfront.net` (a custom domain is a later step). Anything else gets "In v1 this is an address ending in .cloudfront.net".
- **Check** fetches `<endpoint>/health` (vaults.aws.a 4a: the CloudFront Function, CORS for this page's origin only). It compares `vault_id` with the id this page made, and `template_version` with the published index.
- **The answer is untrusted** (security.aws.a): fetch with `credentials: "omit"`, `redirect: "error"` and `cache: "no-store"`. Read at most a few KB. `vault_id` must match `^[0-9a-f]{12}$` and `template_version` must be in the index. Render only through `textContent`.
- The address the customer pasted is kept in memory for this tab only. It is not put in the URL or in storage. A reload asks for it again.

### Screen 4: Your Vault is ready

```
+----------------------------------------------------------------------+
| Your Vault is ready                                                  |
| https://d1a2b3c4d5e6f7.cloudfront.net        [Copy]                  |
| Vault 3f9a0c21b7d4 · eu-west-2                                       |
|                                                                      |
| Next                                                                 |
| 1. Get your access token: in AWS, Secrets Manager, the secret        |
|    sws-vault-3f9a0c21b7d4-token. Only people with access to your     |
|    AWS account can see it.                                           |
| 2. Connect sgit:  sgit ... (command from vaults.aws.a)  [Copy]       |
|                                                                      |
| Later                                                                |
| ▸ Use my own domain                                                  |
| ▸ Limit the cost                                                     |
| ▸ Remove this Vault                                                  |
+----------------------------------------------------------------------+
```

- **No account id in v1.** `/health` does not return it, and it will not: security.aws.a agrees it is public and unauthenticated and would tie a Vault address to an account. The line reads "Vault <id> · <region>". The customer sees the account in their own console.
- The secret's exact name and the sgit command come from cloudformation.aws.a and vaults.aws.a (*check*). Placeholder text until then.
- **Use my own domain** opens design 06b (later): `-access` update, then `-edge` in us-east-1, then the Vault update (iam.aws.a's order). That is three link-outs, which is exactly why it is not on the first path.
- **Updating a Vault** (later, not drawn): only ever a change set the customer reviews in their console, with the new template's sha256 shown beside it on our page. Never a direct update link, and nothing scheduled (security.aws.a conditions 4 and 7). In least-privilege mode, when the page builds the `-access` update, it shows the DistributionId and CertificateArn values it passes beside the change set and never fills them silently (security.aws.a, after iam.aws.a's vault-access 0.2.0).
- **Limit the cost** (security.aws.a, R-026, the flood guard), three parts:
  - *An alarm*, depending on the mode (R-027, Medium, iam.aws.a and security.aws.a, via conductor.aws.a):
    - **One-stack mode**: the stack creates the request alarm and its email topic itself. Screen 4 says so and points to where the alarm sits in the customer's console. The customer types any alert email in AWS's own pages; our page never asks for it, fills it in or stores it.
    - **Least-privilege mode**: the deploy role cannot create the alarm, because no IAM condition can pin an alarm's metric or actions, and an EC2 alarm action could terminate a customer's instance. So screen 4 shows console steps to add the alarm and its email topic by hand, with the same threshold.
    - Both modes show billing.aws.a's line (flood.mjs, land/billing.aws.a 4231806): "Alarm at 45,000 requests in 5 minutes: about $1 an hour if it lasts (London, list prices, a 401 per request); the alarm costs $0.10 a month." It is labelled a starting point to tune to real traffic, not an AWS figure.
  - *Turn it off.* "Disable the distribution" steps for the customer's own console, with what that does in words: the Vault stops answering, and the data stays.
  - *Abuse protection (optional).* If AWS WAF is shown, it is labelled "protection against abuse", never as a cost cap, because WAF is billed per request too.
- **Remove this Vault**: delete the stack, then the documented empty-and-delete step for the bucket and the log group (cloudformation.aws.a, 0.3.0 "The removal step that Retain implies"). It says plainly that the bucket stays until they delete it, and that this is so they never lose data by accident.

## 4. States

| Screen | Empty | Waiting | Failed | Done |
|---|---|---|---|---|
| 1 | Region already set; button enabled | n/a (the link opens at once) | Pop-up blocked: the status line says "Your browser blocked the new tab" and the button becomes a plain link | Moves to 2 |
| 2 | Instructions shown | The customer is in AWS; the page shows "Open it again" and nothing animated | The stack shows ROLLBACK: a "It failed in AWS" link shows the three most likely causes once cloudformation.aws.a has seen them on the twin (a Lambda concurrency quota is already known: vault.yaml ReservedConcurrency's description), plus "delete the stack and start again; the bucket may stay, see Remove" | "I see CREATE_COMPLETE" moves to 3 |
| 3 | Field empty, Check disabled | "Checking…" on the status line, the button disabled, a 10 s limit | Each with its own sentence: not a URL; no answer (network or DNS: "it can take a few minutes after CREATE_COMPLETE; try again"); answered but not a Vault (no `vault_id`); a different Vault (id differs: "this is Vault X; this page made Y. Did you paste the address of another stack?"); an old template (version not in the index) | Moves to 4 |
| 4 | n/a | n/a | n/a | Address, Copy, next steps |

Screen 3's sentences, keyed by the reasons `checkHealth` and `cleanEndpoint` return (site/api/vault-deploy.js, a470729 on work/dev.2.aws.a.vault-deploy):

| Reason | Sentence |
|---|---|
| `not-url` | "That does not look like a web address. Copy the value of Endpoint from the stack's Outputs tab." |
| `not-cloudfront` | "In this version the address ends in .cloudfront.net. Copy Endpoint from the Outputs tab." |
| `no-answer` | "No answer from that address yet. It can take a few minutes after CREATE_COMPLETE; try again shortly." |
| `not-a-vault` | "That address answered, but it is not a Vault made by this page." |
| `other-vault` | "That is Vault <id>; this page made <id>. Did you copy the address of another stack?" |
| `old-template` | "That Vault reports template <version>, which this page does not offer, so it cannot vouch for it. Consider updating it." |
| `other-template` (a published version, but not the one this page linked) | "This Vault was made from template <version>, not the one this page offered. Did you paste the address of an older deployment?" |
| `template-mismatch` (sha256 differs from the index; checked before `other-template`, dev.2.aws.a 14c434a) | "That Vault's template does not match the published one. Do not use it: delete the stack and deploy again from this page." |
| `too-large` | "That address sent back far more than a Vault's check does, so the page stopped reading. Check you copied Endpoint." |

<id> and <version> are filled with `textContent`. The ids are 12 hex characters, already checked against `^[0-9a-f]{12}$`.

Every failure keeps what the customer typed and puts the focus on the field or button that fixes it. Errors go in the status line and next to the field (`aria-describedby`), never only in colour.

## 5. The twin (design 02 rules)

- Reached as `?twin#/region` from the hub's "Try the twin" or directly. The twin bar is the one-line bar of design 02 rule 4. The tab title is "Twin · Deploy a Vault" (rule 3).
- The button's copy becomes "Deploy in the twin's customer account", and it opens the twin's CloudFormation view (dev.1.aws.a, plan step 4) instead of AWS. No new tab is needed: it is the same page. The twin shows the stack's events, which gives viz.aws.a (plan step 7) its stage.
- In the twin, screen 3's paste is filled in for the customer, with a note "in AWS you will copy this yourself". The walk still shows the step, so sherpa.aws.a can test it.
- Every address in the twin is a documentation value (RFC 5737 or `.example`), as dev.1.aws.a's twin already does.

## 6. Accessibility and copy rules

- One `<h1>` per screen and focus moved to it on each step. Steps are separate views, not hidden tabs, so screen readers hear one thing at a time.
- Buttons say what happens ("Deploy in my AWS account ↗"); the ↗ has a text alternative "(opens a new tab)".
- No AWS jargon on screen 1 beyond the resource list. "Stack", "Outputs" and "CREATE_COMPLETE" appear only where the customer will see those exact words in AWS.
- Plain British English, no em dashes, no prices without a citation, no time estimates without a measurement.

## 7. If Dinis answers differently

- **V1 (b), a tab of this hub**: the page becomes a Desk item inside design 05's shell. Screen 3's Check cannot fetch `/health` under the hub's CSP (R-010), so it becomes a link the customer opens plus a DNS check through one fixed resolver. Weaker, and one more thing for the customer to read.
- **V3 (b), a role our page assumes**: sign in and account id come back as screens before 1. The rest stands.
- **V8 (b), a read role**: screen 2 gains real progress (resources appearing, viz.aws.a), screen 3's paste goes away, and a sign-in screen is added. Net: the same number of steps, but they are different.

## 8. Asks

- **pm.aws.a**: section 1a goes to Dinis as the agents' recommendation (one stack by default, least-privilege mode opt-in), with R-022 (Low) beside it.
- **Copy check**: if V3 changes, re-check "We never see your AWS sign-in" (security.aws.a).
- **boto3.aws.a**: whether a quick-create link can set the service role. Also the console's exact acknowledgement wording.
- **cloudformation.aws.a**: a measured create time on the twin, the likely failure causes, and the secret's name for screen 4.
- **vaults.aws.a**: the sgit command for screen 4; whether `/health` should return `account_id` (screen 4 gap).
- **billing.aws.a**: done for London and Ireland (4231806). Still to price: ECR for the image, and any further region the page lists.
- **dev.2.aws.a, dev.1.aws.a**: build order. 1, screens 1 to 4 on the twin with the paste prefilled. 2, screen 2-alt and the `-access` stack on the twin, kept under test (security.aws.a condition 6). 3, the generated "What this creates" list. 4, the real quick-create link behind V1 to V3. No scheduled update or teardown anywhere in v1 (condition 7).
- **cloudformation.aws.a**: security.aws.a conditions 1 and 2 in vault.yaml (the boundary as a managed policy on every role; no Transform, macro or custom resource).
- **sherpa.aws.a**: walk it on the twin at 390 px and desktop once step 1 of the build exists. Every step not needed is cut.
