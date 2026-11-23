import { test } from "node:test";
import assert from "node:assert/strict";
import { vaultCost, price, STATED } from "./vault-cost.mjs";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " != " + b);

test("idle Vault for a whole month costs the secret plus storage, and nothing per use", () => {
  const r = vaultCost({ region: "eu-west-2", storedGb: 1 });
  close(r.totals.per_use, 0);
  close(r.totals.fixed, price("secretsmanager.secret", "eu-west-2") + price("s3.storage.standard.first50tb", "eu-west-2") + 0.09 * price("ecr.storage", "eu-west-2"));
});

test("a two-hour ephemeral Vault pays two hours of the secret, prorated", () => {
  const r = vaultCost({ region: "eu-west-1", hours: 2, imageGb: 0 });
  close(r.totals.total, (2 * price("secretsmanager.secret", "eu-west-1")) / 720);
  assert.equal(r.series.length, 2);
});

test("a new hosted zone is charged in full at hour 1, not prorated", () => {
  const r = vaultCost({ hours: 2, newHostedZone: true });
  assert.ok(r.series[0].fixed > r.series[1].fixed);
  close(r.series[0].fixed - r.series[1].fixed, price("route53.hosted_zone.first25", "eu-west-2"));
});

test("cumulative series ends at the total, and fixed and per-use stay apart", () => {
  const r = vaultCost({ hours: 24, traffic: STATED, storedGb: 2 });
  close(r.series.at(-1).cumulative, r.totals.total);
  close(r.totals.fixed + r.totals.per_use, r.totals.total);
  assert.ok(r.lines.every((l) => l.kind === "fixed" || l.kind === "per_use"));
});

test("per-use cost scales with requests", () => {
  const a = vaultCost({ hours: 1, traffic: STATED }).totals.per_use;
  const b = vaultCost({ hours: 1, traffic: { ...STATED, requests: 2 * STATED.requests, healthChecks: 2 * STATED.healthChecks } }).totals.per_use;
  close(b, 2 * a);
});

test("unknown region or missing price is refused, never guessed", () => {
  assert.throws(() => vaultCost({ region: "us-east-1" }));
  assert.throws(() => price("ebs.gp3.storage", "eu-west-2"));
});

test("not-priced lines are reported as unknown (null), never $0", () => {
  const r = vaultCost({ hours: 1 });
  assert.ok(r.not_priced.length >= 2);
  assert.ok(r.not_priced.every((n) => n.cost === null));
  assert.equal(r.total_is_lower_bound, true);
});
