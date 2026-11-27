// The twin's Cost Explorer answers for the Costs tab (billing.aws.a's site/billing.js on CostsApi): signed calls only
// (R-025 (a)); synthetic figures marked as such, the same in every view (month to date = daily for the month = by
// service = by region), each period echoing the request, the current month Estimated, paged; a forecast; dimension
// values; Budgets DescribeBudgets, signed only, one synthetic budget agreeing with Cost Explorer; reads only. Dates are relative to today
// (or the twin's clock where it has one). Node 22, no network. Run: node test/twin/costs.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { URLSearchParams, URL, TextEncoder, TextDecoder, Response, Headers, Blob, CompressionStream, DecompressionStream, Promise, Math, JSON, Date, Object, Array, String, Number, RegExp, Error, TypeError, Uint8Array, Uint32Array, ArrayBuffer, DataView,
  setTimeout: (f) => setImmediate(f), location: { search: "?twin", origin: "https://example.test" } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8"), ctx, { filename: "twin.js" });
const T = ctx.AwsTwin, CE = "https://ce.us-east-1.amazonaws.com/", NOTE = "synthetic figures from the twin, not an AWS bill";
const SIG = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/us-east-1/ce/aws4_request, SignedHeaders=host, Signature=twin" };
const call = async (action, b, h = SIG) => { const r = await T.handle(CE, { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSInsightsIndexService." + action }, h), body: JSON.stringify(b) });
  return { status: r.status, note: r.headers.get("x-twin-note"), json: await r.json() }; };
const iso = (t) => new Date(t).toISOString().slice(0, 10), DAY = 86400000, now = new Date();
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), m0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), m1 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
const c = (a) => Math.round(Number(a) * 10000), sum = (xs) => xs.reduce((a, b) => a + b, 0), M = ["UnblendedCost"];
let checks = 0;

// Signed only
const mtdBody = { TimePeriod: { Start: iso(m0), End: iso(today + DAY) }, Granularity: "MONTHLY", Metrics: M };
let r = await call("GetCostAndUsage", mtdBody, {});
assert.equal(r.status, 403); assert.equal(r.json.__type, "AccessDeniedException"); assert.ok(!("ResultsByTime" in r.json), "no figures unsigned");
assert.equal((await call("GetCostAndUsage", mtdBody, { authorization: SIG.authorization.replace("ASIATWINREAD", "AKIAREALKEY") })).status, 403, "a non-twin credential: refused");
checks += 4;

// Month to date, by service, by region, daily: one set of figures
r = await call("GetCostAndUsage", mtdBody);
assert.equal(r.status, 200); assert.equal(r.note, NOTE, "marked synthetic");
const p0 = r.json.ResultsByTime[0], mtd = c(p0.Total.UnblendedCost.Amount);
assert.deepEqual(p0.TimePeriod, mtdBody.TimePeriod, "the request's TimePeriod echoed"); assert.equal(p0.Estimated, true, "the current month is Estimated");
assert.ok(mtd > 0); assert.match(p0.Total.UnblendedCost.Amount, /^\d+\.\d{10}$/);
const svc = (await call("GetCostAndUsage", Object.assign({}, mtdBody, { GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }] }))).json.ResultsByTime[0];
const reg = (await call("GetCostAndUsage", Object.assign({}, mtdBody, { GroupBy: [{ Type: "DIMENSION", Key: "REGION" }] }))).json.ResultsByTime[0];
assert.deepEqual(svc.Groups.map((g) => g.Keys[0]), ["AWS Cost Explorer", "AWS Lambda", "AWS Secrets Manager", "Amazon CloudFront", "Amazon Simple Storage Service", "Tax"], "billing.aws.a's services, and Tax at zero");
assert.deepEqual(reg.Groups.map((g) => g.Keys[0]), ["eu-west-2", "global", "us-east-1"]);
assert.equal(sum(svc.Groups.map((g) => c(g.Metrics.UnblendedCost.Amount))), mtd, "by service adds up to the month to date");
assert.equal(sum(reg.Groups.map((g) => c(g.Metrics.UnblendedCost.Amount))), mtd, "by region adds up to the month to date");
assert.equal(c(svc.Groups.find((g) => g.Keys[0] === "Tax").Metrics.UnblendedCost.Amount), 0, "a zero group is kept");
assert.deepEqual(svc.Total, {}, "grouped: no Total, as Cost Explorer's");
const dailyBody = { TimePeriod: { Start: iso(today - 30 * DAY), End: iso(today + DAY) }, Granularity: "DAILY", Metrics: M };
const d1 = await call("GetCostAndUsage", dailyBody);
assert.equal(d1.json.ResultsByTime.length, 31); assert.equal(d1.json.NextPageToken, undefined, "31 days fit one page");
assert.equal(sum(d1.json.ResultsByTime.filter((p) => p.TimePeriod.Start >= iso(m0)).map((p) => c(p.Total.UnblendedCost.Amount))), mtd, "the month's days add up to the month to date");
const long = await call("GetCostAndUsage", { TimePeriod: { Start: iso(today - 40 * DAY), End: iso(today + DAY) }, Granularity: "DAILY", Metrics: M });
assert.equal(long.json.ResultsByTime.length, 31); assert.equal(long.json.NextPageToken, "twin-costs-31", "41 days: two pages");
const long2 = await call("GetCostAndUsage", { TimePeriod: { Start: iso(today - 40 * DAY), End: iso(today + DAY) }, Granularity: "DAILY", Metrics: M, NextPageToken: "twin-costs-31" });
assert.equal(long2.json.ResultsByTime.length, 10); assert.equal(long2.json.NextPageToken, undefined);
assert.ok((await call("GetCostAndUsage", { TimePeriod: { Start: iso(today + DAY), End: iso(today + 3 * DAY) }, Granularity: "DAILY", Metrics: M })).json.ResultsByTime.every((p) => c(p.Total.UnblendedCost.Amount) === 0), "nothing after today");
assert.equal(c((await call("GetCostAndUsage", mtdBody)).json.ResultsByTime[0].Total.UnblendedCost.Amount), mtd, "the same every call");
checks += 22;

// Forecast to month end, dimension values
const f = await call("GetCostForecast", { TimePeriod: { Start: iso(today), End: iso(m1) }, Metric: "UNBLENDED_COST", Granularity: "MONTHLY" });
assert.equal(f.status, 200); assert.equal(f.note, NOTE);
const fi = f.json.ForecastResultsByTime[0];
assert.ok(c(fi.PredictionIntervalLowerBound) < c(fi.MeanValue) && c(fi.MeanValue) < c(fi.PredictionIntervalUpperBound) && c(f.json.Total.Amount) === c(fi.MeanValue), "a forecast with an interval round its mean");
assert.equal((await call("GetCostForecast", { TimePeriod: { Start: iso(today - DAY), End: iso(m1 + DAY) }, Metric: "UNBLENDED_COST", Granularity: "MONTHLY" })).status, 400, "not from the past");
const dv = await call("GetDimensionValues", { TimePeriod: mtdBody.TimePeriod, Dimension: "REGION" });
assert.deepEqual(dv.json.DimensionValues.map((v) => v.Value), ["eu-west-2", "global", "us-east-1"]);
checks += 6;

// Budgets: one synthetic budget, signed only, the caller's account only
const bcall = async (b, h = SIG, target = "AWSBudgetServiceGateway.DescribeBudgets") => { const r = await T.handle("https://budgets.amazonaws.com/", { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": target }, h), body: JSON.stringify(b) });
  return { status: r.status, note: r.headers.get("x-twin-note"), json: await r.json() }; };
let br = await bcall({ AccountId: T.account });
assert.equal(br.status, 200); assert.equal(br.note, NOTE, "budgets marked synthetic");
const bud = br.json.Budgets;
assert.equal(bud.length, 1); assert.equal(bud[0].BudgetName, "Monthly cap (synthetic)"); assert.equal(bud[0].BudgetLimit.Amount, "10.0"); assert.equal(bud[0].TimeUnit, "MONTHLY");
assert.equal(c(bud[0].CalculatedSpend.ActualSpend.Amount), mtd, "actual spend is the month to date");
const restDays = (m1 - today - DAY) / DAY;
assert.ok(c(bud[0].CalculatedSpend.ForecastedSpend.Amount) >= mtd + restDays * 2200, "forecast spend adds the days to month end");
assert.equal((await bcall({ AccountId: T.account }, {})).status, 403, "unsigned: refused");
assert.equal((await bcall({ AccountId: "444455556666" })).status, 403, "another account: refused");
assert.equal((await bcall({ AccountId: T.account, MaxResults: 0 })).status, 400, "MaxResults 0");
assert.equal((await bcall({ AccountId: T.account, NextToken: "x" })).status, 400, "no second page");
assert.equal((await bcall({ AccountId: T.account }, SIG, "AWSBudgetServiceGateway.CreateBudget")).status, 400, "reads only");
checks += 13;
// The customer credential (dev.1.aws.a's line, where the twin has one) never reads the platform's costs or budgets
const CUST = { authorization: SIG.authorization.replace("ASIATWINREAD", "ASIATWINCUSTOMER") };
if (/ASIATWINCUSTOMER/.test(readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8"))) {
  const cb = await T.handle("https://budgets.amazonaws.com/", { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSBudgetServiceGateway.DescribeBudgets" }, CUST), body: JSON.stringify({ AccountId: T.account }) });
  assert.ok(cb.status >= 400 && !/Monthly cap/.test(await cb.text()), "a customer-signed DescribeBudgets is refused");
  const cc = await T.handle(CE, { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSInsightsIndexService.GetCostAndUsage" }, CUST), body: JSON.stringify(mtdBody) });
  assert.ok(cc.status >= 400 && !/ResultsByTime/.test(await cc.text()), "a customer-signed GetCostAndUsage is refused");
  checks += 2;
}

// Refusals and reads only
for (const [b, m] of [[{ TimePeriod: { Start: iso(today), End: iso(today) }, Granularity: "MONTHLY", Metrics: M }, "empty period"], [{ TimePeriod: { Start: "2026-02-30", End: "2026-03-02" }, Granularity: "MONTHLY", Metrics: M }, "30 February"],
  [Object.assign({}, mtdBody, { Granularity: "HOURLY" }), "HOURLY"], [Object.assign({}, mtdBody, { Metrics: ["UsageQuantity"] }), "a usage metric"], [Object.assign({}, mtdBody, { GroupBy: [{ Type: "TAG", Key: "x" }] }), "a tag"], [Object.assign({}, mtdBody, { NextPageToken: "x" }), "a bad token"],
  [Object.assign({}, mtdBody, { Metrics: ["__proto__"] }), "__proto__ is no metric"], [Object.assign({}, mtdBody, { Metrics: ["toString"] }), "toString is no metric"],
  [{ TimePeriod: { Start: "1000-01-01", End: "9999-01-01" }, Granularity: "DAILY", Metrics: M }, "a range over 14 months"]])
  assert.equal((await call("GetCostAndUsage", b)).status, 400, m);
assert.equal((await call("GetAnomalies", mtdBody)).status, 400, "only the three reads");
const t0 = Date.now(); await call("GetCostAndUsage", { TimePeriod: { Start: "1000-01-01", End: "9999-01-01" }, Granularity: "DAILY", Metrics: M });
assert.ok(Date.now() - t0 < 100, "a huge range is refused at once");
assert.equal((await call("GetCostAndUsage", { TimePeriod: { Start: iso(today - 426 * DAY), End: iso(today + DAY) }, Granularity: "MONTHLY", Metrics: M })).status, 200, "427 days is allowed");
checks += 12;
console.log("OK (twin costs: " + checks + " checks; signed only, synthetic figures the same in every view, paging, forecast, dimension values, one synthetic budget)");
