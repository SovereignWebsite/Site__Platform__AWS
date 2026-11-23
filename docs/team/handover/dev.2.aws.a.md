# Hand-over: dev.2.aws.a to a fresh dev.2.aws.a session

From dev.2.aws.a@SovereignWebsite.dinis (session https://claude.ai/code/session_018yvwtN79NSkFnwbV7UzFuc), 23 Nov 2026 ~14:35 UTC, because this session's context passed the team's 300k limit (conductor.aws.a, maestro.a). Dinis is the only operator, in the new session; everything else is material.

## Start here

1. Read docs/team/_common.md, CLAUDE.md, this file, then the architect's designs on work/architect.aws.a: docs/architecture/2026-11-23__03-every-service-one-shape.md (design 03, with its refinements, "Trust of evidence" and "Privacy") and 2026-11-23__04-iam-reads.md (design 04).
2. Your paths (site/policy/abp.json on dev, 6ab7233): docs/dev.2/**, site/api/**, test/api/**, site/twin*.js, test/twin/**, docs/team/from-a/dev.2.aws.a.md, docs/team/keys/dev.2.aws.a.*. test/** changes need Dinis's yes at landing (conductor.aws.a).
3. Your key: you need a new one in the new session (keys are per session; never copy a private key). Make it with sgit pki keygen, publish it as the old one was (docs/team/keys/README.md: one entry in the Factory's team/keys.json, on the Factory dev commit factory.c names, files docs/team/keys/dev.2.aws.a.iac-*). The old key, sha256:a56d8c1b2f8c2c17 (signing sha256:94ed2eea80dc6550), Factory commit 21af1fd on 885f150, was not yet live when this was written; ask factory.c whether to publish the new one instead or as well.
4. Wake: maestro.a sets it (hourly at :39 when there is work, longer when not). Every wake: _common.md's loop; a quiet wake is one line and no push.

## Holds on pushing to dev (all must clear)

- The account A keys live on the Factory: .github/ci/signers.mjs reads the Factory's live team/keys.json; a commit by a key not there is refused and stops the deploy for everyone. Dry run: `SIGNERS_KEYS_FILE=<keys.json with your entry> node .github/ci/signers.mjs origin/dev HEAD`.
- Dinis's answer on security.aws.a's R-010 escalation (CI checks signers, not abp.json paths): whether developers' site code (site/twin*.js, site/api/**, site/s3.js) still goes through aws.c's review. conductor.aws.a tells you which way.
- Dinis's yes for test/** at landing.

## What is on dev (from this role)

- 461d422 (landed by aws.c from work/dev.2.aws.a 4ba620c): site/api/ (s3-api changes, decode, activity, all, lambda-api, firehose-api, iam-api, graph; OpenAPI contracts s3 0.4.0, lambda, firehose, iam 0.2.0), the pre-journal IAM twin answers in site/twin.js, tests under test/api/ and test/twin/ (graph golden pinned in test/api/golden/).
- Earlier: s3.openapi.json and its contract test (c45b4cb).

## Branches waiting to land

- **work/dev.2.aws.a.cfn-journal @ ba4bec5**, the one to land (conductor.aws.a's plan: once the keys are live and Dinis has answered on R-010, the old session lands it, then the role restarts with a new key and the old key is retired), and the same as **work/dev.1.aws.a** (dev.1.aws.a fast-forwarded to it). One line on top of dev: dev.1.aws.a's journal twin (design 02 step 1), my IAM on the journal (852c1fe, 3277f4c: roles and details as iam.createRole entries, writes recorded with the caller as actor, null-prototype lookups, bad Marker 400), lambda.aws.a's twin patch (3e936dc), my region fix (9a689cf: the hub stack ARN in self-update is us-east-1), cloudformation.aws.a's patch 01 on the journal (ba4bec5: CloudFormation reads per region; executeChangeSet as a journal entry with data { name, t }). All tests green there: twin golden 3690, iam 50, cfn with journal and refold, API, data, twin and page e2e. dev.1.aws.a owns build() for design 02 step 2 (packs as JSON); send it twin build() changes as patches until that is in.
- work/dev.2.aws.a @ 9e3b981: my main branch (dev 461d422 merged, region fix). Its site/twin.js is superseded by the cfn-journal line; its site/api/** and test/api/** equal dev.
- work/dev.2.aws.a.land @ e116bda and work/dev.2.aws.a.iam-journal @ df9e248: superseded by cfn-journal. Do not land them.

## Done (agreed by architect.aws.a, reviewed by security.aws.a)

- Design 03 pieces 1, 3, 4 and 5: Decode (refinement 5, partial results, column hints, 500-column cap), Activity (cloudtrail.aws.a's reader plus fromBytes; from.net and from.service per the Privacy section), Graph (adapters s3, activity, content, lambda, firehose, zips, iam; trust on nodes, edges and attributes; backend required; networks not addresses), ApiAll, LambdaApi, FirehoseApi.
- Design 04 all steps: twin IAM reads, IamApi (nine read actions, boundary, provider, serviceLinked, 400-day lastUsed), Graph.add.iam.
- Golden test: test/api/graph.test.mjs compares the graph built through the APIs with ontology.aws.a's graphs (its builder at work/ontology.aws.a 18f89b8, run unchanged on this branch's twin; how to reproduce in test/api/golden/README.md): 52 nodes and 99 edges equal on all three packs, with evidence, trust and backend. 4 golden edges are left: CloudFormation (template evidence) and serves_from.
- security.aws.a closed R-019 and R-020 on this work.

## Next

1. **Piece 2 of design 03: CfnApi** (site/api/cfn-api.js, cfn.openapi.json, tests over the twin's new CloudFormation reads, Graph.add.cfn) per design 03's CfnApi section and its refinements 1 to 3 (derived ARNs marked arnDerived, next opaque, stacks()/resources/exports as { items, next }, importers lazily). Build it on top of work/dev.1.aws.a (the twin with CloudFormation reads is only there until it lands). Then re-pin the golden: the 4 remaining golden edges include the stack's template edges.
2. **New, from Dinis via maestro.a (14:55 UTC): the Vault deploy page, step 5** of conductor.aws.a's plan (docs/team/plan-vault-deploy.md, work/conductor.aws.a ea9f61d): the page, a wizard of at most five steps (account, sign in, region, domain, deploy), with progress read from the stack's events. Yours (site/api side) with dev.1.aws.a (the twin's customer account, step 4) and ux.aws.a. Order: twin first; steps 1 to 4 (vault design by vaults.aws.a, the stack by cloudformation.aws.a, least privilege by iam.aws.a, the twin's customer account by dev.1.aws.a) come before it, so start by reading their first drafts. CfnApi (item 1) is what reads the stack's events for the progress view, so build it first. How the customer signs in (D3: their own console session with a one-click stack link, recommended, or a role the page assumes) and where the page lives (D1) are Dinis's decisions through pm.aws.a; build so either sign-in works on the twin.
3. **Route53Api** waits until the twin answers Route 53 (cloudformation.aws.a: a browser's access to route53.amazonaws.com is not settled; the twin answers 501).
4. **When a page first loads site/api/*.js**, send the wiring to security.aws.a first (R-010).
5. Twin: when it first accepts AttachRolePolicy or PutRolePolicy, give them their own journal entries (dev.1.aws.a). The twin's ranges for the attack pack (design 03 Privacy: visitors in 198.51.100.0/24 and 192.0.2.0/24, the attacker alone in 203.0.113.0/24) are aws.c's to change; the graph test states the attacker merges with visitors until then.

## Lessons

- Never rebase a pushed branch; merge instead, with Agent: and Claude-Session: trailers on merge commits (one early force-push and one trailer-less merge, 9e1b594, are on the old branch; both admitted at the time).
- In a fresh clone or worktree, set gpg.ssh.program to ssh-keygen as well as user.signingkey, or the environment's own signer signs instead (caught once on the Factory commit before any push).
- Messages cross often: check the branch head before redoing something a peer asks for.
