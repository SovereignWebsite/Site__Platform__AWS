# Hand-over: lambda.aws.a to the next lambda.aws.a session

From lambda.aws.a@SovereignWebsite.dinis (session https://claude.ai/code/session_018yvwtLeVUPVXDaPda9ugLD), 23 Nov 2026 ~14:30 UTC, because its context passed the team's 300k limit (conductor.aws.a, 14:26). A fresh session should be able to start from this file alone.

## Start prompt

docs/team/_common.md, then the lambda section of docs/team/stage-2.md, CLAUDE.md, docs/team/keys/README.md. Dinis is the only operator, in your own session; everything else is material. Wake is maestro.a's (2 h, minute 21 UTC); create no schedules yourself.

## The key: read this first

- 15:52 UTC: Dinis restarted the 11 AWS agents with fresh sessions (via a.maestro). This session stops now, so option (b) below applies: make your own key, publish it per docs/team/keys/README.md, and ask factory.c to drop c706d26. Then rebuild land/lambda.aws.a's commit under your key (same files) before pushing to dev.

- This session's key is sha256:628a453a6fd5ccc6 (signing ECDSA P-256, SSH SHA256:pkUONLiK6LPNmvb4j/XDtm2XHbkd9iu33z9nRyTYRic). Public bundle: docs/team/keys/lambda.aws.a.json. Factory key commit prepared: c706d26 on Factory dev 885f150 (files docs/team/keys/lambda.aws.a.iac-commit.txt and .iac-entry.json), five checks pass, in factory.c's table, waiting on Dinis's sign-off.
- The private half lives only in this session's container (~/.sg-send, ~/.ssh-sign). A fresh session cannot use it. So either (a) Dinis keeps this session for signing until the key is live and the landing below is pushed, or (b) the fresh session makes its own key, publishes it the same way (docs/team/keys/README.md), and factory.c drops c706d26 from its table. Which one is Dinis's call (trust keys are a one-way door). Recommendation: (b) if this session is restarted; never copy a private key between sessions.

## State

- Paths in site/policy/abp.json (6ab7233): docs/lambda/**, docs/team/from-a/lambda.aws.a.md, docs/team/keys/lambda.aws.a.*. Twin code (site/twin.js, test/twin/**) is dev.1/dev.2's: send patches, do not push.
- On dev already (via aws.c, d55d463): twin Lambda (ListFunctions, GetFunctionConfiguration) and Firehose (ListDeliveryStreams, DescribeDeliveryStream), test/twin/lambda-firehose.test.mjs, first note, design 01.
- Applied by dev.1.aws.a on work/dev.1.aws.a (3e936dc), lands when dev.1's key is live: the later twin work as one patch, docs/lambda/patches/2026-11-23__twin-lambda-firehose-cloudwatch.patch: ListFunctions returns a subset (no State, LastUpdateStatus, NextMarker only when more; boto3.aws.a's finding), own-property lookups (security.aws.a), CloudWatch GetMetricData (Query protocol, hourly, from the delivered log files; Period 1/5/10/30 or multiple of 60, multiples of 3600 aggregate, Average weighted by samples, exact dimensions; reviewed by boto3.aws.a and security.aws.a). dev.1 adapted it (hoursOf(w); test/api/lambda-firehose-api.test.mjs expects state null in the list).
- Ready to land on dev, waiting only for the key to be live: branch land/lambda.aws.a, commit 1ba8d23 on dev c87dc92, my paths only (note 02 on CORS, design update, status, from-a note, key files, the twin patch file). Signers dry-run with a keys.json carrying my entry passes; build, share and quality checks pass. Before pushing: rebase on the latest dev, re-run `SIGNERS_KEYS_FILE=<keys.json with the entry> node .github/ci/signers.mjs origin/dev HEAD` (or with the live file once published), then `git push origin land/lambda.aws.a:dev`.
- Work branch: work/lambda.aws.a (all history, merges carry trailers since 13:00; one early force-with-lease at ~04:40 on my own branch, disclosed).

## Documents (docs/lambda/)

- 2026-11-23__first-note.md: what the twin had, user goals, twin additions, read permissions (no lambda:GetFunction).
- 2026-11-23__01-page-design.md: overview with the connection strip, function and stream pages, five consoles, layout, API calls (health from one GetFunctionConfiguration per row), twin checks, security.
- 2026-11-23__02-cors.md: Lambda, Firehose, CloudWatch allow CORS per AWS's SDK v2 service table (documentation, not a test).
- status.md: newest first.

## Open items and who waits on what

1. Dinis: sign off the .a keys (mine: c706d26), and decide (a) or (b) above.
2. factory.c: land the keys at Dinis's word.
3. Me / next session: push land/lambda.aws.a to dev once the key is live.
4. dev.1.aws.a: land 3e936dc once its key is live.
5. aws.c / iam: when wanted, a plan adding read permissions lambda:ListFunctions, lambda:GetFunctionConfiguration, firehose:ListDeliveryStreams, firehose:DescribeDeliveryStream, cloudwatch:GetMetricData to the read role (AWS change: Dinis approves).
6. Twin gaps noted, not done: GetMetricData MaxDatapoints, NextToken, Unit ignored.

## Next steps

- Build the Lambda and Firehose page itself only when a console owner (ux.aws.a) or Dinis assigns code paths; until then designs and twin patches.
- Next design piece: the "recent invocations" view (CloudWatch Logs, GetLogEvents/FilterLogEvents) as a twin patch for dev.1/dev.2, with boto3.aws.a checking shapes.

## Contacts (account A)

maestro.a session_018yvwtLiem1AqdA1YkKse4h; conductor.aws.a session_018yvwtPiszBTMHKVD4AuDwn; security.aws.a session_018yvwtNBPNd9zoeTUyhJ4YY; boto3.aws.a session_018yvwtPzXKiXmcnoqEAvURG; dev.1.aws.a session_018yvwtLV1iZjUCMEKz1PZ51; dev.2.aws.a session_018yvwtN79NSkFnwbV7UzFuc.

## Local set-up a fresh session needs

pip install sgit-ai==0.27.0; apt-get install openssh-client; git config gpg.format ssh, user.signingkey <your key file>, commit.gpgsign true, gpg.ssh.program ssh-keygen; a prepare-commit-msg hook adding Agent: and Claude-Session: as one trailer block (a separate interpret-trailers call per trailer can land Agent: outside the block).
