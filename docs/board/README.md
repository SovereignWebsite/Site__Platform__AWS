# The board: AWS Platform programme

Kept by pm.aws.a@SovereignWebsite.dinis (from pm.aws.c, 23 Nov 07:30 UTC). Tasks in [tasks.json](tasks.json), what comes next in [pipeline.md](pipeline.md), questions for Dinis in [decisions.md](decisions.md). Sources: the memo (parts 1 to 4), conductor.aws.c's roster (docs/team/schedule.json, docs/team/stage-2.md, docs/team/handover/) and the agents' own reports.

Updated 2026-11-23 04:00 UTC. Two rules over everything: **twin first** (every feature built and shown on the twin before real AWS) and **usability first** (judged by what a first-time user sees and can do).

> **Wave 2 to account A (23 Nov ~07:30 UTC).** At Dinis's word (~03:31 UTC) conductor, pm, security, architect, s3 and sherpa move to account A as .aws.a; aws.c stays on C as keeper. Owners below still read .c until the full refresh on pm.aws.a's next wake.

## Waiting on Dinis
| Task | Blocked on |
|---|---|
| SE-4 R-009 High: the deploy's signer check can be bypassed; R-010 High:... | Decisions 2 and 3 |
| PM-5 Every agent signs with its own published key | Decision 1 (landing keys) |
| S3-3 s3.aws.platform.sovereignweb.site and the eight other area sites | Decision 5 (your merge) |
| SE-3 R-001 Critical: the change role can no longer make itself admin... | Decision 4 |
| CT-1 Timeline and per-asset activity; anyone can drop in their own... | Decision 1 (its key); aws.c adding the agent's folder to the policy |

## In progress
| Task | Owner | Next |
|---|---|---|
| UX-0 Walk the hub and 'Try the twin' as a first-time user, desktop and... | sherpa.aws.c | First list: the hub's front page and the S3 browser on the twin |
| PM-1 The board, the pipeline and one decisions page for Dinis | pm.aws.c | Commits its own board now; folds questions in each wake |
| TW-1 The twin as the place everything is built: the whole site works on... | architect.aws.c (design), dev.2.aws.c (moving to dev.2.aws.a) (build) | Twin v0 is in (5371ed9, fails closed); architect's design 02: packs and scenarios |
| AR-1 The API layer: every primitive as a browser JavaScript API with an... | architect.aws.c, dev.2.aws.c (moving to dev.2.aws.a) | site/api/: S3 first |
| S3-1 A spectacular, smooth S3 browser | s3.aws.c, dev.1.aws.a | dev.1.aws.a's order (agreed with architect.aws.a): S3-1 items 7 and 9-11, then sherpa W3-5, then design 02 twin steps 1-2 (TW-1); R-016 reader part done locally (e81d2db). All unpushed until decision 7 |
| S3-2 CloudFront-logs zip: normalise the records, view them several ways,... | data.aws.c (moving to data.aws.a) | Start on the CloudFront logs the twin already seeds (memo 22) |
| LF-1 What each function and stream does, where it writes, traffic; API and... | lambda.aws.c (moving to lambda.aws.a) | A first view over the twin's seeded functions and streams |
| CF-1 Every stack mapped to what it made | cloudformation.aws.c (moving to cloudformation.aws.a) | Stacks in the twin, each linked to its resources |
| R53-1 Zones and records mapped to what they serve | cloudformation.aws.c (moving to cloudformation.aws.a) | After CF-1's first view |
| IAM-1 Roles, policies, the trust graph, over-privilege and unused access | iam.aws.c (moving to iam.aws.a) | The hub's own two roles and R-001 first; least-privilege sets per area as proposals for... |
| UI-1 Five complete console designs over one API layer, one of them 3D | ux.aws.c (moving to ux.aws.a) (with design.c) | Five concepts, one page each, judged by a first-time user |
| VA-1 Vaults and append lanes from the browser; three vaults; vaults as the... | vaults.aws.c (moving to vaults.aws.a) | A note: how a page creates and appends to a vault, from sgit.ai |
| P1 One request followed through every service, replay, speed, slow,... | viz.aws.c (moving to viz.aws.a) | Confirmed by Dinis (~03:35 UTC): one visitor loads a page on a Sovereign Website... |
| P2 The ontology and taxonomy of every resource, at several altitudes... | ontology.aws.c (moving to ontology.aws.a) | The type list and relations over the twin's account; public ontologies reused; schema to... |
| P4 Billing tied to everything, real time from logs, and predicted | billing.aws.c (moving to billing.aws.a) | A price model of the twin's stack from AWS's public pricing pages, each price cited |
| P8 AWS-style launch posts and user-point-of-view articles, drafts for... | journalist.aws.c (moving to journalist.aws.a) with sherpa.aws.c | First draft: "Look inside a zip in your S3 bucket without downloading it", user point of... |
| AV-2 The parity tracker, published on the hub | journalist.aws.c (moving to journalist.aws.a) | docs/journal/parity.md, eight rows (local 5d5d8f2); "AWS side to confirm" rows checked by... |
| AV-1 A video narrative per major step, with the studio | video.aws.c (moving to video.aws.a) with studio.c | First: tonight's twin, as a short narrative |
| SW-1 The swarm: the agents as a graph, replayed from 02:40 UTC, on... | swarm.aws.c (moving to swarm.aws.a) | Replay of tonight's swarm from public sources only |
| BO-1 Dinis's stack and Boto3 use mapped to browser APIs and least... | boto3.aws.c (moving to boto3.aws.a) | S3 first: twin responses against AWS's documentation |
| SE-1 Hourly review: code, design, permissions; attack scenarios for the... | security.aws.c | risks.md; then an attack scenario viz.aws.c can show |
| OP-3 Secure Send S3 API: code, deployment, clients and regions | vaults.aws.c (moving to vaults.aws.a) with maestro.c | Asked of maestro.c |

## Waiting for an earlier step
| Task | Owner | Next |
|---|---|---|
| TW-2 'Try the twin' on every area, so anyone can use the consoles without... | ux.aws.c (moving to ux.aws.a) with each area agent | One link pattern, shown first on the S3 browser |
| S3-4 The bucket graph: everything that uses a bucket | ontology.aws.c (moving to ontology.aws.a), s3.aws.c | After the graph schema (P2) |
| CW-1 Logs, metrics and alarms in the browser | cloudtrail.aws.c (moving to cloudtrail.aws.a) | After CT-1's timeline |
| EX-1 See, extract, transform, move the CloudFront logs; vault usage visible | data.aws.c (moving to data.aws.a) | After S3-2 |
| P5 Back and forward in time, everything linked; client-side data and... | data.aws.c (moving to data.aws.a), architect.aws.c | Design after S3-2's link mode |
| P6 Ephemeral EC2 infrastructure, with metrics | unassigned | After the IAM area and a security review |
| P7 Access on demand with budgets, limited capabilities and models,... | iam.aws.c (moving to iam.aws.a), security.aws.c (later) | After P4 and the IAM area |
| SE-2 What data is confidential and what can be public | security.aws.c | After the next review |
| OP-2 A GitHub Actions read-only inventory role | unassigned | Later, after security review |

## Done
- PM-2 Stage 1 and stage 2: 22 agents running (docs/team/schedule.json) (conductor.aws.c)
- PM-4 Each agent's docs path in this site's policy (aws.c)
- QA-1 The hub's tests in test/ (aws.c)
- AV-3 Newsroom brief: the last AWS console log-in (aws.c)

## The team
22 agents; wakes and sessions in docs/team/schedule.json. Sixteen roles are moving to account A tonight (account C is hot), as <role>.aws.a: billing, boto3, cloudformation, cloudtrail, data, dev.1, dev.2, iam, journalist, lambda, ontology, swarm, ux, vaults, video, viz. Staying on C: conductor, pm, security, architect, s3, sherpa, and aws.c (keeper of the hub).

## Changes, newest first
- 23 Nov 09:05 UTC: viz.aws.a added to decision 7 (its session refuses making its git signing key).
- 23 Nov 08:45 UTC: dev.1.aws.a's work order on S3-1 recorded (kept as is).
- 23 Nov 08:30 UTC: decision 6 ready for Dinis: security.aws.a cleared P-IAM-001 v2.3 on paper (47b48c3), with three conditions.
- 23 Nov 08:20 UTC: decisions 6 (R-008 boundary, from iam.aws.a) and 7 (branch pushes for iam.aws.a and dev.1.aws.a) added.
- 23 Nov 07:40 UTC: pm.aws.a takes over the board on account A (wave 2); the PM's wake answered (6 h at :15, by maestro.a); decisions down to five.
- 23 Nov 04:05 UTC: account C held until after 06:20 UTC (accountant.c RED).
- 23 Nov 04:00 UTC: pm.aws.c commits the board itself (team paths, c32279d); security's R-009 and R-010 on the decisions page; 16 roles moving to account A; the engine answered (bulletins characters, a pragmatic engine built here); parity tracker with journalist.aws.c.
- 23 Nov 03:35 UTC: stage 2 running (22 agents); every task has a real owner and a first step, twin first; Dinis confirmed the first packet to follow.
- 23 Nov 03:10 UTC: Dinis: no budget cap, Opus and a bit of Sonnet, parallel devs; eight projects in pipeline.md.
- 23 Nov 02:55 UTC: conductor.aws.c's roster and questions; security's first review (R-001 Critical).
- 23 Nov 02:45 UTC: first cut of the board and the decisions page.
