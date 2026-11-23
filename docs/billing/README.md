# Billing: what the AWS stack costs, and what it will cost

Kept by billing.aws.a@SovereignWebsite.dinis (from billing.aws.c on 23 Nov 2026), the AWS billing accountant Dinis Cruz named for pipeline P4: "the direct connection of billing to everything that happens, and including the ability to predict billing". Not accountant.c, which keeps the team's own agent spend.

## What a user will see (the aim)

Open any resource on the site (a bucket, a distribution, a Firehose stream) and see beside it what it costs: this hour, this month so far, and the forecast for the month, each with the price it was worked out from and a link to AWS's own pricing page. Later, compare the estimate with the real bill from Cost Explorer and show where we were right and where we were wrong, so the number earns trust. On the twin, all of this works with synthetic data, so anyone can try it without an AWS account.

## What is here now (v1, 23 Nov 2026)

| File | What it is |
|------|------------|
| `prices.json` | The price book: 52 prices for S3, CloudFront (with CloudFront Functions), AWS WAF, CloudWatch alarms, Lambda, Data Firehose, CloudTrail, Route 53, Cost Explorer, Secrets Manager, CloudWatch Logs, Certificate Manager, EC2 and data transfer out to the internet, London (eu-west-2) and Ireland (eu-west-1). Each row cites the AWS pricing page or the price data file that page loads to fill its tables, with the file's publication date. List prices in US dollars, before tax, free tiers, credits and discounts. |
| `twin-estimate.mjs` | Runs the price book over the twin. It loads `site/twin.js` unchanged, talks to it through the same endpoints the page uses (Cloud Control, S3), reads the synthetic CloudFront logs and CloudTrail records, and prices them. Nothing reaches the network. `node docs/billing/twin-estimate.mjs` (or `--json`). |
| `forecast.mjs` | The month ahead: scales the twin's hourly traffic to the calendar month (720 hours for November) and applies only the free tiers `prices.json` cites (CloudFront: 10 million requests and the first 1 TB out; then the Europe tiers). Lines with no cited free tier stay at list price and say so. `node docs/billing/forecast.mjs` (or `--json`, the shape a page can show). Tests: `node --test docs/billing/forecast.test.mjs`. Added by billing.aws.a. |
| `compare.mjs` | Estimate beside bill: pairs each Cost Explorer `ResultsByTime` period with the `forecast.mjs` month that has exactly the same start and end, and reports the gap. A period without `TimePeriod`, for another month, or in another currency is reported as unpaired, never forced; AWS's `Estimated` flag makes a pair provisional. On the twin today the result is unpaired, because the twin's Cost Explorer answer has no `TimePeriod`. Tests: `node --test docs/billing/compare.test.mjs`. Added by billing.aws.a. |
| `flood.mjs` | Denial of wallet on one Vault's public Function URL: the cost of an hour at the reserved-concurrency cap (iam.aws.a's condition (c), V5's cost cap). Billed duration is capped by concurrency whatever each request takes; request charges grow as requests get shorter. Table over concurrency, memory and duration, then the stack as written (1024 MB, concurrency 10) with CloudFront requests, transfer out and log ingestion; arm64, eu-west-2, before free tiers. Through CloudFront every request is billed at the edge, served or throttled, so the concurrency cap bounds only the Lambda lines: at 10,000 requests a second, about $46 an hour, of which Lambda is $0.84. AWS WAF does not lower it: WAF bills every request it inspects whatever the action, so a rate rule adds about $22 an hour at that rate (the Anti-DDoS managed rule group about $5, plus $20 a month). What bounds the bill is time: an alarm on the distribution's request count ($0.10 a month) and the kill switch (V5). Tests: `node --test docs/billing/flood.test.mjs`. Added by billing.aws.a. |
| `vault-cost.mjs` | One Vault in a customer's account (plan step 8, for D5's cost cap and viz.aws.a's hourly "cost so far"): fixed and per-use costs apart, per region (London, Ireland), as an hourly series and totals, idle and under a stated synthetic traffic. Resources from vaults design 04 and cloudformation.aws.a's vault.yaml (Lambda arm64 1024 MB, Function URL, S3, Secrets Manager, CloudFront with a /health CloudFront Function, logs kept 30 days). London: idle about $0.42 a month (the $0.40 secret is most of it); a two-hour ephemeral Vault about $0.001, or $0.50 if a new hosted zone is made for it (a zone is charged a whole month). Before free tiers. Tests: `node --test docs/billing/vault-cost.test.mjs`. Added by billing.aws.a. |
| `check-prices.mjs` | Fails if any price lacks a source, a unit, or the exact label or quote from AWS's page. `node docs/billing/check-prices.mjs`. |

## Suggested request alarm per Vault (for R-026 and ux.aws.a's design 06)

Alarm when the distribution's request count over 5 minutes exceeds **45,000** (about 150 requests a second). At that rate one hour costs about **$1.02 in London and $1.02 in Ireland** (`flood.mjs`, stack as written: 1024 MB, arm64, concurrency 10, a 20 ms 401 per request, 500 bytes back, 300 bytes of logs; list prices before free tiers), against about $0.42 a month for an idle Vault. One line for the page: *alarm at 45,000 requests in 5 minutes, about $1 an hour if it lasts; synthetic stated traffic is 1,000 requests an hour, so this is about 540 times it.* The alarm itself is $0.10 a month (`cloudwatch.alarm.standard`). The threshold is a suggestion to tune to real traffic, not an AWS figure.

## First result on the twin

The twin's demo site logged 225 requests and about 1.08 MB out over 9 hours. Priced in London at list rates, before free tiers, that is about $0.00055, or about $0.00006 an hour. The largest line is CloudFront HTTPS requests ($0.012 per 10,000 in Europe). Inside the free tiers (CloudFront: 1 TB and 10 million requests a month, always free; Lambda: one million requests and 400,000 GB-seconds a month) the real charge for traffic like this is zero. The twin's Cost Explorer answers $42.17, a made-up number: once the twin's traffic and its bill come from one source, the comparison of estimate with bill can be built and tested here first.

These are synthetic numbers. They show the model works, not what Dinis's account costs.

## Rules this model keeps

- Every price is copied from AWS's public pricing pages, or the price data file the page loads (`b0.p.awsstatic.com`), on the date given. No price is estimated, averaged or remembered.
- A price not found is listed under `not_priced_yet` and left out, never treated as free. STS, IAM, Cloud Control and CloudFormation for AWS resources are there for that reason, although they may well cost nothing.
- Where the twin cannot tell us something, the model says what it assumed: all requests HTTPS (the dearer rate); every CloudFront request an S3 miss (an upper bound); one Firehose record per log line, billed in 5 KB steps as the Firehose page says; GB read as 10^9 bytes. Each assumption is to be checked against the first real bill.

## Open questions (for pm.aws.c's board when they block something)

1. **Which CloudFront pricing does each real distribution use?** Pay-as-you-go, or one of the flat-rate plans the CloudFront page now lists (Free $0, Pro $15, Business $200, Premium $1,000 a month per distribution, no overage). This changes the model more than any other choice. Known only when Dinis signs in, or if he says.
2. **How do the CloudFront logs reach Firehose?** Direct PUT ($0.035/GB in London) or as vended logs ($0.16/GB in London). Same answer source.
3. **Does the real CloudTrail trail record S3 data events?** $0.10 per 100,000 if so.
   - **Answered in part by Dinis (23 Nov 2026, ~10:05 UTC, in billing.aws.a's session):** the trail records some S3 events, but he turned off the most detailed ones a while back because they produced a huge volume of logs. Still unknown: which S3 events remain (data events limited to writes, or to some buckets, or management events only). Until known, the model keeps the S3 data events line as an upper bound and labels it so; the trail's event selectors, read once the site signs in, would settle it.

## Next

- Read the remaining pricing pages (Cloud Control, IAM and STS, and the CloudWatch page's wording on which vended log sources its delivery tiers cover; the tiers themselves are copied, London $0.299 per GB for the first 10 TB to Firehose) and price or list each. Internet data transfer out tiers for London and Ireland are copied (23 Nov, from AWS's data transfer price data, where 1 TB is 1,024 GB); any monthly free allowance for it is still to be read from the S3 page, so none is applied.
- Done (forecast.mjs): a monthly forecast from the twin's traffic, with the cited free tiers applied, as JSON. On the twin, November 2026 comes to about $0.04 before free tiers and $0.01 after (S3 requests, Firehose and log PUTs; S3's free tier is not in the price book, so not applied).
- With aws.c and architect.aws.c: a billing view on the site (a code path they agree), built on the twin first, with five UIs like every view.
- When real data arrives: compare with Cost Explorer each day, and keep a log of the gap.
