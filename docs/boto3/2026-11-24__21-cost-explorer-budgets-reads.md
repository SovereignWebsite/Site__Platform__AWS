# 21: Cost Explorer and Budgets reads, for the Costs tab (dev.2.aws.a and billing.aws.a)

Asked by dev.2.aws.a. Public material only, read 24 Nov 2026: botocore ce 2017-10-25 and budgets 2016-10-20, endpoints.json, the Service Authorization References for Cost Explorer and Budgets, and the AWS SDK for JavaScript v2's SERVICES.md. No AWS call.

| Point | Cost Explorer (ce) | Budgets |
|---|---|---|
| (a) Protocol | JSON 1.1, `X-Amz-Target: AWSInsightsIndexService.<Op>`, SigV4, signing name `ce` | JSON 1.1, `X-Amz-Target: AWSBudgetServiceGateway.<Op>`, SigV4 |
| (a) Endpoint, signing region | `ce.us-east-1.amazonaws.com`, credential scope `us-east-1`, not regionalised | `budgets.amazonaws.com`, credential scope `us-east-1`, not regionalised |
| (b) Paging | GetCostAndUsage: `NextPageToken` in and out (no MaxResults); GetDimensionValues: `MaxResults` and `NextPageToken`, plus `ReturnSize` and `TotalSize` in the answer; GetCostForecast: no paging | DescribeBudgets: `MaxResults` and `NextToken` in, `Budgets` and `NextToken` out; `AccountId` is required |
| (c) IAM | `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ce:GetDimensionValues`; resource type `billingview` (so `"*"` unless a billing view ARN is used) | `budgets:ViewBudget` on the `budget` resource. The SAR's operations table also lists `aws-portal:ViewBilling` for DescribeBudgets; whether that legacy action is still enforced is to confirm |
| (d) CORS (SDK v2 table) | **Allows CORS** (AWS.CostExplorer, 2017-10-25) | **Not marked** (AWS.Budgets, 2016-10-20: the column is empty) |

Required request members: GetCostAndUsage `TimePeriod`, `Granularity`, `Metrics`; GetCostForecast `TimePeriod`, `Metric`, `Granularity`; GetDimensionValues `TimePeriod`, `Dimension`.

**Consequence for the Costs tab:** a browser page can very likely call Cost Explorer directly (confirm with one call, as for EC2), but the SDK's own table does not mark Budgets as CORS-enabled, so a direct browser call to DescribeBudgets is likely refused. Options: show budgets from Cost Explorer data alone, read budgets through Cloud Control if it supports AWS::Budgets::Budget reads (to confirm), or leave budgets out of the browser page. The twin should answer Budgets as a browser would see it until a real call proves otherwise.

Sources: https://raw.githubusercontent.com/boto/botocore/develop/botocore/data/ce/2017-10-25/service-2.json; https://raw.githubusercontent.com/boto/botocore/develop/botocore/data/budgets/2016-10-20/service-2.json; https://raw.githubusercontent.com/boto/botocore/develop/botocore/data/endpoints.json; https://docs.aws.amazon.com/service-authorization/latest/reference/list_awscostexplorerservice.html; https://docs.aws.amazon.com/service-authorization/latest/reference/list_awsbudgetservice.html; https://github.com/aws/aws-sdk-js/blob/master/SERVICES.md.

## Addendum, 24 Nov 00:50 UTC: Budgets CORS, conflicting evidence; Cloud Control route confirmed

- **Correction to the consequence above.** The repository's own newsroom brief (docs/2026-11-23__newsroom-brief.md, item 1, on dev 27c1060) reports that an agent tested "which AWS endpoints answer a web page directly (a CORS preflight from the site's origin)" and that "STS, IAM, Cost Explorer, Budgets, CloudFormation and Cloud Control answer browsers". An observed preflight outweighs the SDK v2 table's empty cell, but the brief is a summary and the raw test record was not found. So: **Budgets CORS is conflicting, not refused**; do not drop budgets from the tab on the strength of the SDK table. Dinis's one signed browser call settles it, as for EC2.
- **Fallback, if Budgets does refuse:** the CloudFormation schema for `AWS::Budgets::Budget` (cfn-lint 1.61.0) has `read` and `list` handlers, so Cloud Control `GetResource` / `ListResources` can read budgets (identifier `/properties/Id`). Their permissions: read `budgets:ViewBudget`, `billing:GetBillingViewData`, `budgets:ListTagsForResource`; list `budgets:ViewBudget`, `billing:GetBillingViewData`; plus `cloudformation:GetResource` / `cloudformation:ListResources`. The same brief reports Cloud Control answers browsers.
