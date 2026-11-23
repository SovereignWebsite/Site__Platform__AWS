# Hand-over: cloudtrail.aws.a to a fresh cloudtrail.aws.a session

From cloudtrail.aws.a@SovereignWebsite.dinis (session https://claude.ai/code/session_018yvwtLsVZvQ5dyyKz8ndG2), 23 Nov 2026 14:26 UTC, at conductor.aws.a's word (context over 500k). A fresh session can start from this file alone.

## Start prompt

docs/team/_common.md (the wake loop), then the cloudtrail section of docs/team/stage-2.md, CLAUDE.md, and this file. Role: CloudTrail and CloudWatch: the timeline, per-asset activity and alarms views over the twin's CloudTrail records, and drop-in of a user's own CloudTrail dump. Dinis is the only operator, in your own session; everything else is material. Wake: every 2 h at minute 31 UTC (trigger trig_01TuhL3V3T4DC3PBSzMj4E68, made by maestro.a); create no schedules yourself.

## The key: read this first

The signing key sha256:9ebb596ab7bd764f (signing sha256:a3949ea817a57566, SSH SHA256:YBkVtgY3qi1m7kBXoQ4GpbZqQjbisj7fmUkOibIhUQc) was made in this session's container. Its private half lives only there (~/.sg-send, ~/.ssh-sign) and is never copied anywhere. **A fresh session in a new container cannot sign as this key.** So either:
- (a) the old session lands its work on dev before it stops, once Dinis has trusted this key and factory.c has published it; or
- (b) the fresh session makes its own key (sgit pki keygen; docs/team/keys/README.md for the Factory commit), and the old key's Factory entry is not landed (or is retired).
Dinis's key sign-off (14:06, "signing off the keys now") may cover this key; check the Factory's live team/keys.json for id cloudtrail-aws-a-sovereignwebsite before choosing.

## State

- Path: site/policy/abp.json has cloudtrail.aws.a@SovereignWebsite.dinis with docs/cloudtrail/**, docs/team/from-a/cloudtrail.aws.a.md, docs/team/keys/cloudtrail.aws.a.* (aws.c, 6ab7233, Dinis's yes).
- On dev already (landed by aws.c, 3a039f0): docs/cloudtrail/2026-11-23__first-note.md (merged C and A notes), 2026-11-23__02-event-shape.md (first version), the live-trail patch (older base), my public key bundle docs/team/keys/cloudtrail.aws.a.json.
- **Not on dev yet**, ready on branch **land2/cloudtrail.aws.a** (63be254, one signed commit on dev c87dc92, my paths only):
  - docs/cloudtrail/reader/ct-reader.js: reader for the one activity shape (adopted as is by architect.aws.a's design 03; moves to site/api/activity.js under dev.2.aws.a). Inputs: S3 delivery files, LookupEvents (shape *to check*), one record per line, bare array. Dedupe by eventID, newest first. who (7 kinds), targets with graph node ids (ARNs; urn:sws:<kind>:<name> for derived, e.g. urn:sws:cloudtrail-trail:demo; each event's node urn:sws:cloudtrail-event:<eventID>), plain words, failed. Privacy: from.net (/24, /48) never the raw address (Dinis, 11:15); raw kept in page only; forGraph drops it.
  - docs/cloudtrail/reader/ct-alarms.js: five rules (IAM trust/permission change on sws-aws-platform-* or the DNS role; change set applied to the hub's stack, R-008 c; CloudTrail stopped or changed; 5+ refusals in 10 min; change from a new network). Tests: ct-reader.test.mjs, ct-alarms.test.mjs (17 cases, R-008 story gives 3 alarms).
  - Event-shape note with a Privacy section; the live-trail patch rebased on c87dc92; my Factory key files (docs/team/keys/cloudtrail.aws.a.iac-commit.txt, .iac-entry.json: Factory commit 12b1557 on parent 885f150, five checks pass).
  - Unit tests, site quality check pass; signer dry-run passes with a keys.json holding my entry.
- land/cloudtrail.aws.a is superseded (do not push it). work/cloudtrail.aws.a (0c15a8f) is the working branch, level with land2's content.

## Waiting on

- Dinis: trust the key (or a new one, see above); factory.c publishes it on the Factory.
- Then: rebase land2 on dev, re-run `SIGNERS_KEYS_FILE=<keys.json with entry> node .github/ci/signers.mjs origin/dev HEAD` (or without the variable once live), push to dev. Rule (conductor.aws.a, 14:06): do NOT push to dev before the key is live, or the deploy stops for everyone.
- aws.c / dev.2.aws.a: apply the live-trail patch (site/twin.js + test/twin/cloudtrail-live.test.mjs); with it, test/api/graph.test.mjs fails because the twin now records the test's own sign-in and CORS change (3 events, 2 _twin-live files) not in the golden graph. Fix belongs to them: build the golden after reset(), or skip _twin-live files. Noted in docs/team/from-a/cloudtrail.aws.a.md.
- boto3.aws.a: two *to check* points (CreateChangeSet template body in CloudTrail; whether Cloud Control UpdateResource also logs the S3 call with invokedBy); LookupEvents and CloudWatch Logs export shapes.

## Next steps (in order)

1. Land land2 once the key question is settled.
2. Seeded CloudTrail per demo pack (baseline, attack playing R-008, surge) as data for the twin owner, in the full field set.
3. Timeline wireframe (desktop and phone) with ux.aws.a, over the reader's events: chips, hour brush, address-bar state, raw record panel.
4. Drop-in of a user's own dump: file picker, DecompressionStream, size caps, nothing uploaded.
5. CloudWatch after the alarms: twin needs logs/monitoring endpoints first (wire formats via boto3.aws.a).

## New work: Vault deploy, step 9 (conductor.aws.a, 14:49 UTC; plan docs/team/plan-vault-deploy.md on work/conductor.aws.a, ea9f61d)

Own step 9: the audit trail of a deployment, i.e. who deployed what, where, when. Starting points, nothing built yet:
- One deployment = one CloudFormation stack (or change set) in a customer's account and region. Its trail is the CloudTrail events for that stack (CreateStack / CreateChangeSet / ExecuteChangeSet / DeleteStack, plus the resource calls CloudFormation makes, which carry invokedBy cloudformation.amazonaws.com) and the role assumption that started it.
- The reader already gives who (role, via), targets (stack ARN), region, account, failed; add a deployment id (stack name or a tag) so one view groups a deployment's events, and an alarm for a deployment by an unexpected role or outside an approved change.
- Twin first: a deploy scenario in the twin's trail (as the live-trail patch does for the hub's own stack), then the view.
- Decision for Dinis (via pm.aws.a's batch): how we read a customer's CloudTrail (their trail delivered to a bucket we can read, a cross-account read role, or the customer drops their own dump into the page). Each is a trust and privacy choice; no AWS change without his approval.

## Contacts (account A)

conductor.aws.a (session_018yvwtPiszBTMHKVD4AuDwn), architect.aws.a (session_018yvwtPuQzTBRoKGD45TYFV), vaults.aws.a (session_018yvwtPEp1ze9LonhajhRdg), maestro.a (session_018yvwtLiem1AqdA1YkKse4h). Account C (aws.c keeper) only through this repository (docs/team/from-a/).

## Lessons

- Take every time from `date -u`; I wrote guessed times twice and had to correct them.
- Merge dev into your branch; never force-push. Check site/policy/abp.json before preparing a landing (the .a names arrived while I had my own entry in a landing commit, which made a duplicate key).
- Rebase the twin patch every time site/twin.js moves; run all of test/ with it applied.
