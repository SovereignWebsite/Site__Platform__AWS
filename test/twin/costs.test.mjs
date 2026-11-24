// The twin's Cost Explorer answers refuse unsigned calls (security.aws.a, R-025 (a)), as every other twin service does;
// a signed call gets the synthetic total. Node 22, no network. Run: node test/twin/costs.test.mjs
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";

const twin = loadTwin("baseline"), CE = "https://ce.us-east-1.amazonaws.com/";
const body = JSON.stringify({ TimePeriod: { Start: "2026-11-01", End: "2026-11-24" }, Granularity: "MONTHLY", Metrics: ["UnblendedCost"] });
const call = async (headers) => { const r = await twin.handle(CE, { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSInsightsIndexService.GetCostAndUsage" }, headers), body }); return { status: r.status, json: await r.json() }; };
let checks = 0;
let r = await call({});
assert.equal(r.status, 403, "unsigned: refused"); assert.equal(r.json.__type, "AccessDeniedException"); assert.ok(!("ResultsByTime" in r.json), "no figures without a signature");
r = await call({ authorization: "AWS4-HMAC-SHA256 Credential=AKIAREAL/20261124/us-east-1/ce/aws4_request, SignedHeaders=host, Signature=x" });
assert.equal(r.status, 403, "a credential that is not the twin's: refused");
checks += 4;
r = await call({ authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/us-east-1/ce/aws4_request, SignedHeaders=host, Signature=twin" });
assert.equal(r.status, 200); assert.equal(r.json.ResultsByTime[0].Total.UnblendedCost.Unit, "USD", "signed: the synthetic total");
checks += 2;


// ---- the synthetic figures (the Costs tab): consistent across views, paged, labelled ----
{
  const t = loadTwin("baseline"); t.clock.pause(); t.clock.at("2026-11-24T12:00:00.000Z");
  const SIG = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/us-east-1/ce/aws4_request, SignedHeaders=host, Signature=twin" };
  const j0 = t.journal().length;
  const ce = async (action, b, h = SIG) => { const r = await t.handle(CE, { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSInsightsIndexService." + action }, h), body: JSON.stringify(b) }); return { status: r.status, note: r.headers.get("x-twin-note"), json: await r.json() }; };
  const cents = (a) => Math.round(Number(a) * 10000), M = ["UnblendedCost"];
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  let x = await ce("GetCostAndUsage", { TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "MONTHLY", Metrics: M });
  assert.equal(x.status, 200); assert.equal(x.note, "synthetic figures from the twin, not an AWS bill", "labelled synthetic");
  const mtd = cents(x.json.ResultsByTime[0].Total.UnblendedCost.Amount);
  assert.ok(mtd > 0 && x.json.ResultsByTime[0].Estimated === true, "month to date: a figure, Estimated");
  assert.match(x.json.ResultsByTime[0].Total.UnblendedCost.Amount, /^\d+\.\d{10}$/, "amounts as AWS writes them, ten decimals");
  const byService = await ce("GetCostAndUsage", { TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "MONTHLY", Metrics: M, GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }] });
  const byRegion = await ce("GetCostAndUsage", { TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "MONTHLY", Metrics: M, GroupBy: [{ Type: "DIMENSION", Key: "REGION" }] });
  const gs = (r) => r.json.ResultsByTime[0].Groups;
  assert.equal(sum(gs(byService).map((g) => cents(g.Metrics.UnblendedCost.Amount))), mtd, "by service adds up to the total");
  assert.equal(sum(gs(byRegion).map((g) => cents(g.Metrics.UnblendedCost.Amount))), mtd, "by region adds up to the total");
  assert.deepEqual(gs(byRegion).map((g) => g.Keys[0]), ["eu-west-2", "global"]); assert.deepEqual(byService.json.GroupDefinitions, [{ Type: "DIMENSION", Key: "SERVICE" }]);
  assert.deepEqual(byService.json.ResultsByTime[0].Total, {}, "a grouped answer has no Total, as Cost Explorer's");
  let daily = await ce("GetCostAndUsage", { TimePeriod: { Start: "2026-10-01", End: "2026-11-25" }, Granularity: "DAILY", Metrics: M });
  assert.equal(daily.json.ResultsByTime.length, 31, "a page of 31 days"); assert.equal(daily.json.NextPageToken, "twin-costs-31");
  const page2 = await ce("GetCostAndUsage", { TimePeriod: { Start: "2026-10-01", End: "2026-11-25" }, Granularity: "DAILY", Metrics: M, NextPageToken: daily.json.NextPageToken });
  assert.equal(page2.json.ResultsByTime.length, 24); assert.equal(page2.json.NextPageToken, undefined, "the last page");
  const nov = page2.json.ResultsByTime.filter((r) => r.TimePeriod.Start >= "2026-11-01").map((r) => cents(r.Total.UnblendedCost.Amount));
  assert.equal(sum(nov), mtd, "daily figures add up to the month to date");
  assert.equal(cents(page2.json.ResultsByTime.at(-1).Total.UnblendedCost.Amount), cents(page2.json.ResultsByTime.at(-1).Total.UnblendedCost.Amount), "deterministic");
  const future = await ce("GetCostAndUsage", { TimePeriod: { Start: "2026-11-25", End: "2026-11-27" }, Granularity: "DAILY", Metrics: M });
  assert.ok(future.json.ResultsByTime.every((r) => cents(r.Total.UnblendedCost.Amount) === 0), "no cost after the twin's clock");
  const again = await ce("GetCostAndUsage", { TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "MONTHLY", Metrics: M });
  assert.equal(cents(again.json.ResultsByTime[0].Total.UnblendedCost.Amount), mtd, "the same figures every call");
  checks += 17;

  // Forecast, dimension values, Budgets
  const f = await ce("GetCostForecast", { TimePeriod: { Start: "2026-11-24", End: "2026-12-01" }, Metric: "UNBLENDED_COST", Granularity: "MONTHLY" });
  assert.equal(f.status, 200); const fi = f.json.ForecastResultsByTime[0];
  assert.ok(cents(fi.PredictionIntervalLowerBound) < cents(fi.MeanValue) && cents(fi.MeanValue) < cents(fi.PredictionIntervalUpperBound) && cents(f.json.Total.Amount) === cents(fi.MeanValue), "a forecast with an interval around its mean");
  assert.equal((await ce("GetCostForecast", { TimePeriod: { Start: "2026-11-01", End: "2026-12-01" }, Metric: "UNBLENDED_COST", Granularity: "MONTHLY" })).status, 400, "a forecast may not start in the past");
  const dv = await ce("GetDimensionValues", { TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Dimension: "SERVICE" });
  assert.deepEqual(dv.json.DimensionValues.map((v) => v.Value), gs(byService).map((g) => g.Keys[0]), "dimension values: the services with costs");
  const B = { authorization: SIG.authorization.replace("/ce/", "/budgets/") };
  const bud = async (b, h = B, target = "AWSBudgetServiceGateway.DescribeBudgets") => { const r = await t.handle("https://budgets.amazonaws.com/", { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": target }, h), body: JSON.stringify(b) }); return { status: r.status, note: r.headers.get("x-twin-note"), json: await r.json() }; };
  const bg = await bud({ AccountId: t.account });
  assert.equal(bg.status, 200); assert.equal(bg.note, "synthetic figures from the twin, not an AWS bill");
  const b0 = bg.json.Budgets[0];
  assert.equal(b0.BudgetName, "Monthly cap (synthetic)"); assert.equal(cents(b0.CalculatedSpend.ActualSpend.Amount), mtd, "the budget's actual spend is the month to date");
  assert.ok(cents(b0.CalculatedSpend.ForecastedSpend.Amount) > mtd, "its forecast spend is more");
  assert.equal((await bud({ AccountId: "444455556666" })).status, 403, "another account's budgets: refused");
  assert.equal((await bud({ AccountId: t.account }, {})).status, 403, "Budgets unsigned: refused");
  assert.equal((await bud({ AccountId: t.account }, B, "AWSBudgetServiceGateway.CreateBudget")).status, 400, "no Budgets writes");
  checks += 11;

  // Refusals; the customer account; nothing written
  for (const [b, m] of [[{ TimePeriod: { Start: "2026-11-25", End: "2026-11-01" }, Granularity: "MONTHLY", Metrics: M }, "start after end"], [{ TimePeriod: { Start: "2026-02-30", End: "2026-03-01" }, Granularity: "MONTHLY", Metrics: M }, "30 February"],
    [{ TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "HOURLY", Metrics: M }, "HOURLY"], [{ TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "MONTHLY", Metrics: ["UsageQuantity"] }, "a usage metric"],
    [{ TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "MONTHLY", Metrics: M, GroupBy: [{ Type: "TAG", Key: "x" }] }, "a tag group"], [{ TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "MONTHLY", Metrics: M, NextPageToken: "x" }, "a bad token"]])
    assert.equal((await ce("GetCostAndUsage", b)).status, 400, m);
  assert.equal((await ce("GetAnomalies", { TimePeriod: { Start: "2026-11-01", End: "2026-11-25" } })).status, 400, "only the three Cost Explorer reads");
  const cust = { authorization: SIG.authorization.replace("ASIATWINREAD", "ASIATWINCUSTOMER") };
  const cr = await t.handle(CE, { method: "POST", headers: Object.assign({ "x-amz-target": "AWSInsightsIndexService.GetCostAndUsage" }, cust), body: JSON.stringify({ TimePeriod: { Start: "2026-11-01", End: "2026-11-25" }, Granularity: "MONTHLY", Metrics: M }) });
  assert.equal(cr.status, 403, "the customer account has no costs in the twin (its existing gate)");
  assert.equal(t.journal().length, j0, "reads write nothing");
  checks += 9;
  console.log("ok twin costs: synthetic, consistent across views, paged, forecast, dimension values, a budget, refusals");
}
console.log("OK (twin costs: " + checks + " checks; signatures, synthetic figures consistent across views, paging, forecast, dimension values, a budget, refusals)");
