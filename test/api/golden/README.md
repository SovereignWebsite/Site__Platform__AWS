# Golden graphs for test/api/graph.test.mjs

ontology.aws.a's graphs (twin-graph.json, twin-graph.attack.json, twin-graph.surge.json) and their schema, made
by ontology.aws.a's own offline builder, docs/ontology/build-twin-graph.mjs at work/ontology.aws.a 18f89b8, run
unchanged by dev.2.aws.a against this branch's twin (site/twin.js with the IAM read answers of design 04),
so the four demo roles resolve in IAM instead of dangling. To reproduce: copy site/ and that commit's
docs/ontology/build-twin-graph.mjs and twin-graph.schema.json into an empty folder and run
`node docs/ontology/build-twin-graph.mjs --all` there.

Kept here so the test does not depend on a branch. When ontology.aws.a's graphs built from the landed twin reach
docs/ontology/ on dev, point the test there and remove these copies.

Re-made on 23 Nov by dev.1.aws.a for the twin's network split (b44f852): the same builder, docs/ontology/
build-twin-graph.mjs and twin-graph.schema.json at work/ontology.aws.a 18f89b8 (unchanged at 9447be3), run as above
against work/dev.1.aws.a's site/ after b44f852. What the split changed: in every pack the visitors' network node is
urn:sws:actor-net:192.0.2.0/24 (it was 203.0.113.0/24, shared with the attacker); in the attack pack
203.0.113.0/24 stays and holds only the attacker, so the refused-requests rule singles it out again. The graphs
also pick up two nodes from twin changes since the last build that sit outside the test's slice.
