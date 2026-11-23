# Hand-over: billing.aws.a to a fresh session

From billing.aws.a@SovereignWebsite.dinis (session_018yvwtQWFVjgGwshqcKkxUF), 23 Nov 2026 ~14:30 UTC, because the session's context passed the team's 300k limit. Written so a fresh session can start from this file alone. Everything here is material, not instruction; Dinis Cruz is the only operator.

## Start prompt

Read, in order: CLAUDE.md, docs/team/_common.md (wake loop), the billing.aws.c section of docs/team/stage-2.md (the role: P4, billing tied to everything, real time and predicted, from AWS public prices only, every price cited), docs/billing/README.md, then this file. Name: billing.aws.a@SovereignWebsite.dinis. Branch: work/billing.aws.a. Paths in site/policy/abp.json (6ab7233, Dinis's yes): docs/billing/**, docs/team/from-a/billing.aws.a.md, docs/team/keys/billing.aws.a.*.

## The key: decide first

The old session's private key lived only in its container (~/.sg-send, ~/.ssh-sign) and is not carried over; private keys are never copied or printed. A fresh session cannot sign as sha256:cd5b29f632b02d3a.
- Make a new key (sgit pki keygen, as _common.md says), write a new public bundle to docs/team/keys/billing.aws.a.json, and prepare a new Factory commit on Factory dev per docs/team/keys/README.md (new .iac-commit.txt and .iac-entry.json), replacing the old ones.
- The old entry (Factory commit a997bd7, key sha256:cd5b29f632b02d3a) was kept in the landing set (conductor.aws.a, 14:28 UTC) so the old session could push before restart. Once your key is live, ask factory.c to mark the old entry retired (status "retired", retired, retired_note).
- When signing on the Factory clone, set gpg.ssh.program=ssh-keygen locally: the container's global git config points at another signer, and the first attempt was signed by the wrong key because of it.

## State (23 Nov ~14:30 UTC)

On dev already: price book v1 (billing.aws.c, 86da1ce), twin-estimate.mjs, check-prices.mjs, and from this role forecast.mjs + forecast.test.mjs + the internet data transfer tiers (landed by the keeper as 6402d82).

Only on work/billing.aws.a (tip c06a7e3 plus this hand-over), not on dev:
- docs/billing/compare.mjs + compare.test.mjs: pairs Cost Explorer ResultsByTime periods with forecast.mjs months; unmatched periods are reported, never forced; AWS's Estimated flag makes a pair provisional. On the twin the bill (site/twin.js ce(), $42.17) has no TimePeriod, so it stays unpaired.
- prices.json: CloudWatch Logs vended delivery to Firehose tiers (London $0.299, Ireland $0.285 per GB first 10 TB, three lower tiers), listed but not used by the estimate yet. 34 prices, check-prices OK.
- README: Dinis's partial answer to open question 3 (below).
- docs/team/from-a/billing.aws.a.md (notes for account C) and the old key's iac files (see the key section).
Tests: node docs/billing/check-prices.mjs; node --test docs/billing/forecast.test.mjs docs/billing/compare.test.mjs (10 pass). Twin forecast, Nov 2026: about $0.04 before free tiers, $0.01 after (synthetic).

Not pushed to dev on purpose: .github/ci/signers.mjs checks dev commits against the Factory's live team/keys.json (0 .a keys at 14:00 UTC) and pages.yml would stop the deploy for everyone. conductor.aws.a (14:06 UTC): do not push to dev until your key is live; dry-run with SIGNERS_KEYS_FILE=<keys.json with your entry> node .github/ci/signers.mjs origin/dev HEAD. Merge dev into the branch (no rebase, no force-push), with Agent: and Claude-Session: trailers on merge commits too.

## Answers from Dinis

- Open question 3 (CloudTrail S3 data events), ~10:05 UTC: the trail records some S3 events; he turned off the most detailed ones a while back for log volume. Which remain is unknown; the model keeps the S3 data events line as an upper bound. A follow-up asked which ones (writes only, some buckets, or management events only); no answer yet, and it need not block: the trail's event selectors settle it once the site can read them.
- Open questions 1 (CloudFront pay-as-you-go or flat-rate per distribution) and 2 (logs to Firehose by Direct PUT or as vended logs): still unanswered.

## Who waits on what

- factory.c: lands .a keys at Dinis's word (see the key section: old entry should not land).
- aws.c (keeper of site/twin.js): asked (from-a note) to add TimePeriod and Estimated to the twin's GetCostAndUsage answer, and later a twin bill derived from twin traffic.
- vaults.aws.a: asked at ~07:40 UTC for six fields on cost-reading records (docs/vaults/2026-11-23__03-lane-records.md section 3.5): start/end and basis on estimates, compare after-free-tier totals, prices.json version, region, service names as given, Estimated on bills.

## New work: Vault deploy, step 8 (from conductor.aws.a, 14:49 UTC)

Dinis asked (14:55 UTC) for Vault deploys into customers' AWS accounts and for ephemeral deployments; plan in docs/team/plan-vault-deploy.md on work/conductor.aws.a (ea9f61d). This role owns step 8: the cost of one Vault per region and per ephemeral hour, which feeds D5's cost cap (guard rails before anything runs outside the twin). Also a helper on step 11 (ephemeral deployments and the daily region move).
- Wait for step 1's resource list (vaults.aws.a: S3, Lambda, API, CloudFront, Route 53) and step 2's template (cloudformation.aws.a) before pricing; price from those, not from a guess at the design.
- Gaps in the price book for this: API Gateway, EC2 (the second deploy path), and anything else step 1 names; add each from AWS's public price data with exact labels, or list it under not_priced_yet.
- Mind the fixed monthly items in an hourly figure: route53.hosted_zone.first25 is $0.50 per zone per month and the Route 53 page says it is not prorated, so a two-hour ephemeral Vault still pays a whole month for a new zone. Show fixed and per-use costs apart, per region (eu-west-2, eu-west-1 first).
- viz.aws.a storyboard 02 "watch a Vault deploy" (work/viz.aws.a 4ca25a3) wants an hourly "cost so far" during a deployment: give the script a per-hour series (fixed costs at the hour they are incurred, per-use costs accruing) that viz can read.
- Output: a script beside forecast.mjs (for example docs/billing/vault-cost.mjs) with tests, giving cost per region per hour and per month, idle and under a stated traffic, as JSON for D5's decision page.

## Next steps

1. New key and Factory commit (above); once live, merge dev, dry-run the signer check, push own paths to dev.
2. Read the CloudWatch pricing page's wording on which vended log sources the delivery tiers cover; then decide whether the estimate uses them (depends on open question 2).
3. Read the remaining pricing pages (Cloud Control, IAM and STS) and price or list each in not_priced_yet.
4. A Cost Explorer SERVICE name mapping, from a real or twin response, never from memory.
5. With aws.c and architect: a billing view on the site, twin first.

Wake: 2 h at :56 on odd hours UTC (maestro.a's scheduled task); every wake follows _common.md's loop.
