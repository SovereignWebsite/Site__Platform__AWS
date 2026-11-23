// Tests for forecast.mjs. billing.aws.a@SovereignWebsite.dinis. Run: node --test docs/billing/forecast.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { hoursInMonth, cloudfrontTransferCost, forecast } from "./forecast.mjs";

test("hours in a calendar month", () => {
  assert.equal(hoursInMonth(2026, 11), 720);
  assert.equal(hoursInMonth(2026, 12), 744);
  assert.equal(hoursInMonth(2028, 2), 696);
});

test("CloudFront transfer: first 1,000 GB free, then the cited Europe tiers", () => {
  assert.equal(cloudfrontTransferCost(0), 0);
  assert.equal(cloudfrontTransferCost(1000), 0);
  assert.ok(Math.abs(cloudfrontTransferCost(1100) - 100 * 0.085) < 1e-9);
  assert.ok(Math.abs(cloudfrontTransferCost(11000) - (9000 * 0.085 + 1000 * 0.08)) < 1e-9);
  assert.throws(() => cloudfrontTransferCost(50001), /not guessed/);
});

const line = (o) => ({ service: "X", item: "x", unit: "u", note: "", ...o });
const est = (lines, hours = 10) => ({ window: { hours }, lines });

test("requests scale to the month and the 10 million free requests come off", () => {
  const f = forecast(est([line({ price_id: "cloudfront.request.https.europe", unit_price: 0.0000012, qty: 200000 })]), { year: 2026, month: 11 });
  const l = f.lines[0];
  assert.equal(l.qty_month, 200000 * 72);
  assert.ok(Math.abs(l.cost_after_free_tiers - (14400000 - 10000000) * 0.0000012) < 1e-9);
  assert.ok(l.cost_after_free_tiers < l.cost_before_free_tiers);
});

test("storage is not scaled; lines without a cited free tier keep their cost", () => {
  const f = forecast(est([line({ item: "Standard storage, one month", price_id: "s3.storage.standard.first50tb", unit_price: 0.024, qty: 2 })]), { year: 2026, month: 11 });
  assert.equal(f.lines[0].qty_month, 2);
  assert.equal(f.lines[0].cost_after_free_tiers, f.lines[0].cost_before_free_tiers);
  assert.match(f.lines[0].free_tier, /No free tier in prices.json/);
});

test("after free tiers never exceeds before, and never goes below zero", () => {
  const f = forecast(est([
    line({ price_id: "cloudfront.request.https.europe", unit_price: 0.0000012, qty: 5 }),
    line({ price_id: "cloudfront.transfer_out.europe.next9tb", unit_price: 0.085, qty: 0.5 }),
    line({ price_id: "s3.request.get", unit_price: 0.00000042, qty: 5 }),
  ]), { year: 2026, month: 11 });
  for (const l of f.lines) {
    assert.ok(l.cost_after_free_tiers >= 0);
    assert.ok(l.cost_after_free_tiers <= l.cost_before_free_tiers + 1e-12);
  }
});
