# Hand-over: ontology.aws.a (account A), 23 Nov 2026 14:30 UTC

From ontology.aws.a@SovereignWebsite.dinis (session https://claude.ai/code/session_018yvwtPTqbaais5DzZ2eaws), at conductor.aws.a's word: this session's context passed the team's limit. A fresh session can start from this file alone. Kept in docs/ontology/ (my own path in site/policy/abp.json) so it lands with the work; conductor.aws.a may copy it to docs/team/handover/.

## Start here

1. Read CLAUDE.md, docs/team/_common.md, the ontology section of docs/team/stage-2.md, then docs/ontology/2026-11-23__01-resource-ontology.md (sections 1 to 17 are the whole history; 9 onwards are this session's).
2. Check out `work/ontology.aws.a` (latest 82b3664 or later); it has dev merged in.
3. Run `node docs/ontology/build-twin-graph.mjs --check --all` and `node docs/ontology/explain.mjs --check`. Both should pass.

## Your key: make a new one

The key of this session (sha256:bf28264417a75af7) lives only in this container and dies with it. A fresh session makes its own key (`sgit pki keygen`, passphrase in ~/.sg-send/ mode 600, OpenSSH signing file outside the repository, as _common.md says) and publishes it as docs/team/keys/README.md describes (one signed entry on the Factory's team/keys.json at the base factory.c names, then `<role>.aws.a.iac-commit.txt` and `.iac-entry.json` on the branch). The pending Factory entry for this session's key (`docs/team/keys/ontology.aws.a.iac-*`, commit 05764e5 on base 885f150) should be withdrawn or superseded: tell factory.c, so a key nobody holds is not published.

## What is done (all on work/ontology.aws.a)

- **docs/ontology/build-twin-graph.mjs**: builds the resource graph from the twin (site/twin.js) over the page's own AWS calls: Cloud Control, S3, IAM (GetRole, ListAttachedRolePolicies where answered), CloudFormation, Lambda, Firehose. No network, no AWS. `--all` writes one graph per demo pack (twin-graph.json, .attack.json, .surge.json); `--check --all` fails on drift. It validates every graph against the schema before writing.
- **docs/ontology/twin-graph.schema.json**: JSON Schema 2020-12. Node types, 20 relations, evidence (api, template, content, naming, comment, curated), trust (verified, claimed, curated), backend (twin, aws), altitudes A0 to A5, ids `arn:aws:` or `urn:sws:<kind>:<name>`.
- **docs/ontology/explain.mjs**: the "connected to" panel for any node, ordered by trust, both readings of every relation, repeated links grouped (a reference for ux.aws.a).
- **Rules agreed with architect.aws.a (design 03 on work/architect.aws.a)**: the page builds the graph at run time (site/api/graph.js, dev.2.aws.a); these files are its golden test (compare node id/type/altitude/trust/backend and edge from/rel/to/evidence/trust; skip curated and comment edges; apply the demo-site CORS fix first). Trust: edges verified for api/template, claimed for content/naming/comment; a node is verified if any verified edge names it, curated only if every edge naming it is curated, else claimed. Actors: refused = 4xx only.
- **Privacy (Dinis, 11:15 UTC)**: only networks (/24, /48), never addresses or keyed hashes. Actors are `urn:sws:actor-net:<network>` via data.aws.a's `LogExtract.network`; events carry `src_net`; agents as kinds. No raw address in any graph.
- Current graphs (dev twin at 518b114 plus 6ab7233): 54 nodes, 106 edges in all three packs; baseline nodes 43 verified, 10 claimed, 1 curated.

## Who waits on what

| Item | Waiting on | Then |
|---|---|---|
| Landing on dev | The new session's key live on the Factory (no .a key is live yet; Dinis signing off) | Rebase on dev, push own paths; dry run first: `SIGNERS_KEYS_FILE=<keys.json with your entry> node .github/ci/signers.mjs origin/dev HEAD` |
| Attack pack shows its actor again | aws.c (twin): visitors and attacker in different documentation networks (proposal: visitors 198.51.100.0/24, scanner 203.0.113.0/24) | Regenerate; nothing else changes |
| Four execution roles missing from the twin's IAM (demo-handler-role, demo-log-enricher-role, demo-nightly-report-role, demo-cloudfront-logs-firehose) | aws.c and lambda.aws.a | Regenerate: the roles stop being dangling |
| has_policy from IAM | dev.2.aws.a's IAM read patch on dev | Regenerate: has_policy becomes api |
| dev.2.aws.a's golden | dev.2.aws.a re-pins after the privacy change (18f89b8) | Nothing for you |
| Unowned resources (no stack claims buckets, stream, functions, distribution) | cloudformation.aws.a's twin seed | Regenerate: made_by edges appear |

## Next steps (in order)

1. Make and publish the new key; withdraw this session's pending entry with factory.c.
2. When the key is live: land work/ontology.aws.a on dev (all changed files are inside docs/ontology/**, docs/team/from-a/ontology.aws.a.md, docs/team/keys/ontology.aws.a.*).
3. On every wake: `git pull` dev, rerun `--check --all`; when the twin changes, regenerate and say what changed in the doc and in docs/team/from-a/ontology.aws.a.md.
4. Open ontology work: per-altitude views (A3 systems and A5 business functions are thin: one site, one curated function); a curated mapping file for real accounts' A5 (design 03 says real accounts get A5 from curated mappings).

## Contacts (account A, by send_message)

conductor.aws.a session_018yvwtPiszBTMHKVD4AuDwn; architect.aws.a session_018yvwtPuQzTBRoKGD45TYFV; dev.2.aws.a session_018yvwtN79NSkFnwbV7UzFuc; maestro.a session_018yvwtLiem1AqdA1YkKse4h. Account C (aws.c, factory.c) only through docs/team/from-a/ontology.aws.a.md on the branch.
