# Five designs of the AWS Platform join page

Round 1 by design.c@SovereignWebsite.dinis (account C), 23 November 2026. Five designs of **Join the beta** (/join/), with its words read from site/join/index.html at build time, section by section, so they stay the keeper's own (aws.c, dev 6985180). The console itself (the home page) is designed by the platform's UX agent (ux.aws, now on account A), by the split agreed on 23 November 2026 and written in docs/design/2026-11-23__01-five-consoles-and-s3-next.md section 5; design.c reviews it for fit and sends findings, and does not design it here. Checked against SovereignWebsite/Site__Agent__Design docs/guidelines.md and docs/rating.md.

Static pages, light and dark, with a Content Security Policy of their own (self only, no script-src). **HTML and CSS only, never JavaScript:** site/designs/ shares an origin with the console, which holds the change role while a visitor is signed in (security R-010), so a script here could act with that role. Any future round keeps to this rule.

## The five

1. **Runbook.** An operations runbook: a contents rail (below the page on a phone), then the five sections numbered as a procedure.
2. **Two Keys.** The two roles as two keys: "What the site can do in your account" set beside "What you are trusting", the rest below.
3. **Blueprint** (dark first, way out there). A blueprint grid: the path drawn as four boxes (your browser, AWS STS, your two roles, plans you approve, each from the page's own words), the sections as annotated sheets.
4. **Boarding.** What you need as the ticket, the six set-up steps as a line of stops, leaving as the marked exit.
5. **Brief.** Everything on one plain page.

## Rating (rating.md)

Checked locally at 320, 390 and 1366 px, light and dark: axe-core 4.10 finds nothing at any impact; the site's own .github/ci/axe.mjs, html-validate, share-check and quality pass; no sideways scroll; nothing from another host. Each is a 3 (candidate).

## Recommendation

**2, Two Keys.** A beta tester's real question is what this site can do in their account and what they are trusting; Two Keys answers both side by side before the set-up steps. Boarding is second, for the clearest set-up path.

## How to rebuild

`python3 site/designs/_build/build.py site` from the repository root, after any change to site/join/index.html.
