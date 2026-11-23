# The board: AWS Platform programme

Kept by pm.aws.a@SovereignWebsite.dinis (from pm.aws.a, 23 Nov 07:30 UTC). Tasks in [tasks.json](tasks.json), each batch of decisions as a presentation and a decision video in [brief/](brief/) (Dinis's rule, 23 Nov ~11:15 UTC), what comes next in [pipeline.md](pipeline.md), questions for Dinis in [decisions.md](decisions.md). Sources: the memo (parts 1 to 4), conductor.aws.a's roster (docs/team/schedule.json, docs/team/stage-2.md, docs/team/handover/) and the agents' own reports.

Updated 2026-11-23 12:20 UTC. Two rules over everything: **twin first** (every feature built and shown on the twin before real AWS) and **usability first** (judged by what a first-time user sees and can do).

> **Wave 2 to account A (23 Nov ~07:30 UTC).** At Dinis's word (~03:31 UTC) conductor, pm, security, architect, s3 and sherpa move to account A as .aws.a; aws.c stays on C as keeper. Owners below now read .a.

## Waiting on Dinis
| Task | Blocked on |
|---|---|
| VD Vault deploy page, EC2, ephemeral deployments (plan ea9f61d) | Batch 2, V1 to V10 |
| SE-4 R-009 High: the deploy's signer check can be bypassed; R-010 High:... | Decisions 2 and 3 |
| PM-5 Every agent signs with its own published key | Decision 1 (landing keys) |
| S3-3 s3.aws.platform.sovereignweb.site and the eight other area sites | Decision 5 (your merge) |
| SE-3 R-001 Critical: the change role can no longer make itself admin... | Decision 4 |
| CT-1 Timeline and per-asset activity; anyone can drop in their own... | Decision 1 (its key); aws.c adding the agent's folder to the policy |
| SE-5 R-008 High: permissions boundary on the change role (P-IAM-001 v2.5, iam.aws.a; cleared by security.aws.a) | Decision 6 |
| VA-2 The vault twin's batch results and conflict rule, as SG/Send's library has them | Decision 8 |

## In progress
| Task | Owner | Next |
|---|---|---|
| UX-0 Walk the hub and 'Try the twin' as a first-time user, desktop and... | sherpa.aws.a | First list: the hub's front page and the S3 browser on the twin |
| PM-1 The board, the pipeline and one decisions page for Dinis | pm.aws.a | Commits its own board now; folds questions in each wake |
| TW-1 The twin as the place everything is built: the whole site works on... | architect.aws.a (design), dev.2.aws.a (build) | Twin v0 is in (5371ed9, fails closed); architect's design 02: packs and scenarios |
| AR-1 The API layer: every primitive as a browser JavaScript API with an... | architect.aws.a, dev.2.aws.a | site/api/: S3 first |
| S3-1 A spectacular, smooth S3 browser | s3.aws.a, dev.1.aws.a | dev.1.aws.a's order (agreed with architect.aws.a): S3-1 items 7 and 9-11, then sherpa W3-5, then design 02 twin steps 1-2 (TW-1); R-016 reader part done locally (e81d2db). All unpushed until decision 7 |
| S3-2 CloudFront-logs zip: normalise the records, view them several ways,... | data.aws.a | Start on the CloudFront logs the twin already seeds (memo 22) |
| LF-1 What each function and stream does, where it writes, traffic; API and... | lambda.aws.a | A first view over the twin's seeded functions and streams |
| CF-1 Every stack mapped to what it made | cloudformation.aws.a | Stacks in the twin, each linked to its resources |
| R53-1 Zones and records mapped to what they serve | cloudformation.aws.a | After CF-1's first view |
| IAM-1 Roles, policies, the trust graph, over-privilege and unused access | iam.aws.a | The hub's own two roles and R-001 first; least-privilege sets per area as proposals for... |
| UI-1 Five complete console designs over one API layer, one of them 3D | ux.aws.a (with design.c) | Five concepts, one page each, judged by a first-time user |
| VA-1 Vaults and append lanes from the browser; three vaults; vaults as the... | vaults.aws.a | A note: how a page creates and appends to a vault, from sgit.ai |
| P1 One request followed through every service, replay, speed, slow,... | viz.aws.a | Confirmed by Dinis (~03:35 UTC): one visitor loads a page on a Sovereign Website... |
| P2 The ontology and taxonomy of every resource, at several altitudes... | ontology.aws.a | The type list and relations over the twin's account; public ontologies reused; schema to... |
| P4 Billing tied to everything, real time from logs, and predicted | billing.aws.a | A price model of the twin's stack from AWS's public pricing pages, each price cited |
| P8 AWS-style launch posts and user-point-of-view articles, drafts for... | journalist.aws.a with sherpa.aws.a | First draft: "Look inside a zip in your S3 bucket without downloading it", user point of... |
| AV-2 The parity tracker, published on the hub | journalist.aws.a | docs/journal/parity.md, eight rows (local 5d5d8f2); "AWS side to confirm" rows checked by... |
| AV-1 A video narrative per major step, with the studio | video.aws.a with studio.c | First: tonight's twin, as a short narrative |
| SW-1 The swarm: the agents as a graph, replayed from 02:40 UTC, on... | swarm.aws.a | Replay of tonight's swarm from public sources only |
| BO-1 Dinis's stack and Boto3 use mapped to browser APIs and least... | boto3.aws.a | S3 first: twin responses against AWS's documentation |
| SE-1 Hourly review: code, design, permissions; attack scenarios for the... | security.aws.a | risks.md; then an attack scenario viz.aws.a can show |
| OP-3 Secure Send S3 API: code, deployment, clients and regions | vaults.aws.a with maestro.c | Asked of maestro.c |

## Waiting for an earlier step
| Task | Owner | Next |
|---|---|---|
| TW-2 'Try the twin' on every area, so anyone can use the consoles without... | ux.aws.a with each area agent | One link pattern, shown first on the S3 browser |
| S3-4 The bucket graph: everything that uses a bucket | ontology.aws.a, s3.aws.a | After the graph schema (P2) |
| CW-1 Logs, metrics and alarms in the browser | cloudtrail.aws.a | After CT-1's timeline |
| EX-1 See, extract, transform, move the CloudFront logs; vault usage visible | data.aws.a | After S3-2 |
| P5 Back and forward in time, everything linked; client-side data and... | data.aws.a, architect.aws.a | Design after S3-2's link mode |
| P6 Ephemeral EC2 infrastructure, with metrics | unassigned | After the IAM area and a security review |
| P7 Access on demand with budgets, limited capabilities and models,... | iam.aws.a, security.aws.a (later) | After P4 and the IAM area |
| SE-2 What data is confidential and what can be public | security.aws.a | After the next review |
| OP-2 A GitHub Actions read-only inventory role | unassigned | Later, after security review |

## Done
- PM-2 Stage 1 and stage 2: 22 agents running (docs/team/schedule.json) (conductor.aws.a)
- PM-4 Each agent's docs path in this site's policy (aws.c)
- QA-1 The hub's tests in test/ (aws.c)
- AV-3 Newsroom brief: the last AWS console log-in (aws.c)

## The team
22 roles, all on account A as <role>.aws.a since wave 2 (23 Nov ~07:30 UTC), at Dinis's word (~03:31 UTC); aws.c stays on account C as keeper of the hub. Wakes and sessions in docs/team/schedule.json. All 22 .aws.a names are in site/policy/abp.json (6ab7233); pushes to dev wait for each key to be live on the Factory (decision 1).

## Changes, newest first
- 23 Nov 17:55 UTC: batch 3 (G1 to G9, guard rails; ec2.aws.a 21ed4a1, security.aws.a d397c1f) with presentation and video; batch 2 now V1 to V12.
- 23 Nov 15:30 UTC: batch 2 (V1 to V10, Vault deploy, EC2, ephemeral) on the decisions page, with its presentation and decision video; steps 1 to 3 drafted (eec9d24, 42677c7, 68f4b8b).
- 23 Nov 15:00 UTC: new work from Dinis (~14:55 UTC): Vault deploy page, EC2, ephemeral deployments (conductor.aws.a's plan, ea9f61d); its six decisions come as one batch once steps 1 to 3 are drafted (VD-14, pm.aws.a).
- 23 Nov 14:20 UTC: decision 3 restated: R-010 widened by 6ab7233 (code paths to site/s3.js and site/twin*.js); recommended now (a), a CI path check (security.aws.a 72f4cee).
- 23 Nov 14:10 UTC: decision 7 answered (all 22 .aws.a names in abp.json, 6ab7233); no .a pushes to dev until keys are live on the Factory.
- 23 Nov 13:45 UTC: decision 8 (vaults.aws.a reads the SG/Send vault library); vaults' other three questions placed under being answered and not needed yet.
- 23 Nov 12:20 UTC: board refreshed: every owner now its .aws.a name (aws.c stays keeper).
- 23 Nov 12:00 UTC: decision 6 back with v2.5 (iam.aws.a ee7f7b9, cleared by security.aws.a ba0afa0); Lambda environment variables readable by the read role, for Dinis to weigh.
- 23 Nov 11:55 UTC: decision 6 on hold for v2.5 (security.aws.a 14433ff: v2.4's read boundary misses 13 reads the API layer needs).
- 23 Nov 11:40 UTC: decision 7 (new): the 21 .aws.a names in abp.json in one word; data.aws.a's landed (518b114).
- 23 Nov 11:25 UTC: decision 7 answered (iam, dev.1 pushed signed; viz unsigned at Dinis's word). Standing rule from Dinis (~11:15 UTC, via maestro.a): every batch of decisions put to him comes with a presentation and a decision video (docs/board/brief/).
- 23 Nov 09:05 UTC: viz.aws.a added to decision 7 (its session refuses making its git signing key).
- 23 Nov 08:45 UTC: dev.1.aws.a's work order on S3-1 recorded (kept as is).
- 23 Nov 08:30 UTC: decision 6 ready for Dinis: security.aws.a cleared P-IAM-001 v2.3 on paper (47b48c3), with three conditions.
- 23 Nov 08:20 UTC: decisions 6 (R-008 boundary, from iam.aws.a) and 7 (branch pushes for iam.aws.a and dev.1.aws.a) added.
- 23 Nov 07:40 UTC: pm.aws.a takes over the board on account A (wave 2); the PM's wake answered (6 h at :15, by maestro.a); decisions down to five.
- 23 Nov 04:05 UTC: account C held until after 06:20 UTC (accountant.c RED).
- 23 Nov 04:00 UTC: pm.aws.a commits the board itself (team paths, c32279d); security's R-009 and R-010 on the decisions page; 16 roles moving to account A; the engine answered (bulletins characters, a pragmatic engine built here); parity tracker with journalist.aws.a.
- 23 Nov 03:35 UTC: stage 2 running (22 agents); every task has a real owner and a first step, twin first; Dinis confirmed the first packet to follow.
- 23 Nov 03:10 UTC: Dinis: no budget cap, Opus and a bit of Sonnet, parallel devs; eight projects in pipeline.md.
- 23 Nov 02:55 UTC: conductor.aws.a's roster and questions; security's first review (R-001 Critical).
- 23 Nov 02:45 UTC: first cut of the board and the decisions page.
