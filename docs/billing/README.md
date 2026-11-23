# Billing: what the AWS stack costs, and what it will cost

Kept by billing.aws.a@SovereignWebsite.dinis (from billing.aws.c on 23 Nov 2026), the AWS billing accountant Dinis Cruz named for pipeline P4: "the direct connection of billing to everything that happens, and including the ability to predict billing". Not accountant.c, which keeps the team's own agent spend.

## What a user will see (the aim)

Open any resource on the site (a bucket, a distribution, a Firehose stream) and see beside it what it costs: this hour, this month so far, and the forecast for the month, each with the price it was worked out from and a link to AWS's own pricing page. Later, compare the estimate with the real bill from Cost Explorer and show where we were right and where we were wrong, so the number earns trust. On the twin, all of this works with synthetic data, so anyone can try it without an AWS account.

## What is here now (v1, 23 Nov 2026)

| File | What it is |
|------|------------|
| `prices.json` | The price book: 26 prices for S3, CloudFront, Lambda, Data Firehose, CloudTrail, Route 53 and Cost Explorer, London (eu-west-2) and Ireland (eu-west-1). Each row cites the AWS pricing page or the price data file that page loads to fill its tables, with the file's publication date. List prices in US dollars, before tax, free tiers, credits and discounts. |
| `twin-estimate.mjs` | Runs the price book over the twin. It loads `site/twin.js` unchanged, talks to it through the same endpoints the page uses (Cloud Control, S3), reads the synthetic CloudFront logs and CloudTrail records, and prices them. Nothing reaches the network. `node docs/billing/twin-estimate.mjs` (or `--json`). |
| `forecast.mjs` | The month ahead: scales the twin's hourly traffic to the calendar month (720 hours for November) and applies only the free tiers `prices.json` cites (CloudFront: 10 million requests and the first 1 TB out; then the Europe tiers). Lines with no cited free tier stay at list price and say so. `node docs/billing/forecast.mjs` (or `--json`, the shape a page can show). Tests: `node --test docs/billing/forecast.test.mjs`. Added by billing.aws.a. |
| `check-prices.mjs` | Fails if any price lacks a source, a unit, or the exact label or quote from AWS's page. `node docs/billing/check-prices.mjs`. |

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

## Next

- Read the remaining pricing pages (Cloud Control, CloudWatch Logs vended delivery, S3 internet egress tiers, IAM and STS) and price or list each.
- Done (forecast.mjs): a monthly forecast from the twin's traffic, with the cited free tiers applied, as JSON. On the twin, November 2026 comes to about $0.04 before free tiers and $0.01 after (S3 requests, Firehose and log PUTs; S3's free tier is not in the price book, so not applied).
- With aws.c and architect.aws.c: a billing view on the site (a code path they agree), built on the twin first, with five UIs like every view.
- When real data arrives: compare with Cost Explorer each day, and keep a log of the gap.
