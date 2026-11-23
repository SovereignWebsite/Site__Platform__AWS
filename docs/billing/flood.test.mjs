// Tests for flood.mjs. billing.aws.a@SovereignWebsite.dinis. Run: node --test docs/billing/flood.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { flood } from "./flood.mjs";

test("duration cost is capped by concurrency, whatever each request takes", () => {
  const a = flood({ concurrency: 10, memoryMb: 1024, durationMs: 20 });
  const b = flood({ concurrency: 10, memoryMb: 1024, durationMs: 1000 });
  assert.equal(a.gb_seconds, 36000);
  assert.equal(a.gb_seconds, b.gb_seconds);
  assert.ok(Math.abs(a.duration_cost - b.duration_cost) < 1e-12);
});

test("shorter requests mean more requests, so more request charges", () => {
  const a = flood({ concurrency: 10, memoryMb: 512, durationMs: 20 });
  assert.equal(a.requests, 10 * 3600 * 50);
  assert.ok(a.request_cost > flood({ concurrency: 10, memoryMb: 512, durationMs: 200 }).request_cost);
});

test("scales linearly with concurrency and hours", () => {
  const one = flood({ concurrency: 5, memoryMb: 512, durationMs: 200 });
  const ten = flood({ concurrency: 50, memoryMb: 512, durationMs: 200 });
  const two = flood({ concurrency: 5, memoryMb: 512, durationMs: 200, hours: 2 });
  assert.ok(Math.abs(ten.total - 10 * one.total) < 1e-9);
  assert.ok(Math.abs(two.total - 2 * one.total) < 1e-9);
});

test("refuses nonsense input", () => {
  assert.throws(() => flood({ concurrency: 0, memoryMb: 512, durationMs: 20 }));
});

test("edge requests through CloudFront are billed beyond the concurrency cap", () => {
  const a = flood({ concurrency: 10, memoryMb: 1024, durationMs: 20, edgeRps: 10000 });
  const b = flood({ concurrency: 10, memoryMb: 1024, durationMs: 20, edgeRps: 20000 });
  assert.equal(a.edge_requests, 36000000);
  assert.ok(Math.abs(b.edge_request_cost - 2 * a.edge_request_cost) < 1e-9);
  assert.ok(Math.abs(a.lambda_total - b.lambda_total) < 1e-12); // Lambda stays capped
});

test("edge requests are never fewer than the requests Lambda serves", () => {
  const r = flood({ concurrency: 10, memoryMb: 1024, durationMs: 20, edgeRps: 1 });
  assert.equal(r.edge_requests, r.requests);
});

test("without edge or log inputs the total is the Lambda figure, as before", () => {
  const r = flood({ concurrency: 10, memoryMb: 1024, durationMs: 200 });
  assert.equal(r.total, r.lambda_total);
  assert.equal(r.edge_requests, 0);
});

test("a WAF rate rule adds its fixed fee and a per-request fee, never lowers the bill", () => {
  const base = { concurrency: 10, memoryMb: 1024, durationMs: 20, edgeRps: 1000 };
  const none = flood(base), rate = flood({ ...base, waf: { rules: 1 } });
  assert.ok(rate.total > none.total);
  const expected = (5 + 1) / 720 + rate.edge_requests * 6e-7;
  assert.ok(Math.abs(rate.waf_cost - expected) < 1e-9);
});
