# Designs: index

Kept by ux.aws.a@SovereignWebsite.dinis. This is one place to see every design note in this folder: what it is for, who builds it, what exists and what is open. The notes are Markdown, design only. Code belongs to the owners named, and HTML design pages live in site/designs/ under their own rules. State as of 23 Nov 2026 ~21:50 UTC: dev at 5f187c4. The landing branch for these notes is land/ux.aws.a (until it lands, 01 to 03 are on dev and 04 to 09 only on that branch).

| # | Design | What it settles | Builders | Built so far | Open |
|---|---|---|---|---|---|
| 01 | [Five consoles and S3 next](2026-11-23__01-five-consoles-and-s3-next.md) | Five complete UIs (Files, Map, Timeline, Desk, Command), each for one way of working, and 15 findings on the hub | aws.c, s3.aws.a | S3 hash routes (fe7170c) | the rest follows 03 to 09 |
| 02 | [Try the twin link pattern](2026-11-23__02-try-the-twin-link-pattern.md) | One `?twin[&pack=]#/<console>/<place>` pattern, the twin bar, "Twin · " in the tab title | aws.c | check 3 passes; 4 and 5 pass | check 1 (first data below the fold at 390 px, fixed by 05 step 1); check 2 (tab title); re-walk with sherpa.aws.a |
| 03 | [Files console](2026-11-23__03-files-console-wireframes.md) | Folders, date strip, a log as a table, privacy (networks, not addresses), what the header line says (Decode) | aws.c, dev.1.aws.a, s3.aws.a | Decode on dev (site/api/decode.js, 461d422) | the console itself |
| 04 | [Timeline console](2026-11-23__04-timeline-console-wireframes.md) | Three lanes, brush, "Worth a look", drop in your own trail | aws.c, cloudtrail.aws.a, data.aws.a | Decode for dropped trails | the console itself |
| 05 | [Shared shell](2026-11-23__05-shared-shell.md) | The frame every console sits in: bar, head with a "me" menu, crumb, status line, one router, Ctrl+K | aws.c | not yet | step 1 (the "me" menu) also fixes 02 check 1 |
| 06 | [Vault deploy page](2026-11-23__06-vault-deploy-page.md) | Region, one link-out, paste the Endpoint, done; cost line, optional alarm, pause and restore | dev.2.aws.a, dev.1.aws.a | logic in site/api/vault-deploy.js (work/dev.2.aws.a.vault-deploy); stacks on dev (dc2d80e) | **Dinis**: section 1a (one stack by default, least-privilege opt-in, R-022 Low) and V1 (where the page lives); the twin customer account (dev.1.aws.a) |
| 07 | [Map console](2026-11-23__07-map-console-wireframes.md) | A node's card first, a one-hop picture, the altitude ladder, Worth a look; no actions | aws.c, dev.2.aws.a | graph.js on dev; `Graph.rules` and `neighbours` on dev.2.aws.a's branches | `neighbours` grouped by relation, after ontology.aws.a's relation-readings.json lands |
| 08 | [Desk console](2026-11-23__08-desk-console-wireframes.md) | One inbox of Plans, Findings, Questions and For information; only Plans change anything, through today's plan flow | aws.c, dev.2.aws.a, iam.aws.a | `Graph.rules` (856185b); iam.aws.a's rules v1.1 written | the console; IAM rules in code; no durable "accept" in v1 |
| 09 | [Command console](2026-11-23__09-command-console-wireframes.md) | Commands generated from the API contracts, read only, results as cards, Ctrl+K | aws.c, dev.2.aws.a | commands.json (28 commands) and the parser site/api/command-line.js (work/dev.2.aws.a.vault-deploy); the alias table drawn | the console; the alias test |

## Rules every design here keeps

- Twin first: every screen is drawn on the twin's real names and works there before any real account.
- Nothing invented: counts, prices and times come from the twin, a cited file or a measurement, or show as "n" until they do.
- Untrusted data is text: anything read from an account, a file or an answer is set as text, never HTML, and capped.
- Privacy: visitor addresses appear as networks (/24, /48) and country, and are never copied out (Dinis, 23 Nov ~11:15 UTC).
- No cookies, no storage of what a person does, no tracking (CLAUDE.md). Addresses carry ids only.
- Only a Plan, approved by the owner, changes AWS. No console adds another way.
- Every design is reviewed by security.aws.a before it lands. The reviews are on work/security.aws.a.
