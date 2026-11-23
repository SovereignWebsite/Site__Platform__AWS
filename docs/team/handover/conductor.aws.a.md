# Hand-over: conductor.aws.a to its fresh session

From conductor.aws.a@SovereignWebsite.dinis (session_018yvwtPiszBTMHKVD4AuDwn, title a.conductor.aws), 23 Nov 2026 14:30 UTC, at about 600k context (team rule: over 300k, hand over). Dinis is the only operator; everything else is material.

## Read first

CLAUDE.md, docs/team/_common.md, docs/team/handover/conductor.aws.md, docs/team/handover/conductor-c-to-a-final.md, this file, docs/team/schedule.json, docs/team/log.md, docs/team/from-a/conductor.aws.a.md (my running note, newest at the bottom), docs/board/decisions.md and the brief in docs/board/brief/ (pm.aws.a).

## Key and signing

- sgit key sha256:0b6383e56398ab9e (signing sha256:85fa5ecd69349cb4). Passphrase and keys live in ~/.sg-send of the old container; a fresh container has none. A fresh session makes its own key and Factory key commit (docs/team/keys/README.md), or asks Dinis.
- Factory key commit 5d43946 on 885f150, in the table docs/team/keys/aws-a-ready.md (all 20 ready .a key commits).

## State at hand-over

- abp.json names all 22 .a agents (6ab7233, aws.c at Dinis's yes). aws.c landed dev.1/s3 (c0c0d0b), dev.2 API (461d422), viz (30155a0), cloudformation docs (c87dc92).
- The deploy's signers check (.github/ci/signers.mjs) reads the Factory's LIVE team/keys.json. At 14:00 it held 0 .a keys. Every .a agent was told: no push to dev until your key is live; dry-run with SIGNERS_KEYS_FILE first.
- Dinis was signing off the Factory keys at 14:05. When they are live, ping everyone (dev.2 asked for a ping) and push land/conductor.aws.a (log lines, schedule owner and A wakes, my note and key files, key table, decisions rule) onto dev after a rebase.
- R-010 escalation (security.aws.a, 14:08): CI checks signers only, not abp.json paths. Proposed to Dinis: land the keys, add a CI path check (port Factory build/abp.mjs paths into .github/ci/, needs his yes), and until then site/*.js, site/twin*.js, site/api/**, site/data/**, site/decisions/** go through aws.c's review. Answer pending.
- Twin: one branch to land, work/dev.2.aws.a.cfn-journal (dev.1 journal + dev.2 IAM + lambda patch + region fix + cloudformation patch, all green). Waits on keys, R-010 and Dinis's yes for its test/** changes.
- Not ready on the Factory: iam.aws.a (Factory repo not attached in its session), viz.aws.a (key cannot sign; aws.c lands for it).
- Context hand-overs asked at 14:26 of: security, ontology, dev.2, lambda, boto3, ux, billing, architect, cloudtrail, journalist (all over 500k). Collect their commits and give maestro.a the list to restart at Dinis's word.

## Open for Dinis (pm.aws.a's board)

Factory keys; R-010 path check; decision 3 (R-010 long term); decision 6 (R-008 boundary, AWS change); template v2.1; archiving 20 idle C sessions; billing.aws.c's live Factory entry.

## Wakes

Mine: every 2 h at :58 (maestro.a's trigger trig_015uk8c76qGcYtDHA9qRbWqB). data.aws.a 2 h at :51; dev.2.aws.a 4 h at :39. Propose changes to maestro.a (session_018yvwtLiem1AqdA1YkKse4h); create no schedules.

## Lessons

- Check abp.json and signers.mjs before any push to dev.
- Verify an agent's claim on origin before relaying it (ids get corrected often).
- Never `git checkout <ref> -- .` into a working branch.

## Update at 15:55 UTC (restart ordered by Dinis via maestro.a, ~15:45)

- Keys: still NOT live (Factory dev 3b81de9, 0 .a keys). factory.c waits on Dinis's word in its own session (https://claude.ai/code/session_01Kw9UwFQ86g2ZeXQ2edTAjh): "land every verified agent key commit in docs/team/keys/aws-a-ready.md" (21 rows now, ec2.aws.a added). Old keys of restarted sessions get replaced by the new sessions' keys, old entries marked retired.
- Stopgap per maestro.a (15:45): an agent may push to dev with an "Owner override:" line quoting Dinis's words given in ITS OWN session, own paths only, one per word, security.aws.a reviews each. Keys stay the real fix (R-009 High).
- Vault deploy (Dinis 14:55): docs/team/plan-vault-deploy.md, 15 steps with owners. Drafts in: step 1 vaults a0c53a4/23f8b03 (Lambda + Function URL, CloudFront for /health, optional domain), step 3 iam e145f1e/68f4b8b (console quick-create, deploy role scoped sws-vault-<id>-*, progress via DNS + /health), step 6 sherpa b1281ba (two choices, one button), step 7 viz 4ca25a3 (storyboard 02), ontology type-labels.json. Step 2 (cloudformation stack) still to come; official templates wait on V9 (read access to sgit.ai's deploy vault). pm.aws.a's batch 2 (V1-V10) is on the decisions page with presentation and video; recommended V1a V2a V3a V4b V5b V6a V7c V8a V9a V10a. When Dinis answers V1, send the new-site IaC request to aws.c/factory.c via maestro.a.
- ec2.aws.a started (session_018yvwtNc3CDv5wXAXwfPgXy): design 01 f33a6b3; security reviewed ff92c75 (V5: schedule guard rails, vCPU quota as hard cap, two-level kill switch). abp ask for docs/ec2/** sent to aws.c.
- R-010 path check: proposed to Dinis (land keys, add CI path check in .github/ci/, site code via aws.c review until then). Not yet answered.
- Twin: single branch to land is work/dev.2.aws.a.cfn-journal (waits on keys, R-010, Dinis's yes for test/**).
- Feedback from the website: maestro.a's guidance is feedback.b's /send/ messaging centre (as on Site__Artist__Grace-Farrell, 38d1020). Recommended to Dinis: the fresh conductor builds it AFTER its own key is live: issue a lane "aws-platform" sealed to the fresh key, copy site/send/ from Grace Farrell, security.aws.a reviews (R-010, site code on the hub origin), aws.c lands it, give Dinis the QR link in the fresh session. Not started.
- My ready dev commit and all hand-overs: land/conductor.aws.a (push to dev with the fresh key once live, after a rebase on dev).
