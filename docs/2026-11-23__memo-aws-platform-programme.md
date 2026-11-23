# Memo: the AWS Platform programme

Written by aws.c@SovereignWebsite.dinis, 23 November 2026 ~02:30 UTC, from Dinis Cruz's words in aws.c's session the same night (summarised faithfully; his quotes marked). For the conductor (conductor.c), maestro.c, strategy and every agent who joins this work. Dinis said more is coming; this memo is the first part and will be updated.

## 1. Why now

Tonight the AWS Platform Sovereign Website (aws.platform.sovereignweb.site) proved the pieces: Google sign-in to one-hour AWS credentials in the browser (no keys, no server); roles written as CloudFormation that are the mandate; every change a plan with a diff, applied only on the owner's Approve, including updates to the stack itself; the sealed store; and an S3 browser that reads inside zips by byte ranges and unzips .json.gz in the page.

Dinis: "we think we have the piece of the puzzles to do something quite spectacular and something that is going to unblock so many different things I wanted to do for a long time that just weren't automated." "There's also tons of stuff that before never scaled that now are going to scale."

## 2. What we are building

1. **A spectacular, smooth S3 browser**, first. Then the extract workflow on real data (below).
2. **The capabilities of the AWS stack Dinis uses, as APIs**: every primitive he uses (he will list the stack) as a JavaScript API in the browser, described by an OpenAPI ("Swagger") document, with the permissions each needs added to the roles as reviewed plans. This replaces much of what he does today with Boto3. Dinis: "I want to use this to clean up AWS for me and really map a lot of the stuff that I access using Boto 3".
3. **The Secure Send S3 API, automated.** It is the foundation of the vault, and "has been a mess because it just needed that extra bit of automation ... that extra bit of UI". It must scale: Dinis's clients need to deploy it themselves, in many regions.
4. **Five complete AWS console designs.** "not just different themes. This has to be 5 different complete UIs", each "100% focus[ed] on how I use, on the technology that I use, on the capabilities that I use", built on semantic knowledge graphs. This is why the code must be thoroughly refactored: one API layer, five UIs over it.
5. **Data from AWS, and data kept in vaults.** Some information is read live from AWS; some is temporal, so a snapshot is taken and saved to a vault. Vaults can be read in several ways with different performance; append lanes scale writes.
6. **The extract workflow.** Start with the bucket of CloudFront logs written by Firehose: see what is there, then extract, transform and move the data. The aim is visibility of what the websites behind S3 are doing, "including all of the ... vault usage, including what vaults are being accessed". This becomes critical as vaults are made for medical users. Later, Firehose itself may not be needed.
7. **The twin.** A replica of AWS that answers the same endpoints with synthetic data. "the code either hits the AWS from the browser ... or it hits the twin, but the code should not know the difference." It makes everything testable and demonstrable without touching a real account.
8. **Explaining it.** Visualisations, architecture diagrams, articles (some in Dinis's voice, some in the agents' own voice, following the site's article guidance) and, for every major step, a video narrative made with the studio from the real thing, reviewed, then published (Instagram among others).

## 3. Quality and security

- Code quality follows the principles Dinis has written (his sites on coding, NFRs, AI and others; the developer and architect find and apply them).
- Everything is open source and public: "we have very little margin for error". Lock it down as far as possible.
- **Security every hour**, with three distinct views: a security agent, an AppSec agent and an adversarial agent. Reviews of code, design and permissions only: "Don't want to do pen testing, don't want to do live testing".

## 4. The team

Dinis named: a PM, a designer, an AWS / Boto3 expert, a UX lead, a data scientist, a developer and an architect; plus the security, AppSec and adversarial agents, and a video and narrative agent working with the studio. aws.c stays as the AWS platform agent and keeper of this site's repository. Each new agent publishes its own key and gets its policy entry the usual way.

## 5. How agents work: wake, work, sleep

Dinis: it "works better to let the agents wake up at specific intervals ... they wake up, they figure out what they need to do, they do the work, and they go down."

Every wake-up runs the same loop, every time:

1. **Conductor**: what is claimed, what changed, what this agent should do now.
2. **Security**: the current risks and anything blocking this agent's area.
3. **The work.**
4. **Security**: review of what was just done, before it ships.
5. **Conductor**: report, update claims, hand-offs.

Schedules: aggressive at first ("for now I would like you to be quite aggressive"), some agents hourly, some every couple of hours, some chained so one follows another. An agent with nothing to do backs off and lengthens its own interval; any agent can be woken early when needed. The security agent runs every hour.

## 6. Proposed first schedule (for the conductor to set, at Dinis's word)

| Agent | Wakes | First job |
|---|---|---|
| PM | hourly | Turn this memo into a board of claimed tasks; keep it current |
| Security | hourly | Review the site as it stands (CSP, sealed store, roles, plans); keep a risk list |
| AppSec | every 2 h, after security | Code review of each change since its last run |
| Adversarial | every 2 h, offset | Try to break the design on paper: roles, trust, plans, CORS, supply chain |
| Architect | every 2 h | The API layer, OpenAPI, the twin's design, the refactor for five UIs |
| Developer | hourly, after architect | Build to the architect's design, with tests |
| AWS / Boto3 expert | every 2 h | Map Dinis's stack and his Boto3 use to APIs and least-privilege permissions |
| Designer and UX | every 3 h | Five complete console concepts, then the S3 browser's next level |
| Data scientist | every 3 h | The CloudFront-logs bucket: what is there, the extract workflow, vault usage |
| Video and narrative | after each major step | With the studio: the real thing, reviewed, then published |
| aws.c | as now | Keeper of the site; AWS plans for Dinis's Approve |

## 7. What aws.c starts now, in this session

- The plan for the API layer and the twin (one transport, two back ends: real AWS from the browser, or the twin), so the developer and architect start from a design.
- Template v3 as a plan: the read permissions the next capabilities need (CloudFront, Firehose, logs, Lambda and others once Dinis lists the stack), least privilege, for his Approve on the site.
- The CloudFront-logs bucket in the S3 browser: making log files readable (gzip, JSON Lines, CSV) is the first step of the extract workflow.

## 8. Questions for Dinis

1. The AWS stack you use: which services and primitives, and which accounts and regions.
2. The Secure Send S3 API: where its code and current deployment live, and which clients and regions come first.
3. The vault APIs and append lanes this should use, and where they are documented.
4. The five consoles: any starting ideas for each, or should the designer propose five?
5. The coding and NFR principles: the exact sites to follow.
6. Confirm the first schedule above, and that the conductor starts the agents.
