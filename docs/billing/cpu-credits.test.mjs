// Tests for docs/billing/cpu-credits.mjs. billing.aws.a. Run: node --test docs/billing/cpu-credits.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { creditCost, T4G } from "./cpu-credits.mjs";

const near = (a, b) => Math.abs(a - b) < 1e-9;

test("credits earned per hour match vCPUs x baseline x 60 for every size (the User Guide's credit table)", () => {
  for (const f of Object.values(T4G)) assert.ok(near(f.vcpus * f.baseline * 60, f.creditsPerHour));
});

test("at or below the baseline nothing extra is billed", () => {
  const r = creditCost({ cpu: 0.05 });
  assert.equal(r.per_hour.surplus, 0);
  assert.ok(near(r.per_hour.total, 0.0047));
});

test("t4g.nano held at 100% in unlimited mode: 1.9 surplus vCPU-hours an hour at $0.04, same in both regions", () => {
  const ldn = creditCost({ cpu: 1, region: "eu-west-2" }), dub = creditCost({ cpu: 1, region: "eu-west-1" });
  assert.ok(near(ldn.surplus_vcpu_hours_per_hour, 1.9));
  assert.ok(near(ldn.per_hour.surplus, 0.076));
  assert.ok(near(ldn.per_30_days.surplus, 54.72));
  assert.equal(ldn.per_hour.surplus, dub.per_hour.surplus);
  assert.ok(ldn.times_instance > 16 && ldn.times_instance < 17.5);
});

test("standard mode bills only the instance, whatever the CPU", () => {
  const r = creditCost({ cpu: 1, mode: "standard" });
  assert.equal(r.per_hour.surplus, 0);
  assert.equal(r.times_instance, 1);
});

test("bad input is refused", () => {
  assert.throws(() => creditCost({ cpu: 1.5 }));
  assert.throws(() => creditCost({ type: "t4g.large", cpu: 0.5 }));
});
