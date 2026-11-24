// Tests for site/billing.js (the Costs view). billing.aws.a. Run: node --test docs/billing/billing-view.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const B = require("../../site/billing.js");
const F = JSON.parse(readFileSync(new URL("./fixtures/costs-synthetic.json", import.meta.url), "utf8"));

test("requests: month to date, by service, by region, daily 30 days, forecast to month end, budgets", () => {
  const r = B.requests(new Date("2026-11-24T15:00:00Z"), "123456789012");
  const by = Object.fromEntries(r.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(by).sort(), ["budgets", "byRegion", "byService", "daily", "forecast", "monthToDate"]);
  assert.deepEqual(by.monthToDate.payload.TimePeriod, { Start: "2026-11-01", End: "2026-11-24" });
  assert.equal(by.byService.payload.GroupBy[0].Key, "SERVICE");
  assert.equal(by.byRegion.payload.GroupBy[0].Key, "REGION");
  assert.deepEqual(by.daily.payload.TimePeriod, { Start: "2026-10-25", End: "2026-11-24" });
  assert.equal(by.daily.payload.Granularity, "DAILY");
  assert.deepEqual(by.forecast.payload.TimePeriod, { Start: "2026-11-24", End: "2026-12-01" });
  assert.equal(by.budgets.payload.AccountId, "123456789012");
  assert.equal(r.filter((x) => x.service === "ce").length, 5); // at most five charged Cost Explorer requests
});

test("on the 1st there is no month to date, so those calls are skipped; no account id, no budgets call", () => {
  const names = B.requests(new Date("2026-12-01T09:00:00Z")).map((x) => x.name);
  assert.ok(!names.includes("monthToDate") && !names.includes("byService") && !names.includes("budgets"));
  assert.ok(names.includes("forecast") && names.includes("daily"));
});

test("model: totals, end-of-month forecast, groups largest first without zero lines, budgets used", () => {
  const m = B.model(F);
  assert.equal(m.monthToDate.amount, 42.17);
  assert.ok(Math.abs(m.endOfMonth.amount - (42.17 + 11.83)) < 1e-9);
  assert.equal(m.byService[0].key, "Amazon CloudFront");
  assert.ok(m.byService.every((g, i, a) => i === 0 || a[i - 1].amount >= g.amount));
  assert.ok(!m.byService.some((g) => g.key === "Tax"));
  assert.equal(m.daily.length, 3);
  assert.ok(Math.abs(m.budgets[0].used - 42.17 / 60) < 1e-9);
});

test("model: a missing or failed call stays null and is reported, never shown as 0", () => {
  const m = B.model({ monthToDate: F.monthToDate, forecast: { error: "AccessDenied" } });
  assert.equal(m.forecastRest, null);
  assert.equal(m.endOfMonth, null);
  assert.equal(m.byService, null);
  assert.equal(m.errors.forecast, "AccessDenied");
  assert.equal(B.fmt(m.endOfMonth), "not read");
});

test("amounts are written as mask.js's cost form, and links go to AWS's own pages", () => {
  assert.equal(B.fmt({ amount: 42.17, unit: "USD" }), "42.17 USD");
  assert.ok(/\b\d[\d,]*\.\d{2}(\s?(?:USD|EUR|GBP))/.test(B.fmt({ amount: 3, unit: "USD" })));
  for (const u of Object.values(B.LINKS)) assert.match(u, /^https:\/\/(docs\.aws\.amazon\.com|console\.aws\.amazon\.com|aws\.amazon\.com)\//);
});

// A minimal DOM, enough for render(): checks every amount sits in a data-mask element.
function fakeDoc() {
  const mk = (tag) => ({ tag, attrs: {}, kids: [], textContent: "", setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.kids.push(c); return c; } });
  return { createElement: mk, createTextNode: (t) => ({ tag: "#text", textContent: t, kids: [], attrs: {} }) };
}
function walk(n, f, masked = false) { const m = masked || "data-mask" in (n.attrs || {}); f(n, m); (n.kids || []).forEach((k) => walk(k, f, m)); }

test("render: every amount is inside a data-mask element, so screenshot mode hides it", () => {
  const box = B.render(B.model(F), fakeDoc(), { synthetic: true });
  let amounts = 0;
  walk(box, (n, masked) => {
    if (/\d\.\d{2} USD/.test(n.textContent)) { amounts++; assert.ok(masked, "unmasked amount: " + n.textContent); }
    if (n.tag === "a") assert.equal(n.attrs.rel, "noopener");
  });
  assert.ok(amounts >= 10);
});

test("load keeps answers for the tab session; only refresh asks AWS again; a failure is not kept", async () => {
  B.forget();
  let calls = 0;
  const fetchAll = () => { calls++; return { n: calls }; };
  const key = B.cacheKey("123456789012", new Date("2026-11-24T10:00:00Z"));
  assert.equal((await B.load(key, fetchAll)).n, 1);
  assert.equal((await B.load(key, fetchAll)).n, 1);
  assert.equal((await B.load(key, fetchAll, { refresh: true })).n, 1); // refresh within 5 minutes: kept answer
  const later = Date.now() + B.REFRESH_MS + 1;
  assert.equal((await B.load(key, fetchAll, { refresh: true, now: later })).n, 2);
  assert.equal(B.refreshAllowedIn(key, later + 1000), B.REFRESH_MS - 1000);
  assert.notEqual(key, B.cacheKey("123456789012", new Date("2026-11-25T10:00:00Z")));
  const bad = "bad|2026-11-24";
  await assert.rejects(B.load(bad, () => { throw new Error("AccessDenied"); }));
  assert.equal((await B.load(bad, () => "ok")), "ok");
});

test("odd answers (no Total, no Metrics, no Keys) give 'not read' for that section only, never throw (L1)", () => {
  const odd = {
    monthToDate: { ResultsByTime: [{ TimePeriod: { Start: "2026-11-01", End: "2026-11-24" } }] },
    byService: { ResultsByTime: [{ Groups: [{ Keys: ["AWS Lambda"] }, { Metrics: { UnblendedCost: { Amount: "1.00", Unit: "USD" } } }] }] },
    daily: { ResultsByTime: [{ TimePeriod: { Start: "2026-11-23" } }] },
    byRegion: F.byRegion, forecast: { Total: null }, budgets: { Budgets: [{ BudgetName: "x" }] },
  };
  const m = B.model(odd);
  assert.equal(m.monthToDate, null);
  assert.ok(m.errors.monthToDate);
  assert.equal(m.byService.length, 1);           // the group without Metrics is dropped, the other kept
  assert.equal(m.byService[0].key, "");
  assert.equal(m.daily[0].amount, null);         // missing amount stays null, not 0
  assert.equal(m.byRegion.length, 3);            // a good section is unaffected
  assert.equal(m.forecastRest, null);
  assert.equal(m.budgets[0].used, null);
  B.render(m, fakeDoc());                        // and the view still renders
});

// CostsApi (dev.2.aws.a, site/api/costs-api.js) answers: amounts as decimal strings, pages via next.
function fakeCostsApi() {
  const calls = [];
  const usage = async (o) => {
    calls.push(["usage", o]);
    if (o.granularity === "DAILY") return o.next ? { items: [{ start: "2026-11-23", end: "2026-11-24", estimated: true, total: { amount: "0.40", unit: "USD" }, groups: [] }], next: null }
      : { items: [{ start: "2026-11-22", end: "2026-11-23", estimated: true, total: { amount: "0.60", unit: "USD" }, groups: [] }], next: "p2" };
    if (o.groupBy === "SERVICE") return { items: [{ start: "2026-11-01", end: "2026-11-24", estimated: true, total: null, groups: [{ key: "AWS Lambda", amount: "0.25", unit: "USD" }, { key: "Amazon CloudFront", amount: "0.75", unit: "USD" }] }], next: null };
    if (o.groupBy === "REGION") throw Object.assign(new Error("AccessDeniedException: not allowed"), { code: "AccessDeniedException" });
    return { items: [{ start: "2026-11-01", end: "2026-11-24", estimated: true, total: { amount: "1.00", unit: "USD" }, groups: [] }], next: null };
  };
  return { calls, usage, forecast: async (o) => { calls.push(["forecast", o]); return { total: { amount: "0.50", unit: "USD" }, items: [] }; },
    budgets: async (o) => { calls.push(["budgets", o]); return { items: [{ name: "cap", type: "COST", timeUnit: "MONTHLY", limit: { amount: "2.00", unit: "USD" }, actual: { amount: "1.00", unit: "USD" }, forecast: null }], next: null }; } };
}

test("fetchAll over CostsApi: pages drained, a failed section isolated, model adds up", async () => {
  const api = fakeCostsApi();
  const r = await B.fetchAll(api, new Date("2026-11-24T12:00:00Z"), "123456789012");
  const m = B.modelFromApi(r);
  assert.equal(m.monthToDate.amount, 1);
  assert.equal(m.endOfMonth.amount, 1.5);
  assert.deepEqual(m.byService.map((g) => g.key), ["Amazon CloudFront", "AWS Lambda"]);
  assert.equal(m.byRegion, null);
  assert.match(m.errors.byRegion, /AccessDenied/);
  assert.equal(m.daily.length, 2);                       // two pages merged
  assert.equal(m.budgets[0].used, 0.5);
  assert.deepEqual(api.calls.find((c) => c[0] === "forecast")[1], { start: "2026-11-24", end: "2026-12-01", granularity: "MONTHLY" });
  assert.equal(api.calls.filter((c) => c[0] === "usage").length, 5);   // 3 monthly + 2 daily pages
  B.render(m, fakeDoc());
});

test("CostsApi v2 shape (numbers, pages merged inside usage, maxPages) and Budgets refused by CORS", async () => {
  const seen = [];
  const api = {
    usage: async (o) => { seen.push(o); return { items: [{ start: "2026-11-01", end: "2026-11-24", estimated: true, total: { amount: 2.5, unit: "USD" },
      groups: [{ key: "Tax", amount: 0, unit: "USD" }, { key: "AWS Lambda", amount: 2.5, unit: "USD" }] }], capped: false }; },
    forecast: async () => ({ total: { amount: 1, unit: "USD" }, start: "2026-11-24", end: "2026-12-01", items: [] }),
    budgets: async () => { throw new TypeError("Failed to fetch"); },
  };
  const m = B.modelFromApi(await B.fetchAll(api, new Date("2026-11-24T12:00:00Z"), "123456789012"));
  assert.equal(m.monthToDate.amount, 2.5);
  assert.equal(m.endOfMonth.amount, 3.5);
  assert.deepEqual(m.byService.map((g) => g.key), ["AWS Lambda"]);   // the zero Tax line is dropped
  assert.equal(m.budgets, null);
  assert.match(m.errors.budgets, /cannot be read from a browser/);
  assert.ok(seen.every((o) => o.maxPages === 3 || (o.granularity === "DAILY" && o.maxPages === 5)));
});
