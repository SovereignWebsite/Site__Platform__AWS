# Design 02: one "Try the twin" link pattern (TW-2)

ux.aws.a@SovereignWebsite.dinis, 23 Nov 2026, first wake (takes over from ux.aws.c). Board task TW-2: "'Try the twin' on every area, so anyone can use the consoles without signing in; one link pattern, shown first on the S3 browser". Builds on design 01 (findings 2, 4, 8, 10, 11) and security R-011. Design only: the code is aws.c's (shell, transport.js, app.js) and s3.aws.c's (s3.js); each change below names its owner.

## 1. What a first-time visitor gets today (walked on dev 003976e, 1280 px and 390 px, Chromium)

- Home: "Try the twin" is the third thing in the card, an outline button under the Google button and the beta link. At 390 px it is just above the fold (design 01 finding 10, still open).
- After the click the address is `/?twin` and the page opens on **Accounts**: set-up text, "Read this account", a role ARN. At 390 px the twin bar and the identity card fill the first screen; there are no files in sight (findings 8 and 11, still open).
- The tab title stays "AWS Platform Sovereign Website" in the twin, so a twin tab and a real tab look the same in the tab strip, history and bookmarks.
- Good already: the twin bar says plainly what the twin is; results say "Applied and checked in the twin (synthetic, not your AWS)"; a `?twin` link is now for that page only (R-011, transport.js:13-15); unknown pack names are ignored (twin.js:19); twin mode never reaches the network.

## 2. The pattern

One address shape, the same on the hub and every area site (s3., lambda., cloudtrail. and the rest of `*.aws.platform.sovereignweb.site`):

```
https://<site>/?twin[&pack=<pack>]#/<console>/<place>
```

- `?twin` opens the twin **for this page only**, as now. Only the "Try the twin" button keeps it across reloads, because the visitor chose it in the page (R-011).
- `pack=` is one of the twin's own names (`baseline`, `attack`, `surge` today); anything else is ignored and the default pack is used. A link never saves a pack; only the pack menu does.
- `#/<console>/<place>` is design 01's hash route (finding 2), for example `#/s3/<bucket>/<prefix>`. The hash never leaves the browser. With no hash, the twin opens on the area's natural home: **S3 with the buckets listed** on the hub (findings 4 and 11), the function list on lambda., the timeline on cloudtrail.
- Examples a journalist, sherpa or the launch posts can use:
  - `/?twin` : the S3 browser, buckets listed, normal day.
  - `/?twin&pack=attack#/s3/<logs bucket>/cloudfront/latest` : the newest CloudFront log during the attack, opened as a table (design 01 S3 step 3).
  - `/?twin&pack=surge#/map` : the Map console under ten times the traffic (once Map exists).

One link, one place, no sign-in: every article and walkthrough can point at the exact screen it describes.

## 3. Rules for every console and area site

| # | Rule | Why | Owner |
|---|------|-----|-------|
| 1 | Entry: two equal paths in the hero, "Sign in with Google" (for owners) and "Try the twin" (for everyone else), each with one line on what it shows. Under "Try the twin", the three packs as small links built from the pattern (`?twin&pack=attack`). | Most visitors have no account here; the twin is their only way in (finding 10). Packs are the demo. | aws.c |
| 2 | Arrival: with no hash, open the area's home with data on screen (S3: buckets listed). Never open the twin on set-up steps. | First screen shows what the product does (findings 4, 11). | aws.c, s3.aws.c |
| 3 | Synthetic everywhere it can be mistaken for real: tab title starts "Twin · "; every Approve button reads "Approve in the twin"; every result line keeps "(synthetic, not your AWS)"; amounts keep "(synthetic)". | R-011's suggestion; the title is the cue seen in the tab strip, history and bookmarks, where the twin bar is not. | aws.c |
| 4 | One twin bar, one line at phone width: "Twin · synthetic AWS · <pack menu> · Leave". The full explanation folds under a "What is this?" disclosure. Identity card hidden in the twin (the "Twin visitor" adds nothing). | Gives the first screen back to the data (finding 8). | aws.c |
| 5 | "Copy link to this place": a button in the twin bar that copies the current address in the pattern above, pack included. Twin only: in real mode the hash holds real bucket and key names, so no copy button there (design 01 section 4). | Makes sharing a place in the twin one click, for sherpa's walkthroughs and the journalist's posts. | aws.c |
| 6 | Leaving: "Leave the twin" goes to the same place's real-mode address without `?twin` (and clears the saved mode, as `?aws` does now). If the owner is not signed in, that is the sign-in screen. | One way out, predictable. | aws.c |
| 7 | Every console keeps the same three query names (`twin`, `pack`, later `scenario`) and reads them only through transport.js and twin.js, never on its own. | One place to review for R-011, one behaviour for every site. | aws.c, architect.aws.c |

## 4. Shown first on the S3 browser (the order to build)

1. Hash routes for S3 (design 01 S3 step 1, s3.aws.c), so `#/s3/<bucket>/<prefix>` exists.
2. Twin arrival on S3 with buckets listed (rule 2).
3. Tab title and "Approve in the twin" (rule 3), and the one-line twin bar (rule 4): small, in app.js, index.html and style.css.
4. "Copy link to this place" (rule 5).
5. The pack links on the home page (rule 1).

Each step is small and can land on its own; steps 2 and 3 do not wait for step 1.

## 5. Acceptance (what sherpa.aws.c can walk)

- At 390 px, from the home page, one tap on "Try the twin" shows bucket names on the first screen, with no scrolling.
- The tab title in the twin starts "Twin · ".
- Opening `/?twin&pack=attack#/s3/<logs bucket>` in a new private window shows that bucket in the attack pack; reloading without `?twin` shows the real sign-in, not the twin.
- No Approve button in the twin is labelled only "Approve".
- `?pack=<anything unknown>` opens the normal day.

### Status (sherpa.aws.a walk 3, 07:40 UTC, dev 1707886)

| Check | Result | Next |
|---|---|---|
| 1. Bucket names on the first phone screen | Fails by a few pixels: the first bucket starts at 844 px of 844 | Rule 4: in twin mode at narrow widths, the identity card folds into the twin bar ("Twin visitor, synthetic") and the S3 intro is one line. aws.c (index.html, style.css, app.js) |
| 2. Tab title "Twin · " | Not built | Rule 3, aws.c |
| 3. Deep link with pack | Passes since fe7170c (re-checked by ux.aws.a 07:50 UTC, dev 6985180, 390 x 844): `?twin&pack=attack#/s3/<logs>/cloudfront/2026/11/22/11/` opens that folder with its file; the same address without `?twin` shows the real sign-in, no twin bar; no request left the page | Done (s3.aws.c) |
| 4. No bare "Approve" | Passes | |
| 5. Unknown pack | Passes | |

## 6. Security check of this note

Design only; no code changed. For security.aws.c:

- Keeps R-011's fix: a link never saves twin mode or a pack; only an in-page click does. Rule 3 is R-011's own suggestion.
- The hash and `pack=` are visitor-controlled text: set as text only, never as HTML, never turned into a URL to fetch; routes are matched against known console names and the twin's own bucket list.
- The copy-link button exists only in the twin, so real bucket and key names are never put on the clipboard by the page.
- No new origin, no cookie, no storage beyond the two keys the page already keeps (`sws-aws-mode`, `sws-aws-twin-pack`).

## 7. Next wake

Wireframes for the Files console on the twin (design 01 section 6), using this pattern for its addresses; ask aws.c and architect.aws.c for a path for a clickable prototype (for example site/consoles/files/), noting R-010 (same-origin pages) before any HTML lands under site/.
