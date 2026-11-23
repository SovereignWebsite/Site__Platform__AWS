# The board: AWS Platform programme

Kept by pm.aws.c@SovereignWebsite.dinis. The tasks are in [tasks.json](tasks.json); the questions for Dinis are in [decisions.md](decisions.md). Source: the memo (docs/2026-11-23__memo-aws-platform-programme.md), conductor.aws.c's roster (docs/team/schedule.json) and each agent's own reports. An owner is named only when that agent exists; "(not started)" means planned, not running.

Updated 23 Nov 2026, 03:10 UTC. What comes next, in order: [pipeline.md](pipeline.md).

## The team running now
| Agent | Wakes (UTC) | First task |
|---|---|---|
| conductor.aws.c | :58 every 4 h | Coordinates; roster in docs/team/ |
| security.aws.c | :28 every 2 h | Review of the change role; docs/security/risks.md |
| architect.aws.c | :38 every 3 h | API layer and twin, S3 first; docs/architecture/ |
| s3.aws.c | :53 every 3 h | Smoothness note and next three steps; docs/s3/ |
| aws.c | as now | Keeper of the hub; AWS plans |
| pm.aws.c | every 2 h at :15, if Dinis says yes (Decision 6) | This board and the pipeline |

## Running now
| Task | Owner | State | Next |
|---|---|---|---|
| SE-1 Hourly security review | security.aws.c | in progress | 7 risks found; R-001 Critical |
| S3-1 Smooth S3 browser | s3.aws.c | in progress | Smoothness note, next three steps |
| S3-2 CloudFront logs readable | aws.c | in progress | gzip, JSON Lines, CSV |
| AR-1, TW-1 API layer and the twin | architect.aws.c | in progress | Design, S3 first |
| IAM-2 Template v3 as a plan | architect.aws.c, security.aws.c | starting | Draft, review, then Dinis's Approve |
| AV-2 Parity tracker | pm.aws.c | in progress | Seeds from aws.c |
| OP-3 Secure Send S3 API facts | maestro.c, conductor.aws.c | in progress | Asked by aws.c |

## Blocked, and on what
| Task | Blocked on |
|---|---|
| PM-5 Agents sign with their own keys | Decision 1 |
| SE-3 Cut the change role's iam:* (R-001) | Decision 2 |
| PM-4, PM-1 Team paths in the site policy; this board | Decision 3 |
| OP-1 Waiting stack plan | Decision 4 |
| QA-1 Tests into test/ | Decision 5 |
| LF-1, CF-1, R53-1, IAM-1, CT-1, CW-1, UI-1, VA-1, EX-1, AV-1; P1, P2, P4, P5, P8 | Their agents starting (stage 2, now; no budget cap) |
| S3-3 s3.aws.platform.sovereignweb.site | The nine area sites (not urgent) |

## In Dinis's order
1. **S3:** S3-1, S3-2 running; S3-3 site; S3-4 bucket graph (after AR-1).
2. **Lambda with Firehose:** LF-1. 3. **CloudFormation:** CF-1. 4. **Route 53:** R53-1. 5. **IAM:** IAM-1; IAM-2 starting; SE-3. 6. **CloudTrail:** CT-1. 7. **CloudWatch:** CW-1. All in stage 2, starting now.
8. **The five consoles:** UI-1. 9. **The vaults:** VA-1. 10. **The extract workflow:** EX-1, after S3-2. All in stage 2.
11. **The twin:** TW-1, AR-1 running.
12. **Articles and videos:** AV-1 (journalist starting now); AV-2 running; AV-3 done.

## Changes, newest first
- 23 Nov 04:00 UTC (aws.c, at commit): QA-1 done (tests in test/, Dinis's yes); TW-1 twin v0 live (5371ed9), failing closed (this commit); SE-3 template v2.1 written (d67b560), for security's review then Dinis's Approve.
- 23 Nov 03:10 UTC: Dinis: no budget cap, Opus and a bit of Sonnet, parallel devs; stage 2 and the journalist start now; eight new projects in pipeline.md (follow the packet, the fractal graph, vaults, billing, time lapse, EC2, scoped access, launches).
- 23 Nov 02:55 UTC: conductor.aws.c's roster and questions; security's first review (R-001 Critical); decisions reordered by urgency (pm.aws.c).
- 23 Nov 02:50 UTC: aws.c's decisions folded in. Only aws.c may commit here, so it commits the board meanwhile.
- 23 Nov 02:45 UTC: first cut of the board and the decisions page.
