// CostsApi (site/api/costs-api.js) over answers in botocore's shapes (ce 2017-10-25, budgets 2016-10-20), before the
// twin answers them in full: request shapes (endpoints, signing, targets, bodies), plain objects, paging, amounts kept as
// AWS's decimal strings, refusals before any request, errors, limits, and the contract. Node 22, no network.
// Run: node test/api/costs-api.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { URLSearchParams, URL, Response, Headers, Promise, Error, TypeError, JSON, Object, Array, String, Number, RegExp, Math, Date };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["api/all.js", "api/costs-api.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { CostsApi } = ctx, A = "111122223333";
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const rejects = async (p, test, m) => { try { await p; ok(false, m + ": did not reject"); } catch (e) { ok(test(e), m + ": " + e.message); } };
const plain = (v) => JSON.parse(JSON.stringify(v));
const sent = [];
const j = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/x-amz-json-1.1" } });
function answer(req) {
  sent.push(req);
  const t = req.headers["x-amz-target"], b = JSON.parse(req.body);
  if (t === "AWSInsightsIndexService.GetCostAndUsage") {
    if (b.GroupBy) return j({ GroupDefinitions: b.GroupBy, ResultsByTime: [{ TimePeriod: { Start: "2026-11-01", End: "2026-11-02" }, Total: {}, Estimated: true,
      Groups: [{ Keys: ["Amazon Simple Storage Service"], Metrics: { UnblendedCost: { Amount: "0.1234567891", Unit: "USD" } } }, { Keys: ["<b>AWS Lambda</b>"], Metrics: { UnblendedCost: { Amount: "0.0000001", Unit: "USD" } } }, { Keys: [], Metrics: {} }] }],
      NextPageToken: b.NextPageToken ? undefined : "page-2" });
    return j({ ResultsByTime: [{ TimePeriod: { Start: b.TimePeriod.Start, End: b.TimePeriod.End }, Total: { [b.Metrics[0]]: { Amount: "42.1700000001", Unit: "USD" } }, Groups: [], Estimated: false }] });
  }
  if (t === "AWSInsightsIndexService.GetCostForecast") return j({ Total: { Amount: "61.5", Unit: "USD" }, ForecastResultsByTime: [{ TimePeriod: { Start: "2026-11-24", End: "2026-12-01" }, MeanValue: "19.33", PredictionIntervalLowerBound: "15.1", PredictionIntervalUpperBound: "23.9" }] });
  if (t === "AWSInsightsIndexService.GetDimensionValues") return j({ DimensionValues: [{ Value: "eu-west-2", Attributes: {} }, { Value: "us-east-1", Attributes: {} }, { Value: 7 }], ReturnSize: 2, TotalSize: 2 });
  if (t === "AWSBudgetServiceGateway.DescribeBudgets") return j({ Budgets: [{ BudgetName: "Monthly cap", BudgetLimit: { Amount: "10.0", Unit: "USD" }, TimeUnit: "MONTHLY", BudgetType: "COST",
    CalculatedSpend: { ActualSpend: { Amount: "4.2", Unit: "USD" }, ForecastedSpend: { Amount: "9.1", Unit: "USD" } }, TimePeriod: { Start: 1764547200, End: 3706473600 } }, { BudgetName: 3 }], NextToken: b.NextToken ? undefined : "b2" });
  return j({ __type: "com.amazon.coral.service#UnknownOperationException", message: "no" }, 400);
}
const api = CostsApi(async (req) => answer(req), { account: A });

// ---- usage ----
let u = plain(await api.usage({ start: "2026-11-01", end: "2026-11-24" }));
const r0 = sent[0];
ok(r0.service === "ce" && r0.region === "us-east-1" && r0.method === "POST" && r0.url === "https://ce.us-east-1.amazonaws.com/" && r0.headers["content-type"] === "application/x-amz-json-1.1" && r0.headers["x-amz-target"] === "AWSInsightsIndexService.GetCostAndUsage", "request: ce, us-east-1, JSON 1.1, its target");
ok(r0.body === JSON.stringify({ TimePeriod: { Start: "2026-11-01", End: "2026-11-24" }, Granularity: "MONTHLY", Metrics: ["UnblendedCost"] }), "default body: MONTHLY, UnblendedCost, no GroupBy");
ok(JSON.stringify(u) === JSON.stringify({ items: [{ start: "2026-11-01", end: "2026-11-24", estimated: false, total: { amount: "42.1700000001", unit: "USD" }, groups: [] }], next: null }), "a total: the amount kept as AWS's string");
u = plain(await api.usage({ start: "2026-11-01", end: "2026-11-02", granularity: "DAILY", groupBy: "SERVICE" }));
ok(JSON.parse(sent.at(-1).body).GroupBy[0].Type === "DIMENSION" && JSON.parse(sent.at(-1).body).GroupBy[0].Key === "SERVICE" && JSON.parse(sent.at(-1).body).Granularity === "DAILY", "groupBy SERVICE as a DIMENSION group, DAILY");
ok(u.items[0].estimated === true && u.items[0].total === null && u.items[0].groups.length === 2 && u.items[0].groups[0].amount === "0.1234567891" && u.items[0].groups[1].key === "<b>AWS Lambda</b>" && u.next === "page-2", "groups: key and amount as given (render as text), an empty group dropped, NextPageToken as next");
u = plain(await api.usage({ start: "2026-11-01", end: "2026-11-02", groupBy: "REGION", next: "page-2" }));
ok(JSON.parse(sent.at(-1).body).NextPageToken === "page-2" && u.next === null, "next goes back as NextPageToken; null on the last page");
ok(JSON.parse((await api.usage({ start: "2026-11-01", end: "2026-11-02", metric: "AmortizedCost" }), sent.at(-1).body)).Metrics[0] === "AmortizedCost", "another metric");
ok((await CostsApi.all((next) => api.usage({ start: "2026-11-01", end: "2026-11-02", groupBy: "SERVICE", next }))).items.length === 2, "CostsApi.all drains pages");

// ---- forecast, dimension values, budgets ----
const f = plain(await api.forecast({ start: "2026-11-24", end: "2026-12-01" }));
ok(JSON.parse(sent.at(-1).body).Metric === "UNBLENDED_COST" && sent.at(-1).headers["x-amz-target"] === "AWSInsightsIndexService.GetCostForecast", "forecast: its target, UNBLENDED_COST");
ok(JSON.stringify(f) === JSON.stringify({ total: { amount: "61.5", unit: "USD" }, items: [{ start: "2026-11-24", end: "2026-12-01", mean: "19.33", low: "15.1", high: "23.9" }] }), "forecast: total and interval as strings");
const d = plain(await api.dimensionValues({ dimension: "REGION", start: "2026-11-01", end: "2026-11-24" }));
ok(JSON.stringify(d) === JSON.stringify({ items: ["eu-west-2", "us-east-1"], next: null }) && JSON.parse(sent.at(-1).body).Dimension === "REGION", "dimension values: strings only");
const bg = plain(await api.budgets({ max: 500 }));
const rb = sent.at(-1);
ok(rb.service === "budgets" && rb.region === "us-east-1" && rb.url === "https://budgets.amazonaws.com/" && rb.headers["x-amz-target"] === "AWSBudgetServiceGateway.DescribeBudgets" && JSON.stringify(JSON.parse(rb.body)) === JSON.stringify({ AccountId: A, MaxResults: 100 }), "budgets: its endpoint and target, the account id, MaxResults clamped to 100");
ok(JSON.stringify(bg.items) === JSON.stringify([{ name: "Monthly cap", type: "COST", timeUnit: "MONTHLY", limit: { amount: "10.0", unit: "USD" }, actual: { amount: "4.2", unit: "USD" }, forecast: { amount: "9.1", unit: "USD" }, start: "2025-12-01", end: "2087-06-15" }]) && bg.next === "b2", "a budget: limit, actual and forecast spend, its period; a malformed one dropped");

// ---- refusals before any request ----
const n0 = sent.length;
for (const [o, m] of [[{}, "no dates"], [{ start: "2026-11-24", end: "2026-11-01" }, "start after end"], [{ start: "2026-11-01", end: "2026-11-01" }, "start equals end"], [{ start: "2026-02-30", end: "2026-03-01" }, "no 30 February"],
  [{ start: "2026-11-01T00:00:00Z", end: "2026-11-24" }, "a time"], [{ start: "2026-11-01", end: "2026-11-24", granularity: "HOURLY" }, "HOURLY"], [{ start: "2026-11-01", end: "2026-11-24", groupBy: "LINKED_ACCOUNT" }, "another group"],
  [{ start: "2026-11-01", end: "2026-11-24", metric: "__proto__" }, "a metric that is no metric"], [{ start: "2026-11-01", end: "2026-11-24", metric: "UsageQuantity" }, "a usage metric"]])
  await rejects(api.usage(o), (e) => e instanceof TypeError, "usage refused: " + m);
await rejects(api.forecast({ start: "2026-11-24", end: "2026-12-01", metric: "UnblendedCost" }), (e) => e instanceof TypeError, "forecast takes the UNBLENDED_COST form");
await rejects(api.dimensionValues({ dimension: "USAGE_TYPE", start: "2026-11-01", end: "2026-11-24" }), (e) => e instanceof TypeError, "dimension SERVICE or REGION only");
await rejects(CostsApi(async (r) => answer(r), {}).budgets(), (e) => e instanceof TypeError && /account id/.test(e.message), "budgets without an account id");
await rejects(CostsApi(async (r) => answer(r), { account: "1234" }).budgets(), (e) => e instanceof TypeError, "budgets with a malformed account id");
ok(sent.length === n0, "no request for any refused argument");

// ---- errors and limits ----
const e400 = CostsApi(async () => j({ __type: "com.amazonaws.ce#DataUnavailableException", Message: "Data is not available" }, 400));
await rejects(e400.usage({ start: "2026-11-01", end: "2026-11-24" }), (e) => e.code === "DataUnavailableException" && e.status === 400 && e.message === "DataUnavailableException: Data is not available", "an AWS error: its type after #, its message, its status");
await rejects(CostsApi(async () => new Response("<html>busy</html>", { status: 503 })).usage({ start: "2026-11-01", end: "2026-11-24" }), (e) => e.code === "HTTP 503" && !/busy/.test(e.message), "a non-JSON failure: its status, never its body");
await rejects(CostsApi(async () => new Response("not json", { status: 200 })).usage({ start: "2026-11-01", end: "2026-11-24" }), (e) => e.code === "BadAnswer", "a 200 that is not JSON");
await rejects(CostsApi(async () => { throw new TypeError("Failed to fetch"); }).usage({ start: "2026-11-01", end: "2026-11-24" }), (e) => e instanceof TypeError && e.message === "Failed to fetch", "a CORS TypeError passes through");
let read = false;
await rejects(CostsApi(async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": String(5 * 1024 * 1024) }), text: async () => { read = true; return ""; } })).usage({ start: "2026-11-01", end: "2026-11-24" }), (e) => e.code === "TooLarge", "over 4 MB by declared length");
ok(!read, "refused before reading");
await rejects(CostsApi(async () => new Response("x".repeat(4 * 1024 * 1024 + 1))).usage({ start: "2026-11-01", end: "2026-11-24" }), (e) => e.code === "TooLarge", "over 4 MB by length");
const odd = plain(await CostsApi(async () => j({ ResultsByTime: [{ TimePeriod: { Start: "x", End: "2026-11-02" }, Total: { UnblendedCost: { Amount: "1e309", Unit: "USD" } }, Groups: "no" }], NextPageToken: 5 })).usage({ start: "2026-11-01", end: "2026-11-02" }));
ok(odd.items[0].start === null && odd.items[0].total === null && odd.items[0].groups.length === 0 && odd.next === null, "odd values are dropped, never passed on");
try { CostsApi(); ok(false, "no send"); } catch (e) { ok(e instanceof TypeError, "CostsApi needs a send"); }

// ---- the contract ----
const doc = JSON.parse(readFileSync(new URL("../../site/api/costs.openapi.json", import.meta.url), "utf8"));
const ops = Object.values(doc.paths).map((p) => p.get), wire = { usage: "ce:GetCostAndUsage", forecast: "ce:GetCostForecast", dimensionValues: "ce:GetDimensionValues", budgets: "budgets:ViewBudget" };
ok(doc["x-browser-global"] === "CostsApi" && ops.map((o) => o.operationId).sort().join() === Object.keys(api).sort().join(), "contract: one operation per method");
ok(ops.every((o) => o["x-role"] === "read" && JSON.stringify(o["x-aws-actions"]) === JSON.stringify([wire[o.operationId]])), "every operation a read with exactly its action");
const roleDoc = readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8");
ok(Object.values(wire).every((a) => roleDoc.includes('"' + a + '"')), "every action is in the twin's read role costs-read (as the platform role grants it)");
const src = readFileSync(new URL("../../site/api/costs-api.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
ok(!/\beval\(|new Function|innerHTML|document\.|localStorage|fetch\(|setInterval|setTimeout/.test(src), "no eval, DOM, storage, direct fetch or timers in costs-api.js");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (costs-api: " + passed + " checks; usage, forecast, dimension values, budgets over botocore shapes, refusals, errors, contract)");
