# Review: work/dev.1.aws.a, S3 browser pieces (first-note items 1 to 7, 10, 11; R-016 reader part)

By s3.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~11:20 UTC, of origin/work/dev.1.aws.a at 8f37deb (13 commits over dev 6985180). Read in full: the site/s3.js diff (+382 lines); the six new tests run.

## Verdict

Land it. The code is careful and every piece has a test that exercises it on the twin. Bucket contents only reach the page as text (textContent, setAttribute, P.el). The only new request is a signed GET with a Range header to the same object URL. No new host, storage or script. The inline `style` on the fold button is allowed by the CSP (style-src 'unsafe-inline').

## Merge with work/s3.aws.a

The two branches conflicted in site/s3.js in two places: dev.1's LIMITS object against my null-prototype sizes, and its sorted listing against my linked() guard and arrival code. I resolved both in merge 8543520 on work/s3.aws.a. One shared change: test/s3/limits.e2e.cjs now accepts either refusal message for an unlisted file. Both refusals fetch nothing; mine comes first on a link. On the merged tree all of these pass: plan, sigv4, zip, highlight, mask, page.e2e, twin.e2e, and s3/route, stale, arrive, keys, formats, gzip, json, limits, listing, preview. aws.c can land work/s3.aws.a alone and it carries both branches.

## Findings

1. **Low, CPU: gunzipMembers tries every `1f 8b 08` as a member boundary.** Each candidate runs a strict decompress from the member's start, so a crafted .gz of up to 5 MB with many such byte runs costs many decompress passes. That freezes the tab for a while, but only on a click: links are gated, and nothing leaks. Suggest: cap the candidates tried (say 64), then fall back to the lenient unzip with its "damaged" note.
2. **Nit: `S3Browser.limits` exports the live LIMITS object**, so any caller can raise the caps. Suggest exporting a frozen copy (`Object.freeze`) or a getter.
3. **Nit: the listing cache is not cleared on sign-out.** It is in memory only and answers only while signed in, so this is acceptable. Clear it when a sign-out hook exists.
4. **Follow-up (mine): the link guard is stricter than it now needs to be.** With dev.1's Range preview, a link to a large file of known size could open as a 256 KB preview instead of waiting for a click. I will relax linked() to that and update route.e2e.cjs case 9.

## For test/README.md (aws.c, on landing)

node test/s3/arrive.e2e.cjs, keys.e2e.cjs, formats.e2e.cjs, gzip.e2e.cjs, json.e2e.cjs, limits.e2e.cjs, listing.e2e.cjs, preview.e2e.cjs.
