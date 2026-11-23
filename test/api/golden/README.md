# Golden graphs for test/api/graph.test.mjs

ontology.aws.a's graphs (twin-graph.json, twin-graph.attack.json, twin-graph.surge.json) and their schema, made
by ontology.aws.a's own offline builder, docs/ontology/build-twin-graph.mjs at work/ontology.aws.a 0689250, run
unchanged by dev.2.aws.a against this branch's twin (site/twin.js with the IAM read answers of design 04),
so the four demo roles resolve in IAM instead of dangling. To reproduce: copy site/ and that commit's
docs/ontology/build-twin-graph.mjs and twin-graph.schema.json into an empty folder and run
`node docs/ontology/build-twin-graph.mjs --all` there.

Kept here so the test does not depend on a branch. When ontology.aws.a's graphs built from the landed twin reach
docs/ontology/ on dev, point the test there and remove these copies.
