# Hand-over: architect.aws.a to its next session

From architect.aws.a@SovereignWebsite.dinis (session https://claude.ai/code/session_018yvwtPuQzTBRoKGD45TYFV), 23 Nov 2026 ~14:35 UTC, at conductor.aws.a's note (context over the team's 300k rule). Start from this file alone, then read what it points to.

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

- **461d422** (aws.c at Dinis's yes, ~13:50): dev.2.aws.a's site/api/ work squashed from work/dev.2.aws.a 4ba620c, including the twin's IAM reads in the pre-journal form. So the twin.js landing order below changed: dev.1.aws.a's journal (88831eb onward) must now rebase onto dev and fold the IAM reads in as iam.* entries (852c1fe shows how); 852c1fe itself is superseded.
- **c87dc92**: cloudformation.aws.a's twin patch 01 as docs for review (not yet in twin.js), so CfnApi/Route53Api still wait.

## Developers' branches (all reviewed and agreed)

- **dev.2.aws.a, work/dev.2.aws.a (head e129863 / 173a00c line):** site/api/ to designs 03 and 04: decode.js, activity.js, graph.js (adapters: s3, activity, content, lambda, firehose, zips, iam; trust and backend; privacy), all.js, lambda/firehose/iam APIs and contracts, s3-api getBucketCors, s3.openapi.json 0.4.0. Golden equal to ontology 18f89b8 on three packs (52/99). Waits for: CfnApi/Route53Api on cloudformation.aws.a's twin patch landing (aws.c); landing on R-010 (decision 3) or aws.c after security review. security.aws.a closed R-020 on 1cb0d20.
- **dev.2.aws.a, work/dev.2.aws.a.iam-journal (852c1fe):** IAM twin answers on dev.1's journal; supersedes the twin.js changes on work/dev.2.aws.a.
- **dev.1.aws.a, work/dev.1.aws.a:** design 02 step 1 (88831eb, journal folded into a world, golden 3690 = v0 at 4f9bc3c) and step 2 first half (74c254d, packs as data). Step 2 loader done and agreed (a00f63b). Next: commit 2, the 15 harness one-liners and app.js menu (for aws.c and Dinis; test/data/view.e2e to an http server, with data.aws.a), then the network split for the attack pack (privacy), golden re-taken.
- **twin.js landing order for aws.c:** 88831eb, then 852c1fe, then step 2, then the network split.

## Who waits on what

- **Dinis:** (1) Factory keys live (all .a agents); (2) decision 3 (R-010) for site/api/** and site/twin/** code; (3) yes for test/** one-liners in ~15 harnesses (dev.1's loader); (4) decision 6 (P-IAM-001 v2.4) before the twin gets platform-role boundaries; template v3 is a console apply (iam.aws.a's note in design 04).
- **aws.c:** land cloudformation.aws.a's twin patch (blocks CfnApi/Route53Api); land the twin.js commits in the order above; separate the twin's client networks (visitors 198.51.100.0/24 and 192.0.2.0/24, attacker 203.0.113.0/24, operator 192.0.2.7) or accept dev.1.aws.a's commit for it.
- **ontology.aws.a, cloudtrail.aws.a, cloudformation.aws.a, ux.aws.a, iam.aws.a, boto3.aws.a, security.aws.a:** nothing open with the architect; all asks answered.

## Next steps

1. Own key, published; push the land commit to dev.
2. Review dev.1.aws.a's loader and network-split commits; dev.2.aws.a's CfnApi/Route53Api when the twin patch lands.
3. Next designs: CloudFront reads (serves_from with evidence api; closes the last golden edges), the vault twin as a back end (vaults.aws.a's contract, batch body open), and design 02 step 5 (clock, first scenario, buckets.many, first actor, first feed).
4. Wake: every 2 h at :38, created by maestro.a; create no schedules.
