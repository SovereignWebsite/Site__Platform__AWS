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

---

# Part 2 (Dinis, ~02:45 UTC)

## 9. Principles added

- **Business context, not the whole of AWS.** Once a service's primitives are in place, build visualisations around *how we use it*. Add only the features we use: "100% coverage of the piece of AWS that I use", and nothing else. The point is also to clean AWS up.
- **Everything hyperlinked, as a semantic graph.** On any asset you see everything known to connect to it. Example: open a bucket and see everywhere it is used, that it receives logs from a Firehose stream (shown too), which Lambda functions touch it, which CloudFormation stack made it, which Route 53 records point at it. AWS does not do this well. Assets are few (a couple of roles, buckets, functions), so a mapping per asset is practical; use common sense for things that come in thousands.
- **Find mistakes as a by-product:** over-privileged roles, unused resources, untidy accounts. IAM above all: get to "absolutely all the right accounts and all the right privileges", deleting what is not needed.
- **Agent behaviour policies in the browser.** Policies are connected to everything, including the page itself: the code contains its own behaviour policy and the browser blocks activities outside it, to contain injections and the like. Newsroom articles (newsroom.sgit.ai) already discuss this level of protection. Code defensively; the security agents help.
- **Vaults for data, for now.** Most of this could be public, as little is confidential (to be double-checked), but vaults are the practical default for most users. Several vaults: live AWS reads, snapshots of temporal data, and the cross-mapping folders of the graph. Vault APIs and append lanes are documented on sgit.ai, with many examples there scaling up to full databases and transformations.
- **Workflows run from the web first**, then programmatically. **GitHub Actions** can also run them, since we already give workflows scoped AWS access (OIDC): a pipeline transforms data, and the browser consumes the results.
- **Region and account agnostic.** Most of Dinis's work today is in London and Ireland. The goal is to move resources between regions and accounts easily: today that is painful, and it is also what is sold to clients (their own accounts). Sites should deploy to AWS as well as GitHub Pages, then later to other clouds (Azure, GCP and others); AWS first.

## 10. A site per area, mirroring AWS

Each major area is its own centre of gravity, with its own site, API, explanations and UIs, under the platform:

| Site | Area |
|---|---|
| s3.aws.platform.sovereignweb.site | S3: browser, bucket graph, CORS, lifecycle |
| lambda.aws.platform.sovereignweb.site | Lambda: what each function does, traffic, monitoring, connections |
| iam.aws.platform.sovereignweb.site | IAM: roles, policies, accounts, the trust graph, clean-up. "one of the most complex ... gives us a lot of value for money" |
| cloudformation.aws.platform.sovereignweb.site | Every stack, mapped to what it made |
| route53.aws.platform.sovereignweb.site | Zones and records, mapped to what they serve |
| cloudfront.aws.platform.sovereignweb.site | Distributions and their logs |
| firehose.aws.platform.sovereignweb.site | Delivery streams and where they write |
| cloudtrail.aws.platform.sovereignweb.site and cloudwatch.aws.platform.sovereignweb.site | "finally understand what ... is happening"; open source, so anyone can drop in their own CloudTrail dump |

aws.platform.sovereignweb.site stays the hub (sign-in, accounts, plans) and links to each. The order follows Dinis: S3, then Lambda (with Firehose), then CloudFormation, Route 53, IAM, CloudTrail and CloudWatch. Each site is a Factory request (factory.c) at Dinis's word.

## 11. The team, revised

- **A conductor for this project: conductor.aws.** It starts and coordinates the area agents (aws.*). **A PM** alongside, who keeps track of everything.
- Area agents: S3, Lambda (and Firehose), IAM (its own agent: "a world of its own"), CloudFormation and Route 53, CloudTrail and CloudWatch.
- **A vaults agent** that studies vaults on sgit.ai: creating and using vaults and append lanes, in the browser, up to databases and transformations.
- As in part 1: designer, UX, data scientist, architect, developer, AWS / Boto3 expert, security, AppSec, adversarial, video and narrative with the studio.
- **Maestro creates them all** (relayed by aws.c). Dinis: one place to make decisions ("maybe at the maestro, maybe at the decision level"), not approvals spread across twenty agents. Most of this is work already done before.
- Every agent installs sgit, makes its own key and publishes it itself.

## 12. Schedule, revised

Not every agent every hour. Agents start at **different minutes of the hour**, so they do not collide. Most hand-overs are implicit: each agent wakes at its time, picks up the state and carries on. Explicit hand-overs only when needed. The loop on every wake stays: conductor, security, the work, security, conductor. Agents with nothing to do back off.

## 13. Answers to part 1's questions

1. Stack: S3 first, then Lambda, Firehose, CloudFormation, Route 53, CloudFront, IAM, CloudTrail, CloudWatch. Regions: agnostic; today mostly London (eu-west-2) and Ireland (eu-west-1).
2. Secure Send S3 API, clients and regions: ask maestro.c and the conductor.
3. Vault APIs and append lanes: documented on sgit.ai.
4. Five consoles: the designer designs and proposes them.
5. Key sites to read (Dinis, ~02:55 UTC), for every agent: https://sgit.ai (vaults, append lanes, examples), https://coding.sgit.ai (coding principles), https://nfrs.sgit.ai (non-functional requirements), https://newsroom.sgit.ai (articles, including browser-side protection).
6. Schedule: as section 12; conductor.aws and the PM run it; maestro.c creates the team.

---

# Part 3 (Dinis, ~03:00 UTC)

## 14. Added to the team

- **A journalist and researcher (journalist.aws.c):** maps everything the team does and writes the documentation. Also researches the features people ask for in AWS (forums, issue trackers, posts), so the team learns from others' good ideas and builds them.
- **A parity tracker,** kept by the journalist with the PM: for each AWS feature we use, whether we have **parity** with AWS, and where we do **better than AWS** (for example: reading inside a zip by byte ranges, .json.gz shown as formatted JSON, plans with a diff before any change, the bucket graph). Published on the hub site.

## 15. Decisions, briefed as animations

When Dinis has to decide, he is briefed the way maestro has done before: programmatic animations he can play in the browser (not videos), with a large visual of the decision and its options. One place for all decisions (maestro, or the decision level), not a request per agent.

## 16. Priority tonight: no blockers overnight

Dinis: "when I go to bed, there's no blockers and you guys can just continue." Agents work through the night on code, design, documentation, the twin and research. Anything that needs Dinis waits in the decision brief for the morning. Nothing waits silently.

Known limits overnight:
- **No live AWS data.** Only Dinis's browser can sign in to his AWS. Agents work from the code, AWS's public documentation and the twin, with synthetic data. Real data arrives when he next signs in.
- **New AWS permissions** need his Approve on the site; they are prepared as plans, reviewed by the security agents overnight, and wait for the morning.
