# Design 05: how the deploy page checks a Vault it cannot sign in to

architect.aws.a@SovereignWebsite.dinis, 23 Nov 2026, session https://claude.ai/code/session_018yvwtMBzo4iQ9dN7icjvXK. Status: agreed by security.aws.a and vaults.aws.a; revised 17:05Z with security.aws.a's four changes and vaults.aws.a's notes (section 8). Material for the plan in docs/team/plan-vault-deploy.md (steps 4 and 5) and for decision D1 (where the page lives). Builds on:

- iam.aws.a, docs/iam/vault-deploy/01-least-privilege.md (68f4b8b on work/iam.aws.a): v1 reads nothing from the customer's account; the page checks from outside at the end.
- vaults.aws.a, docs/vaults/2026-11-23__04-vault-deploy-design.md section 4a (work/vaults.aws.a): `/health` is a CloudFront Function answering `{ vault_id, template_version, template_sha256 }` with CORS for the deploy page's exact origin; agreed with iam.aws.a that the page looks the sha256 up in its own index from `template_version`.
- Design 01 (one transport, two back ends) and design 03 (every service in one shape).

## 1. The problem this settles

The page holds no credential for the customer's account, so its only proof is a `GET https://<endpoint>/health`. The endpoint is the customer's: a `*.cloudfront.net` address they paste, or any domain they typed. A browser only lets a page fetch hosts its CSP lists in `connect-src`, and this page cannot list a host it learns at run time without allowing every HTTPS host.

On the hub's origin that is not acceptable: the hub holds the change role in its sealed session, its CSP is `connect-src 'self' https://accounts.google.com/gsi/ https://*.amazonaws.com`, and R-013 (c) already asks to narrow that list, not widen it. A script on an origin allowed to reach any host can send whatever it can read to anyone.

## 2. Recommendation: the deploy page has its own origin, and holds nothing

For D1 (new site or a tab of the hub): **a new site** (deploy.<domain>, or any origin that is not the hub's). Reasons, in order:

1. **Nothing to steal.** The deploy page has no sign-in (D3: the customer's own console and a quick-create link), no sealed store, no IndexedDB, no credentials. On that origin `connect-src https:` is safe in the way it is not on the hub: there is nothing for a script to send.
2. **R-010 does not reach it.** The hub's same-origin risk (any agent's page sharing the hub's IndexedDB) cannot apply to an origin that never had a session.
3. **Its CSP stays strict everywhere else.** v1 (ux.aws.a design 06: CloudFront default addresses only): `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' https://*.cloudfront.net; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. `connect-src https:` comes only with design 06b (custom domain), on this nothing-held origin, with section 4's refusal list then doing the real work (security.aws.a: a typed domain can resolve to a private address, and Private Network Access only partly stops that; v1 has no need for it). No Google script at all (there is no sign-in), so the R-004 Google supply-chain point does not apply either.

If D1 goes the other way (a tab of the hub), the page cannot check a custom domain: it can only offer the customer a link to open `https://<domain>/health` themselves. That is the fallback, not the design.

## 3. No DNS-over-HTTPS in v1

iam.aws.a's note proposed a public DNS-over-HTTPS resolver to tell "the name is not there yet" from "the name is there but nothing answers". Recommended for v1: **no resolver**.

- **Privacy:** a public resolver (Google, Cloudflare, Quad9) would learn every domain a customer types into our page. This site has no tracking and sends no visitor data to third parties; a resolver call would be the first. That is Dinis's call, not ours (ask below).
- **It adds little.** The fetch itself resolves the name; a failed fetch with a clear message ("not answering yet; a new name can take a few minutes to be seen everywhere") covers the same customer wait.
- **Later, if wanted:** one resolver, JSON API only, its exact host in `connect-src` next to `https:` (no new capability, only a new party), asked for A/AAAA only, only after the customer presses Check.

## 4. The check, as an API in design 03's shape

`site/deploy/check.js` on the deploy origin (or `site/api/deploy-check.js` if D1 is a tab), reads only, no AWS signing, through the same transport as everything else so the twin answers it (section 5).

```
var check = DeployCheck(fetchFn, { index });       // index: the published-template index, { [version]: { sha256, url } }
check.endpoint(text)   -> { ok: true, origin } | { ok: false, reason }   // validate a paste or a typed domain, no request
check.health(origin)   -> Promise<health>                                 // one GET <origin>/health
check.watch(origin, { expect, every, until, signal }) -> async iterator of health   // polls; stops on live, mismatch, until or abort
health = { origin, state, checkedAt, vault_id, template_version, template_sha256, reason }
state  = "live" | "mismatch" | "not-answering" | "not-a-vault"
```

- **endpoint(text), v1:** accepts only `https://d[a-z0-9]+.cloudfront.net` (with or without a trailing slash or path, which is dropped); anything else gets "In v1 this is an address ending in .cloudfront.net; use the Outputs tab value named Endpoint" (a pasted Function URL is the likely mistake: vaults.aws.a). **endpoint(text), with design 06b:** accepts a host or an `https://` URL; keeps the origin only (scheme `https`, a host, no port, no user or password, path dropped). Refuses: IP literals (v4 and v6), `localhost`, single-label names, `.local`, `.internal`, `.lan`, `.home.arpa`, and anything that is not a valid DNS name. Reason: the customer's browser should not be made to send requests into their own network because of a paste.
- **health(origin):** `GET <origin>/health`, `credentials: "omit"`, `redirect: "error"`, `cache: "no-store"`, 8 s timeout. Body read with a 4 KB cap, `JSON.parse` only, then field checks: `vault_id` matches `^[0-9a-f]{12}$` (vault.yaml's VaultId AllowedPattern, work/cloudformation.aws.a; the template is the source), `template_version` is one of the index's keys. The answer is exactly `{ vault_id, template_version }` (vaults.aws.a); extra fields are ignored, never shown. A network or CORS failure is `not-answering` (the browser does not say which, and we do not guess). A 200 with the wrong shape is `not-a-vault`. A known version with a different `vault_id` than `expect.vault_id`, or a version other than `expect.template_version`, is `mismatch`. `template_sha256` is the published index entry for that `template_version`, never taken from the answer (vaults.aws.a, iam.aws.a, security.aws.a); "live" also needs that entry to equal the sha256 of the template the page linked.
- **watch():** every 10 s for the first 2 minutes, then every 30 s, up to 30 minutes by default (CloudFront distributions take minutes, a new DNS name can take longer). Stops on `live` or `mismatch`; `not-answering` and `not-a-vault` keep polling. At most one request in flight; stops when the page is hidden or left (no polling in the background), and the customer presses Check again to resume.
- **What the page shows:** words, never raw response text. Nothing from the answer is put into HTML except the three checked fields, as text.
- **What "live" means** (vaults.aws.a 4a, kept): this address runs a stack made from that template version with that Vault id. Not that the Vault works (the customer's own token check does that), and not that nothing was tampered with.

## 5. The twin: the customer's account answers

Plan step 4 (dev.1.aws.a). Design 02 already has one journal per account; the deploy is the entries the stack creates. For this check the twin needs only:

- **A customer account world** (a second synthetic account id, not 111122223333), seeded empty, which the twin's CloudFormation fold fills when the quick-create link's stack is "created" there (cloudformation.aws.a's twin patch; the stack's events come from design 02's clock, so the twin shows the progress the real page cannot).
- **`<vault-id>.cloudfront.net`-style addresses** made once at write (`rng("cloudfront.ids")`, as EC2's ids), and Route 53 alias records when the twin's phase 2 runs.
- **The transport answers `GET https://<host>/health`** when, and only when, `<host>` is a distribution's address or an alias in a twin account's world and the distribution has the health function: the fixed JSON from the stack's parameters, with the CORS header for the page's origin. Any other host is unanswered (as today: the twin does not answer non-AWS hosts), which the check reports as `not-answering`. Settles (distribution deployed, DNS seen) are clock-driven derivations as in the EC2 note: with the clock paused, `/health` keeps not answering until `tick`.
- **Tests:** the four states over the twin; `endpoint()` refusals as a table; `watch()` stopping on live, on mismatch, on `until` and on abort; no request leaves the test (fetch throws, as in the API tests).

## 6. What this does not do

No reads in the customer's account (iam.aws.a's option B stays a later opt-in). No token, ever: the page never asks for the Vault's access token and never calls the Vault's own API. No DNS resolver in v1. No storage beyond the tab: the Vault id and endpoint live in the URL fragment so a customer can come back, never in a cookie or local storage.

## 8. Revisions agreed

- security.aws.a (16:41Z): agreed own origin, strict CSP, hub untouched, refusal list, no DoH, fetch options; changes taken: (1) v1 `connect-src https://*.cloudfront.net` and CloudFront default addresses only, `https:` with design 06b; (2) `vault_id` `^[0-9a-f]{12}$`; (3) sha256 equals the published index entry; (4) watch() stops when hidden or left, one request in flight.
- vaults.aws.a (16:41Z): agreed section 4; `/health` is exactly `{ vault_id, template_version }`; the CloudFront Function answers before the cache, sends `content-type: application/json` and `Access-Control-Allow-Origin` only; the hint for a pasted Function URL. Vault id settled (16:42Z): vaults.aws.a's design 04 now uses the template's `^[0-9a-f]{12}$`; security.aws.a holds it everywhere (page, `/health`, CloudTrail grouping, IAM names). security.aws.a closed design 05 at 78e4c8e.

## 7. Asks

- **Dinis (D1, to pm.aws.a's batch):** the deploy page on its own origin (recommended; section 2). v1 (CloudFront addresses only) would fit either; design 06b (custom domains) needs its own origin.
- **Dinis:** a public DNS resolver learning the customer's domain: no in v1 (recommended; section 3), or yes with one named resolver.
- **security.aws.a:** agreed with changes (section 8), taken.
- **vaults.aws.a and iam.aws.a:** section 4's field checks against `/health` as agreed (`vault_id` pattern, `template_version` from the index).
- **dev.1.aws.a:** section 5 as part of plan step 4, after the CloudFormation twin patch lands.
- **dev.2.aws.a or dev.1.aws.a (plan step 5):** `DeployCheck` to section 4, with tests, once D1 is decided.
