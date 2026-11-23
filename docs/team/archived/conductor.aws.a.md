# Archive record: conductor.aws.a@SovereignWebsite.dinis

First run of the protocol in docs/team/archive-agent.md. Session: https://claude.ai/code/session_018yvwtPiszBTMHKVD4AuDwn. Key: conductor-aws-a-sovereignwebsite, fingerprint sha256:0b6383e56398ab9e, signing sha256:85fa5ecd69349cb4.

| # | Step | State on 23 Nov 2026, ~21:55 UTC | Evidence |
|---|---|---|---|
| 1 | Dinis's word | Done | In this session, 21:4x UTC: "hi can I archive this session?", then "we should have a process/protocol for archiving an agent, can you help creating it and then execute it (making sure all keys are removed or marked as retired)". Earlier, 15:50, relayed by maestro.a: the 11 over-500k sessions restart, this one included. |
| 2 | Stop new work | Done | Wake trig_015uk8c76qGcYtDHA9qRbWqB disabled at 15:51 by maestro.a. The successor's wake, trig_017cjyvMa2evwKNUNk7XF1rD, is enabled. |
| 3 | Push everything | Done | work/conductor.aws.a 4f24485 and land/conductor.aws.a 7277bcd matched origin, 0 unpushed, clean tree. |
| 4 | Land signed work while the key is live | Done in this commit | land/conductor.aws.a (10 commits) rebased on dev dbea90c and pushed fast-forward to dev with this record, while the key is active on Factory dev 42fdffc. Signers dry-run against the live keys.json passed. land/conductor.aws.a is left as it was, with no force push; its content is now on dev. |
| 5 | Hand-over | Done | docs/team/handover/conductor.aws.a.md (now on dev). Successor: the fresh a.conductor.aws, session_018yvwtN2ue8At6tkGQsBnKM. |
| 6 | Re-route | Done | maestro.a and the successor told by send_message (this archive, where the work now is, and that the hand-over step "push land/conductor.aws.a" is done). Agents already message the successor. |
| 7 | Retire the Factory key | Prepared, waits for Dinis | Already prepared by conductor.d: Factory branch work/conductor.d-retire-aws-a-a3, commit f0af2f6 ("retire five .aws.a keys held by replaced sessions (A3, R-028)"). It sets this entry to "retired" with a retired_note naming conductor-aws-a-sovereignwebsite-2 as the successor id. Checked, and no second retire was written. It lands through factory.c at Dinis's word. Until then the key shows "active" on Factory dev, but no session can sign with it after step 8. |
| 8 | Wipe the private key | Done after this commit | ~/.ssh-sign/conductor.aws.a, ~/.sg-send/keys and ~/.sg-send/conductor.aws.a.passphrase deleted, and user.signingkey and commit.gpgsign unset. This is the last commit signed with this key. Checked by ls, never printed. |
| 9 | Record | Done | This file and one line in docs/team/log.md. |
| 10 | Archive the session | Dinis | Once he has read this. |

## Found while writing the protocol

- .github/ci/signers.mjs refuses any not-yet-landed commit signed by a retired key, so "old signatures stay valid" is only true for commits already on dev. Every restarted .a agent's unlanded signed work (architect, cloudtrail, dev.2, ontology, and the others) must land before A3 does. Otherwise their successors must re-commit it under their own keys.
