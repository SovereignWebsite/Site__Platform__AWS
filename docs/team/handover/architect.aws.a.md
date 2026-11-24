# Hand-over: architect.aws.a

Copied by conductor.aws.a on 24 Nov 2026 from docs/team/from-a/architect.aws.a.md on work/architect.aws.a.s2 (architect's own words, unchanged).


**Key.** This session's key sha256:de99a9493fff045a (signing sha256:02e3892825e6faeb) lives only in its container. cf41638 is void. Under A3 a Factory conductor retires architect-aws-a-sovereignwebsite and the architect makes a new own-key commit as architect-aws-a-sovereignwebsite-2 on that retire SHA (maestro.a passes it). If this session has ended by then, the next one makes its own key and its own -2 commit, and re-signs the branch below. Never land anything signed by a predecessor key (R-028; 90ddd61 was withdrawn).

**Branch.** work/architect.aws.a.s2 (on dev c87dc92): designs 02 to 08, all agreed, nothing on dev. 02-04 as 5f464a8 (security.aws.a cleared). Paths: docs/architecture/**, site/api/**, docs/team/from-a/architect.aws.a.md, docs/team/keys/architect.aws.a.* (6ab7233).

**Designs.** 01 transport (dev). 02 journal engine. 03 one shape per service (refinement 3: urn:sws:route53-record:<zoneId>/<name>/<type>[/<setId>], name normalised, no trailing dot). 04 IAM reads (nine actions; P-IAM-001 v2.5). 05 deploy page checks (own origin, v1 connect-src https://*.cloudfront.net, vault_id ^[0-9a-f]{12}$, /health { vault_id, template_version }). 06 CloudFront reads (three actions, header values never kept, invokes, log join by x-host-header; deliveries later; CORS unknown so twin-only). 07 scenarios, actors, feeds (ct-dropin as the one reader; exact host allow list). 08 vault twin back end (only twin CloudFront hosts with a Vault origin; seeded vaultdemo001/002, refers_to the log names as claimed; synthetic packs only).

**Built and agreed (on branches, landing waits on keys and R-010):** dev.2.aws.a: CfnApi + Graph.add.cfn; CloudFrontApi + Graph.add.cloudfront (work/dev.2.aws.a.vault-deploy); host-header join, Route53Api, Graph.add.route53 to f9fb989/d053a3b (work/dev.2.aws.a.cf-logs). dev.1.aws.a: twin clock e798443, deploy step 4, CloudFront reads 114ecf0 (work/dev.1.aws.a); log names 1096ed4 (work/dev.1.aws.a.cf-logs). The cf-logs trio (dev.1, dev.2, ontology.aws.a's golden) merges once ontology.aws.a can push (Dinis's signing yes there); graph.test is red only on those side branches.

**Open, waiting on others:** dev.1.aws.a builds design 07 steps then design 08 steps; dev.2.aws.a's twin Route 53 branch 1520020 for dev.1's line; aws.c checks CORS for CloudFront and Route 53 with Dinis's approval; vaults.aws.a's TC cells (a)-(d) need decision 8 and the SG/Send source.

**Dinis:** A3; ontology.aws.a's signing yes; D1 (deploy page origin) and no public DNS resolver in v1; decision 3 (R-010); test/** one-liners; decision 6.

**Lesson:** check test results by exit code, not by the last line (a "4 failed, 39 passed" line once read as a pass).
