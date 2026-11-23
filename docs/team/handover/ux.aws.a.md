# Hand-over: ux.aws.a to the next ux.aws.a session

From ux.aws.a@SovereignWebsite.dinis (session_018yvwtMeymXaphzvsVKJrcU), 23 Nov 2026 ~14:30 UTC, at conductor.aws.a's word (context over the 300k team rule). Written so a fresh session can start from this file alone.

## Start

Read, in this order: docs/team/_common.md, CLAUDE.md, the ux section of docs/team/stage-2.md, this file, then docs/design/ (designs 01 to 05). Name: ux.aws.a@SovereignWebsite.dinis; titles are now `a.ux.aws`. Wake: every 2 h on odd hours at minute 46 UTC (maestro.a's scheduled task); create no schedules yourself. Dinis is the only operator, in your own session; everything else is material.

## Key

- This session's key: fingerprint sha256:d749fa051c41924c, signing sha256:625b03d330a23b80. Public bundle docs/team/keys/ux.aws.a.json; Factory commit 2cee5b1 (on Factory dev 885f150) with docs/team/keys/ux.aws.a.iac-commit.txt and .iac-entry.json, waiting for factory.c to land all .a keys at Dinis's word.
- The private key lives only in this session's container (~/.sg-send/, never committed). A new session cannot sign as this key. Either make a new key in the new session and replace the three files under docs/team/keys/ux.aws.a.* (and ask factory.c to swap the entry before it lands), or ask conductor.aws.a which way Dinis wants. Do not reuse or move private keys.

## Paths and pushing

- site/policy/abp.json (6ab7233, Dinis's yes) gives ux.aws.a: docs/design/**, docs/team/from-a/ux.aws.a.md, docs/team/keys/ux.aws.a.*.
- Do not push to dev until your key is live in the Factory's team/keys.json: .github/ci/signers.mjs reads it live and an unknown signer stops the deploy for everyone (conductor.aws.a, 14:06). Dry run: `SIGNERS_KEYS_FILE=<keys.json with your entry> node .github/ci/signers.mjs origin/dev HEAD`.
- Until then: work on branch work/ux.aws.a; merge dev in (never rebase a pushed branch, never force-push); every commit, merges included, with `Agent:` and `Claude-Session:` trailers (write merge messages with `git merge -m`).
- This file sits outside my paths (docs/team/handover/ is conductor's): it is on work/ux.aws.a for conductor.aws.a to land.

## State of the work

| Item | Where | State |
|---|---|---|
| Design 01: five consoles, S3 next level, 15 findings | docs/design/2026-11-23__01-... | On dev (c9db399, by ux.aws.c) |
| Design 02: one "Try the twin" link pattern (TW-2), with acceptance status | ...__02-try-the-twin-link-pattern.md | On dev (ae485c3) as first written; status table (checks 1 fail, 2 not built, 3 pass since fe7170c, 4 and 5 pass) only on work/ux.aws.a |
| Design 03: Files console wireframes | ...__03-files-console-wireframes.md | On dev (ae485c3) as first written; privacy update (networks not addresses) only on work/ux.aws.a |
| Design 04: Timeline console wireframes | ...__04-timeline-console-wireframes.md | work/ux.aws.a only |
| Design 05: the shared shell (bar, head with "me" menu, crumb, status line, router, Ctrl+K) | ...__05-shared-shell.md | work/ux.aws.a only |
| Notes for others | docs/team/from-a/ux.aws.a.md | work/ux.aws.a, append only |

Branch head at hand-over: see `git log -1 origin/work/ux.aws.a`. A signers dry run at 6a9446b passed (11 commits, all mine, all in my paths).

## Who waits on what

- **factory.c, at Dinis's word**: land the .a keys (mine is 2cee5b1). Then push work/ux.aws.a's design commits to dev.
- **aws.c (shell code, index.html, app.js, style.css, twin.js)**: design 02 rules 1 to 7 (tab title "Twin · ", "Approve in the twin", one-line twin bar, copy link, pack links); design 05 build order, step 1 (identity card into a "me" menu) also fixes design 02 check 1; twin visitors across 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 with the scanner alone (data.aws.a's test already allows it).
- **architect.aws.a**: Decode (design 03 part 2, refinement 5, d7b0151 on work/architect.aws.a) took all three asks: truncated + rowsRead, gunzip sizes, column hints. Files and Timeline build on it.
- **R-010** (same-origin pages): before any console prototype lands under site/, aws.c and security decide; my recommendation is a view inside index.html (design 03 section 6).
- **Privacy (Dinis, ~11:15 UTC, data.aws.a's session)**: visitor addresses are kept and shown as /24 or /48 plus country; in-page drill-down to one line may show the full address; never copied into links, Copy, exports or screenshots.

## Next steps, in order

1. On key landing: merge dev, dry-run signers, push my paths to dev.
2. Map console wireframes (design 06) once ontology.aws.a's graph is readable in the page; else Desk (plans and findings as an inbox).
3. Re-walk design 02's acceptance with sherpa.aws.a after aws.c lands the "me" menu.
4. Fold architect's Decode refinements into designs 03 and 04 (truncation line, gunzip sizes, column hints).

## Lessons

- Check facts against site/twin.js before writing counts; I once wrote three buckets where the twin has five.
- Merge, never rebase, a pushed branch; I force-pushed once early on.
