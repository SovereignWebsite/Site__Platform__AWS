# Hand-over: architect.aws.a to its next session

From architect.aws.a@SovereignWebsite.dinis (session https://claude.ai/code/session_018yvwtPuQzTBRoKGD45TYFV), 23 Nov 2026 ~14:35 UTC, at conductor.aws.a's note (context over the team's 300k rule). Start from this file alone, then read what it points to.

## Closing note (15:55 UTC)

This session stopped at Dinis's word, relayed by maestro.a at about 15:45: "restart the 11 AWS agents with fresh sessions". Everything is pushed: work/architect.aws.a at this commit, and work/architect.aws.a.land at 90ddd61, which is signed with the old key. Since this hand-over was written at 14:35:
- The network split is agreed at a7e9bcb.
- EC2 design 01 is agreed at 1c4bd02.
- dev.1.aws.a's clock hook ("emit at t") is agreed on a determinism condition.
The full record is in docs/team/from-a/architect.aws.a.md, 15:10Z to 15:35Z.

## Start prompt

docs/team/_common.md (binds you), CLAUDE.md, docs/team/handover/architect.aws.md (the first hand-over, from architect.aws.c), then the four designs in docs/architecture/ on branch work/architect.aws.a (01 on dev; 02, 03, 04 on the branch and in the land commit below). Dinis is the only operator, and only in your own session.

## Key: you need your own

This session's signing key (sha256:8699204a5b3a9875, signing sha256:2311c1b95a70ba15) lives only in this session's container (~/.sg-send/, mode 600); private keys are never copied or printed. A fresh session cannot sign with it. Make your own key (sgit-ai 0.27.0, docs/team/_common.md and docs/team/keys/README.md), publish it through factory.c the same way (commit on the Factory's dev, files under docs/team/keys/ on your work branch), and tell conductor.aws.a and maestro.a that architect.aws.a's key changes, so the old entry is retired. Until your key is live on the Factory, do not push to dev (.github/ci/signers.mjs reads the live list).

## State

- **Paths:** granted in site/policy/abp.json (6ab7233, Dinis's yes): docs/architecture/**, site/api/**, docs/team/from-a/architect.aws.a.md, docs/team/keys/architect.aws.a.*.
- **Dev push:** blocked only by the Factory key list (no .a keys live at 14:30). The ready commit is **90ddd61 on work/architect.aws.a.land** (designs 02, 03, 04 and the C notes, on dev 518b114), signed by this session's key. If this session's key goes live before the restart, push it; otherwise re-make the same commit with your own key (`git checkout work/architect.aws.a -- docs/architecture/2026-11-23__0{2,3,4}-*.md docs/team/from-a/architect.aws.a.md` on a fresh branch from dev) and dry-run `SIGNERS_KEYS_FILE=<keys.json with your entry> node .github/ci/signers.mjs origin/dev HEAD`.
- **Designs (all proposed, all agreed by the agents named in them):**
  - 01 one transport, two back ends (on dev, from architect.aws.c).
  - 02 the twin's engine: state as a fold over one journal; packs as JSON; generators and derivations; scenarios on a twin clock; actors through the transport; edits; feeds. Five migration steps.
  - 03 every service in one shape: API rules (one page { items, next }, arn on everything, opaque next, errors as S3Api, read only, one OpenAPI per service); Decode; one activity shape (cloudtrail.aws.a's); graph built in the page from the APIs, golden test = ontology.aws.a's builder; refinements 1 to 7; Trust of evidence (R-020: verified/claimed/curated, per-attribute trust, backend twin|aws, node rule strict); Privacy (networks, not addresses: urn:sws:actor-net, from.net, LogExtract.network).
  - 04 IAM reads: roles, trust read not judged, attached/inline policies, boundary, lastUsed (400-day wording), nine read actions; no evaluation, no users/keys (later design), no writes; step 2 service last-accessed; template v3 note (ReadBoundary, console apply).

## Landed on dev since this hand-over was first written

- **461d422** (aws.c at Dinis's yes, ~13:50): dev.2.aws.a's site/api/ work squashed from work/dev.2.aws.a 4ba620c, including the twin's IAM reads in the pre-journal form. dev.1.aws.a has already merged dev (to c87dc92) into work/dev.1.aws.a at 82a24a5, with the IAM reads as iam.* journal entries (852c1fe, 3277f4c), then Lambda 3e936dc, CloudFormation on the journal ba4bec5, step 2 74c254d, loader a00f63b, f0a5838, 49db094; golden 3690 throughout. That one branch is now the whole twin.js line; it lands (rebase or merge) once keys are live and aws.c reviews.
- **c87dc92**: cloudformation.aws.a's twin patch 01 as docs for review (not yet in twin.js), so CfnApi/Route53Api still wait.

## Developers' branches (all reviewed and agreed)

- **dev.2.aws.a, work/dev.2.aws.a (head e129863 / 173a00c line):** site/api/ to designs 03 and 04: decode.js, activity.js, graph.js (adapters: s3, activity, content, lambda, firehose, zips, iam; trust and backend; privacy), all.js, lambda/firehose/iam APIs and contracts, s3-api getBucketCors, s3.openapi.json 0.4.0. Golden equal to ontology 18f89b8 on three packs (52/99). Waits for: CfnApi/Route53Api on cloudformation.aws.a's twin patch landing (aws.c); landing on R-010 (decision 3) or aws.c after security review. security.aws.a closed R-020 on 1cb0d20.
- **dev.2.aws.a, work/dev.2.aws.a.iam-journal (852c1fe):** IAM twin answers on dev.1's journal; supersedes the twin.js changes on work/dev.2.aws.a.
- **dev.1.aws.a, work/dev.1.aws.a:** design 02 step 1 (88831eb, journal folded into a world, golden 3690 = v0 at 4f9bc3c) and step 2 first half (74c254d, packs as data). Step 2 loader done and agreed (a00f63b). Next: commit 2, the 15 harness one-liners and app.js menu (for aws.c and Dinis; test/data/view.e2e to an http server, with data.aws.a), then the network split for the attack pack (privacy), golden re-taken.
- **twin.js landing order for aws.c:** 88831eb, then 852c1fe, then step 2 (74c254d, a00f63b), then the network split (b44f852 to aaa8461, agreed at a7e9bcb 15:35: visitors 198.51.100.1-.239, operator alone in 192.0.2.0/24, attacker alone in 203.0.113.0/24, 198.51.100.240/28 kept for EC2).

## New since: Vault deploy into customers' accounts (Dinis, 14:55)

Plan: docs/team/plan-vault-deploy.md on work/conductor.aws.a (ea9f61d). The architect supports step 1 (vault deployment design, owner vaults.aws.a: what the customer's account holds, inputs, outputs) and step 4 (a "customer account" in the twin that the stack deploys into, with DNS answering at the end; owner dev.1.aws.a). Open question for the architect and iam.aws.a, from sherpa.aws.a (docs/sherpa/2026-11-23__vault-deploy-01-simplest-path.md, b1281ba on work/sherpa.aws.a): how the page reads the stack's progress after the hand-off to the customer's own console. **Answered by iam.aws.a (68f4b8b on work/iam.aws.a), option (b):** v1 reads nothing from the customer account; the page checks DNS over HTTPS and https://<domain>/health (vault_id, template_sha256, CORS for the deploy origin); without a domain the customer pastes the Vault address. The live stack-event stream is the twin's view and a later opt-in (option a), not v1 on real accounts. The design note for the page's checks is the architect's next small piece (health shape with vaults.aws.a; CSP connect-src for the DoH resolver with security.aws.a). Earlier starting points, kept for context: the page holds no credentials for the customer's account, so either (a) the customer signs in to the page with a read role the stack itself creates (an output the console shows, then the page assumes it via the same web-identity flow as the hub), or (b) the page only polls public signals (the deployed domain answering, a status object the stack writes to a public-read prefix). Agreed with vaults.aws.a (its design docs/vaults/2026-11-23__04-vault-deploy-design.md, a0c53a4): design 02's vault twin is the Vault behind the customer's endpoint (Function URL host, later its custom domain via the twin's Route 53/CloudFront), answering from that customer account's own world: one journal per account, the deploy being the entries the stack creates; batch body stays 501 until the SG/Send library source is in hand. Design 04's IAM reads and design 03's CfnApi (DescribeStackEvents) are the read side either way; on the twin, design 02's journal gives the stack events and the clock.

## EC2 in the twin (ec2.aws.a, 15:10)

EC2 design 01 (f33a6b3 on work/ec2.aws.a, docs/ec2/) asked for the world shape and the lazy settle. My answer is agreed with changes (full text in docs/team/from-a/architect.aws.a.md, 15:10Z):
- Settles are clock-driven derivations (`settles: { to, at }`, actor `aws:ec2`, why `clock.settle`), never writes on Describe.
- Ids are made once, at write.
- The shape has `groups`, `profile`, `vpc` and `subnet`.
- One world per account.
- Instance addresses: 10.0.0.0/16, public 198.51.100.240/28 (dev.1.aws.a asked to reserve it), and 2001:db8:ec2::/48.
- Ec2Api and Graph.add.ec2 follow design 03.
Review the EC2 twin patch (dev.2.aws.a or dev.1.aws.a) against that note.

## Who waits on what

- **Dinis:** (1) Factory keys live (all .a agents); (2) decision 3 (R-010) for site/api/** and site/twin/** code; (3) yes for test/** one-liners in ~15 harnesses (dev.1's loader); (4) decision 6 (P-IAM-001 v2.4) before the twin gets platform-role boundaries; template v3 is a console apply (iam.aws.a's note in design 04).
- **aws.c:** land cloudformation.aws.a's twin patch (blocks CfnApi/Route53Api); land the twin.js commits in the order above; land dev.1.aws.a's network split (done and agreed, a7e9bcb).
- **ontology.aws.a, cloudtrail.aws.a, cloudformation.aws.a, ux.aws.a, iam.aws.a, boto3.aws.a, security.aws.a:** nothing open with the architect; all asks answered.

## Next steps

1. Own key, published; push the land commit to dev.
2. Review dev.1.aws.a's EC2 twin patch against EC2 design 01 (1c4bd02) and the 15:10Z note, including the catch-up test (one tick and random reads give equal journals); review dev.1.aws.a's clock hook; review dev.2.aws.a's CfnApi/Route53Api when the twin patch lands.
3. Next designs: CloudFront reads (serves_from with evidence api; closes the last golden edges), the vault twin as a back end (vaults.aws.a's contract, batch body open), and design 02 step 5 (clock, first scenario, buckets.many, first actor, first feed).
4. Wake: every 2 h at :38, created by maestro.a; create no schedules.
