// Tests for compare.mjs. billing.aws.a@SovereignWebsite.dinis. Run: node --test docs/billing/compare.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { monthPeriod, compare } from "./compare.mjs";

const f = { month: "2026-11", total_after_free_tiers: 0.5, total_before_free_tiers: 2, synthetic: false };
const period = (s, e) => ({ Start: s, End: e });
const row = (tp, amount, extra = {}) => ({ TimePeriod: tp, Total: { UnblendedCost: { Amount: amount, Unit: "USD" } }, ...extra });

test("month periods use Cost Explorer's exclusive end, across a year end", () => {
  assert.deepEqual(monthPeriod("2026-11"), { start: "2026-11-01", end: "2026-12-01" });
  assert.deepEqual(monthPeriod("2026-12"), { start: "2026-12-01", end: "2027-01-01" });
});

test("a matching month pairs; gap and ratio use the after-free-tier estimate", () => {
  const [r] = compare({ ResultsByTime: [row(period("2026-11-01", "2026-12-01"), "1.50")] }, f);
  assert.equal(r.status, "final");
  assert.ok(Math.abs(r.gap - 1.0) < 1e-12);
  assert.equal(r.ratio, 3);
});

test("AWS's Estimated flag makes the pair provisional", () => {
  const [r] = compare({ ResultsByTime: [row(period("2026-11-01", "2026-12-01"), "1.50", { Estimated: true })] }, f);
  assert.equal(r.status, "provisional");
});

test("no TimePeriod, another period, or another currency: reported, never forced", () => {
  const rows = compare({ ResultsByTime: [
    { Total: { UnblendedCost: { Amount: "42.17", Unit: "USD" } } },
    row(period("2026-10-01", "2026-11-01"), "3.00"),
    { TimePeriod: period("2026-11-01", "2026-12-01"), Total: { UnblendedCost: { Amount: "1", Unit: "EUR" } } },
  ] }, f);
  assert.deepEqual(rows.map((r) => r.status), ["unpaired", "unpaired", "unpaired"]);
  assert.match(rows[0].reason, /TimePeriod/);
});

test("synthetic on either side marks the pair synthetic", () => {
  const [r] = compare({ synthetic: true, ResultsByTime: [row(period("2026-11-01", "2026-12-01"), "1")] }, f);
  assert.equal(r.synthetic, true);
});
