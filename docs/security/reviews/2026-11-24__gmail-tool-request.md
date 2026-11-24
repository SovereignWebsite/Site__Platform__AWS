# Security review: Factory request for a Gmail tool site (R4 step three)

security.aws.a, 24 November 2026, 00:20 UTC. Asked by a.maestro for a.factory (account A's Factory agent). My key is not yet live on the Factory, so this file on work/security.aws.a is the citable copy. b.security can countersign if Dinis wants it signed on the Factory.

## What I read

- **The request:** SovereignWebsite__Factory, branch work/factory.a-gmail.
  - cd9266f adds `requests/2026-11-23__gmail/site.json`: label gmail, group tool, provider google, kind demo, title "Gmail tool (unofficial)".
  - cb8aeed changes its description to "Unofficial; not affiliated with or endorsed by Google".
- **sites.a's review:** work/factory.a-status 5684d27, `board/a.factory/requests/2026-11-23__gmail-review.md`.
- **Also on the branch, outside the request:** ca8fb19 (a.factory's key) and 7137a81 (a.factory's abp entry). See the last section.
- **Not read:** the brief, 2f58a0b, is not on this branch. Nothing has been built yet, so this review covers the request and sets the conditions the site must meet.

## Verdict

**No objection to the request, with the conditions below.** The site's first deploy needs them in place, and a security review of its code before the first real sign-in.

## The request itself (abuse and prompt-injection review)

- **site.json is clean.** It holds only data fields, with no instructions, links, scripts or names of people. It names no private person, and the wording says plainly that it is unofficial and not Google's. sites.a's review is likewise material only. Nothing in either asks an agent to act.
- **Look-alike risk (Medium, design).**
  - The address gmail.google.tool.sovereignweb.site, a page titled "Gmail" and a Google sign-in button together are what a consent-phishing page looks like.
  - The address follows Dinis's own naming rule, so that choice stays his. If it is kept:
    - no Google logo, colours or Gmail interface on any page;
    - the "Unofficial; not affiliated with or endorsed by Google" line in the header of every page, not only the footer;
    - the OAuth consent screen names the Sovereign Website project and its own privacy page, not Google;
    - the site never asks for a password or a code. Sign-in happens only on accounts.google.com.
- **Restricted scopes.** sites.a's condition 1 is right. gmail.readonly and gmail.send are restricted scopes, so until Google verifies the app it works only for listed test users. The site must say so, and must not claim to be open to everyone.

## Conditions for the site

1. **Tokens in the browser only.**
   - Use a browser-only flow with no client secret: the token model, or the redirect implicit flow.
   - Keep only a short-lived access token, never a refresh token, and keep it in a JavaScript variable only. Nothing goes in localStorage, sessionStorage, IndexedDB, a cookie or the URL after the redirect: clear the #fragment at once.
   - Sign-out revokes the token at Google and clears it from memory.
   - The OAuth client lists exactly the site's address as its origin and redirect.
2. **Least scope, asked when needed.**
   - Read with gmail.readonly.
   - Ask for gmail.send only at the first send (incremental consent).
   - Never ask for mail.google.com/ (full access), gmail.modify or any contacts scope without a separate review.
3. **A strict CSP and no third-party scripts.**
   - `default-src 'none'`
   - `script-src 'self'`, with no inline script and no eval
   - `connect-src 'self' https://gmail.googleapis.com https://oauth2.googleapis.com`
   - `img-src 'self' data:`
   - `style-src 'self'`
   - `frame-ancestors 'none'`
   - `base-uri 'none'`
   - `form-action https://accounts.google.com`

   Google's sign-in library is itself a third-party script. Either use the redirect flow, which needs no Google script, or allow exactly `https://accounts.google.com/gsi/client` as the one exception, recorded as a decision. I recommend the redirect flow.
4. **Mail content is hostile.** This is the main risk for any mail client.
   - Show plain text by default.
   - If HTML is offered, put it in a sandboxed iframe (`sandbox` with no allow-scripts and no allow-same-origin) with its own `default-src 'none'` CSP.
   - Block remote images by default. Tracking pixels report the reader's address, and the platform has no tracking.
   - Never put mail content into innerHTML anywhere. Links open with `rel="noopener noreferrer"`.
5. **Prompt injection through mail.**
   - The site offers /agents/ and llms.txt, so a visitor's own AI may read it. Mail text is untrusted data.
   - Nothing on the page may act on text found in a message.
   - Every send needs a click by the person, on a screen that shows the recipients, the subject and the body as they will go.
   - Never send in bulk. Cap sends per session, for example 20, so a hijacked page cannot spam.
6. **The leak scan covers tokens.** Add these patterns to the site's CI leak scan: Google access tokens (`ya29\.`), refresh tokens (`1//0`), client secrets (`GOCSPX-`) and authorization codes (`4/0`). The client id is public and may be committed.
7. **Demo mode by default.**
   - The page opens on the synthetic twin.
   - Real mode starts only from an explicit "Sign in with Google" by the person, never from a URL parameter alone (compare R-011).
   - The twin holds synthetic mail only and never calls gmail.googleapis.com. The real APIs are reached only after sign-in.
8. **Privacy.**
   - No analytics, no cookies, no server, and nothing about a person's mail leaves their browser except to Google's API.
   - The screenshot or mask mode hides addresses, subjects and bodies.
9. **The site's ABP and provenance.** As in sites.a's conditions 3 and 4, both must exist before the first deploy.

## Outside the request, noted for Dinis's merge

a.factory's abp entry (7137a81) gives it `may_change: team/keys.json`. That is the whole file, which is the trust root, though its note limits it to account A's entries. `needs_dinis_merge` covers the file, which is the real guard. Even so, I recommend that the Factory's checks refuse any change by a.factory to an entry that is not an account A agent's, so the limit is enforced, not only stated.
