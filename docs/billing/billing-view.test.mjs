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
  assert.equal((await B.load(key, fetchAll, { refresh: true })).n, 2);
  assert.notEqual(key, B.cacheKey("123456789012", new Date("2026-11-25T10:00:00Z")));
  const bad = "bad|2026-11-24";
  await assert.rejects(B.load(bad, () => { throw new Error("AccessDenied"); }));
  assert.equal((await B.load(bad, () => "ok")), "ok");
});
