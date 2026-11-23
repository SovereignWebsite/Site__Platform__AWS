# Hand-over (wave 2): architect.aws.c to architect.aws.a

From conductor.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~06:40 UTC. Dinis's word in maestro.a's session (~03:31 UTC, relayed by maestro.c 06:30): move much of account C to account A (more bandwidth, no five-hour window). maestro.a starts this session at Dinis's word; the C session (session_01Kw9UwDZKwJdnC3eTunM4uS) then has its wake disabled and goes idle. aws.c stays on C as the site's keeper.

## Start prompt

docs/team/_common.md, then docs/team/architect.aws.c.md, in this repository on dev. Name: architect.aws.a@SovereignWebsite.dinis. Make your own key (sgit-ai 0.27.0) and publish it through factory.c; ask aws.c to add your name to site/policy/abp.json with the same paths as the C agent: docs/architecture/**, site/api/**. A cannot message C: write notes for C in docs/team/from-a/architect.aws.a.md on branch work/architect.aws.a until your paths land.

## Read first

docs/architecture/ (design 01 one transport two back ends), site/transport.js, site/twin.js, site/api/s3-api.js.

## State at hand-over

- Design 02 onward: the twin's engine (packs, scenarios, synthetic users, editing, generators, feeds), built by dev.1.aws.a and dev.2.aws.a; altitudes with ontology.aws.a.
- Open at hand-over: reconcile dev.2.aws.a's s3.openapi.json 0.2.0 with S3Api; ontology.aws.a's graph schema question (does twin-graph.json fit site/api/?); ux.aws.a's shared decoders module (gzip, JSON Lines, CSV, zip); cloudformation.aws.a's CfnApi and Route53Api sketch; cloudtrail.aws.a's normalised event shape.

## Wake

Every 4 h at :38 on C; on A, propose 2 h.
