# The pipeline: what comes next, and in what order

Kept by pm.aws.c. From Dinis Cruz in pm.aws.c's session, 23 Nov 2026 ~03:05 UTC (summarised faithfully; his words quoted). Each project enters the board when its agents exist and its dependencies are met; the conductor assigns it.

## What Dinis set for the whole programme
- **No budget cap here.** "there's no budget at the moment ... we can use as much as we can ... go to town." Five accounts, possibly nine, can take delegated work; this programme has only started on one.
- **Models:** "everybody should be using Opus and a bit of Sonnet."
- **Parallel where there is a bottleneck:** the PM may call for several agents of one role (dev.1, dev.2, dev.3, dev.4 ...), as in earlier projects.
- **Start from the experience:** "start with the actual website ... the actual vault ... the actual user that is using something."
- **Every view has five UIs:** "explore this from 5 different angles and really go to town on the way to tell the story."
- **Much of it can be public:** "a lot of these ontology and taxonomies are public stuff ... We just connected the dots."

## The projects

### P1. Follow the packet (the flagship view)
"I want to see the exact package. I want to see the exact IAM use. I want to see the exact resources that we use." A live architecture diagram, threat-model style, drawn with the team's characters and game engine: follow one request through every component, replay it, speed it up, slow it down, see its logs. On the twin first (synthetic data), then live data, which also checks the twin is right. Five UIs.
- **Needs:** the game engine and characters (location to confirm), the twin (TW-1), the API layer (AR-1), a visualisation agent, design and UX.
- **First step:** a storyboard of one packet (a page view on a Sovereign Website: CloudFront, S3, logs through Firehose, the vault it touches) on the twin.

### P2. The fractal semantic graph of everything
"a gigantic graph that connects the whole lot": AWS resources, open ports, the logs received and their parsing, CloudWatch, CloudFront logs, IDs, encrypted files, S3 files consumed, data registered. Several altitudes of graph (fractal semantic graphs, "meaning through connectivity, thinking in graphs"); click any node, see its detail and everything connected.
- **Needs:** an ontologist agent (new role), the area agents' reads, the vaults.
- **First step:** the ontologist reads the team's writing on fractal semantic graphs and proposes the ontology and taxonomy, public where it can be.

### P3. Vaults as the capture store
S3 always works, but vaults also capture the events and map the capabilities: live reads, snapshots, the graph's cross-mapping.
- **Needs:** vaults.aws.c (VA-1).

### P4. Billing connected to everything, in real time, and predicted
"the direct connection of billing to everything that happens, and including the ability to predict billing." Real-time billing estimated from logs, compared with the real bill afterwards ("when we got it right, when we got it wrong"), close enough to trust.
- **Needs:** a new accountant for AWS billing (billing.aws.c; distinct from accountant.c, which keeps the team's own spend), AWS's public price lists, the logs (EX-1), Cost Explorer reads (already in the read role).
- **First step:** a price model of today's stack from public pricing, run over twin traffic.

### P5. The time lapse: everything linked, Kibana style
Go back and forward in time, see traffic, click anything and the whole UI follows. Data loaded and queried in the browser (client-side databases, WebAssembly).
- **Needs:** architect (client data layer), devs, design and UX.

### P6. Ephemeral EC2 infrastructure, and metrics
Add EC2 as short-lived infrastructure, with metrics from the start.
- **Needs:** an ec2 area agent, template permissions as plans, security review first.

### P7. Scoped access with budgets
"Why can't I create a key, an access for a user that only has access to some capabilities, or maybe call some models": access made on demand (through the same Google sign-in, or keys), limited to chosen capabilities and models, with budgets, that can be blocked and are watched for abuse.
- **Needs:** iam.aws.c, security (all three views), P4 for budgets; Dinis's choice of models (decision, later).

### P8. Feature launches, AWS style
"you should be getting to the point where you're producing regular feature updates ... hey, this just launched." Documentation of everything, and a steady stream of launch posts.
- **Needs:** journalist.aws.c now (more than one if the launches outpace one), the parity tracker.

## Proposed order (PM's recommendation; Dinis changes it at will)
- **Now, in parallel with the AWS areas:** P8 (journalist), P2 (ontologist starts the ontology), P1 storyboard on the twin, P4 price model on the twin, P5 client data layer design.
- **As the twin and area reads land:** P1 and P5 built for real; P3 capture into vaults; P2 filled from live reads.
- **After the IAM area and a security review:** P6 EC2, then P7 scoped access (the riskiest: it hands out access).

## New roles this adds
ontology.aws.c; billing.aws.c; viz.aws.c (the game engine and characters); dev.1 to dev.4.aws.c; ec2.aws.c later; a second journalist if needed.
