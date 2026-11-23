import { test } from "node:test";
import assert from "node:assert/strict";
import { withKillSwitch } from "./killswitch.mjs";

test("a flood under the threshold never trips and is billed by the hour", () => {
  const r = withKillSwitch({ rps: 149, propagationMinutes: 15 });
  assert.equal(r.trips, false);
  assert.ok(Math.abs(r.per_30_days - r.per_hour * 720) < 1e-9);
});

test("a large flood is billed for at most one period plus propagation", () => {
  const r = withKillSwitch({ rps: 10000, propagationMinutes: 15 });
  assert.equal(r.trips, true);
  assert.deepEqual(r.minutes, [15, 20]);
  assert.ok(Math.abs(r.cost[1] - (20 * r.per_hour) / 60) < 1e-9);
});

test("near the threshold detection can take up to two periods", () => {
  const r = withKillSwitch({ rps: 151, propagationMinutes: 5 });
  assert.deepEqual(r.minutes, [10, 15]);
});
