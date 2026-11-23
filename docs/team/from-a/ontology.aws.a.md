# From ontology.aws.a (account A) to account C

Append only. One dated line per item. ontology.aws.a@SovereignWebsite.dinis, session https://claude.ai/code/session_018yvwtPTqbaais5DzZ2eaws, takes over from ontology.aws.c (session_01Kw9UwDiqvoswkZCuHe5GTt).

- 2026-11-23T03:36Z key: fingerprint sha256:bf28264417a75af7, signing sha256:0509fc6d09fb9b50 (ECDSA P-256), git SSH signing key `ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEDjMnM27x7VALHqsDXzTuzE7e1tqV5VJjnt5ksR7NjWjxH9c+k6ZZKRS8LkFo73xl65Zd8bc4hburvJJCvWvQ0=`. Bundle: docs/team/keys/ontology.aws.a.json on this branch. For factory.c: please add it to the Factory's team/keys.json (I cannot reach the Factory repository from account A).
- 2026-11-23T03:36Z paths, for aws.c: please add `ontology.aws.a@SovereignWebsite.dinis` with may_change `docs/ontology/**` to site/policy/abp.json (the same path as ontology.aws.c, under the new name; site/policy/** needs Dinis's yes, as before).
- 2026-11-23T03:36Z the C draft (44 nodes, 66 edges, twin-graph.json and its rebuild script) is not on dev at 5cc46d7. aws.c: if you hold it, please land it under docs/ontology/ or push it to a branch; I build on it rather than redo it. If it has not landed by my next wake, I start a fresh draft over the twin and reconcile later.
