# Review: design 06, the Vault deploy page (ux.aws.a a640050)

security.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~17:10 UTC, fresh session. Vault deploy plan step 12 (design review). This is a design-only review: no code, no AWS. Read against iam.aws.a's 02-deploy-role.md (work/iam.aws.a) and the positions in my hand-over (D3 quick-create, pinned template, DNS, guard rails).

## Section 1a: one launch or two

**Recommendation: (a), two link-outs made foolproof, for v1. (c) only if Dinis chooses it knowingly.**

What the separate deploy role buys is a bound that does not depend on the Vault template. "The Vault boundary ... the most the function can ever do, whatever the Vault template says" (iam 02).

- **We are the customer's supply chain.** The template and the image digest come from us. The Vault stack will be updated far more often than the permissions stack (image digest bumps, template fixes). Under (a), every Vault update runs as the deploy role, so a wrong or compromised Vault template can still do no more than `-access` allows. The customer reviews `-access` once, and it changes rarely. Under (c), every update runs as the customer's console identity, which is usually an administrator. The only bound left is the customer reading each diff.
- **Moving later is hard.** Moving a deployed Vault from (c) to (a) means stack import or a rebuild in every customer account. Starting at (a) costs one extra link-out, once.
- **(b) adds nothing.** As far as I know, a quick-create link carries the template, the stack name and the parameters, but not the service role. This needs confirming. Even if it can, the second launch still exists.

If Dinis picks (c), these conditions apply:
1. The template creates the boundary and attaches it to every role it creates, with no AttachRolePolicy of managed policies.
2. No `Transform`, macro or custom resource. Each of these runs code with the caller's rights.
3. No `iam:*` and no wildcard resources.
4. Updates are offered only as a change set the customer reviews before executing, never as a direct update link. The new template's sha256 is shown beside it.
5. The page says plainly that the stack runs with the rights of whoever presses Create.

Who decides: Dinis, through pm.aws.a's board (a new V item).

Screen 2-alt as drawn is right, and it needs three more things:
- The page names the exact role to choose, `sws-vault-<id>-deploy`.
- The second button opens a link whose stack name is fixed to `sws-vault-<id>`.
- The customer's console user needs only what iam 02 line 12 lists.

## Screen 3: the check against `<endpoint>/health`

Agree that the pasted address is kept in memory only, never in the URL or in storage. To add:

1. **Narrow the CSP.** In v1 the endpoint is always a CloudFront default domain, because a custom domain comes later. So the page's CSP can be `connect-src 'self' https://*.cloudfront.net`, not any https host. The input should accept only `https://<14 lower-case alphanumerics>.cloudfront.net` (the length is to confirm with cloudformation.aws.a), with an optional trailing slash. Design 06b, own domain, widens this then and is reviewed then. A page with `connect-src https:` is an open exfiltration path for any script that ever gets in.
2. **The answer is untrusted.**
   - Use `fetch(url, { credentials: "omit", redirect: "error", cache: "no-store" })` with the 10 s limit.
   - Read at most a few KB.
   - Parse it as JSON and compare only `vault_id` (exactly `^[0-9a-f]{12}$`) and `template_version` (exactly an entry in the index).
   - Render only through textContent. Never echo other fields, and never echo the body.
3. **No other script on this page.** `script-src 'self'`, no third-party script, no inline script, and the same CSP discipline as the hub.
4. **DeployPageOrigin**, the parameter that sets `/health`'s CORS, must have an AllowedPattern of one exact `https://` origin with no wildcard. It belongs in the generated link, and the customer should never edit it.

## Screen 4: should `/health` return `account_id`?

**No. Drop it from v1, as ux.aws.a recommends.** `/health` is public and unauthenticated. AWS does not treat an account id as a secret, but publishing it ties a Vault address to an account for anyone who finds the address. That helps targeted phishing, and guessing role and bucket names (the bucket name is `sws-vault-<id>-data-<acct>-<region>`). The customer can see the account in their own console.

## Copy that must stay true (CLAUDE.md: never invent a fact)

- Screen 4 says the token secret is something "Only you can see". That is not true: anyone in the account with `secretsmanager:GetSecretValue` on it can read it. Say instead: "Only people with access to your AWS account can see it."
- Screen 1 says "We never see your AWS sign-in". That is true for this design (V3 a), and it must be re-checked if V3 changes.
- "Delete the stack in AWS; nothing else is needed" (screen 2) conflicts with the retained bucket and log group. Point to Remove, as screen 4 does.

## Other points

- A Vault id of 12 hex characters from `crypto.getRandomValues` is 48 bits. It is fine as a name, and it is not a secret: it appears in every resource name and in `/health`. Nothing should treat it as one.
- The fragment holds only the id and the region. Agree.
- The new tab uses `rel="noopener"`. Agree. Use `noreferrer` as well, so the console never receives our page's URL.

## Verdict

Docs only, own paths, signature verified (ux.aws.a key sha256:b6dca6f336d7308c). No new risk in the register: these are design conditions for the build, to hold when the page is reviewed as code. Asks: Dinis, on 1a, through pm.aws.a; ux.aws.a, the copy fixes and screen 3's points 1 to 4; cloudformation.aws.a, DeployPageOrigin's AllowedPattern.
