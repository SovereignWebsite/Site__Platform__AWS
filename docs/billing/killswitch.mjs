// Cost of a flood with ec2.aws.a's Vault cost kill switch on (docs/ec2/2026-11-23__03-vault-cost-kill-switch.md on
// work/ec2.aws.a, a8696af): the flood is billed from its start until the distribution is disabled at the edge.
// billing.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Prices through flood.mjs (prices.json only); no network.
// Run: node docs/billing/killswitch.mjs [--json]
import { fileURLToPath } from "node:url";
import { flood } from "./flood.mjs";

// The alarm: CloudFront Requests, Sum over periodSeconds (vault-alarm.yaml: 300 s), one evaluation period.
// A flood well above the threshold is seen at the end of the period it starts in (best case: it starts just before
// the end; worst case: just after a boundary, so a whole period). A flood near the threshold may need the whole of
// its first full period, so up to two periods. propagationMinutes: from the alarm to the edge no longer serving
// (alarm action, function, UpdateDistribution, CloudFront deployment); unknown until boto3.aws.a checks it.
export const STACK_FLOOD = { concurrency: 10, memoryMb: 1024, durationMs: 20, responseBytes: 500, logBytesPerInvocation: 300 };

export function withKillSwitch({ rps, threshold = 45000, periodSeconds = 300, propagationMinutes, region = "eu-west-2" }) {
  if (!(rps > 0 && threshold > 0 && periodSeconds > 0 && propagationMinutes >= 0)) throw new Error("bad input");
  const perHour = flood({ ...STACK_FLOOD, edgeRps: rps, region }).total;
  const perMinute = perHour / 60;
  const periodMin = periodSeconds / 60;
  const perPeriod = rps * periodSeconds;
  if (perPeriod <= threshold) {
    // Never trips: billed for as long as it lasts.
    return { region, rps, trips: false, per_hour: perHour, per_day: perHour * 24, per_30_days: perHour * 720 };
  }
  const nearThreshold = perPeriod < 2 * threshold; // may not cross until a full period has been summed
  const detectBest = nearThreshold ? periodMin : 0;
  const detectWorst = nearThreshold ? 2 * periodMin : periodMin;
  return {
    region, rps, trips: true, per_hour: perHour, propagation_minutes: propagationMinutes,
    minutes: [detectBest + propagationMinutes, detectWorst + propagationMinutes],
    cost: [(detectBest + propagationMinutes) * perMinute, (detectWorst + propagationMinutes) * perMinute],
  };
}

// The second, slow alarm (security.aws.a, R-026): the same metric summed over periodHours (24, or 6), threshold from a
// monthly figure the customer picks. Each period may spend monthlyBudget x periodHours / 720 on flood traffic.
// Worst cases: under the slow threshold forever, the flood costs about monthlyBudget a month (that is the design);
// just over it, but under the fast alarm (fastRps, 149 req/s for 45,000 in 5 minutes), it runs up to two slow periods
// plus propagation before the switch acts.
export function slowAlarm({ monthlyBudget, periodHours = 24, propagationMinutes = 15, fastRps = 149, region = "eu-west-2" }) {
  if (!(monthlyBudget > 0 && periodHours > 0 && propagationMinutes >= 0)) throw new Error("bad input");
  const perRequest = flood({ ...STACK_FLOOD, edgeRps: 1, region }).total / 3600; // below the cap, cost is linear in requests
  const allowance = (monthlyBudget * periodHours) / 720;
  const threshold = Math.floor(allowance / perRequest);
  const fastPerHour = flood({ ...STACK_FLOOD, edgeRps: fastRps, region }).total;
  return {
    region, monthly_budget: monthlyBudget, period_hours: periodHours, per_request: perRequest,
    threshold, threshold_avg_rps: threshold / (periodHours * 3600),
    worst_under_threshold_30_days: (threshold * perRequest * 720) / periodHours,
    worst_just_over_before_switch: fastPerHour * (2 * periodHours + propagationMinutes / 60),
  };
}

export const assumptions = [
  "Prices and stack as flood.mjs: 1024 MB, arm64, concurrency 10, a 20 ms 401 per request, 500 bytes back, 300 bytes of logs, eu-west-2 list prices before free tiers.",
  "Billing stops when the distribution stops serving at the edge; that a disabled distribution stops billing requests is boto3.aws.a's check in design 03, not yet confirmed.",
  "The CloudFront metric's own delay before the alarm sees it is not known and is folded into propagation.",
  "Below the threshold the switch never trips: that flood is billed for as long as it lasts.",
];

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const rows = [];
  for (const rps of [151, 10000]) for (const propagationMinutes of [5, 15, 30]) rows.push(withKillSwitch({ rps, propagationMinutes }));
  const under = withKillSwitch({ rps: 149, propagationMinutes: 0 });
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ threshold: 45000, period_seconds: 300, assumptions, rows, just_under_threshold: under }, null, 2)); process.exit(0); }
  console.log("Flood with the kill switch on: alarm at 45,000 requests in 5 minutes, one evaluation period.");
  console.log("req/s   propagation   minutes billed   cost (best to worst)");
  for (const r of rows) console.log(`${String(r.rps).padStart(5)}   ${String(r.propagation_minutes).padStart(4)} min      ${String(r.minutes[0]).padStart(2)} to ${String(r.minutes[1]).padStart(2)} min      $${r.cost[0].toFixed(2)} to $${r.cost[1].toFixed(2)}`);
  console.log(`\nJust under the threshold (149 req/s) it never trips: $${under.per_hour.toFixed(2)} an hour, $${under.per_day.toFixed(2)} a day, $${under.per_30_days.toFixed(0)} in 30 days.`);
  console.log("\nSecond, slow alarm (same metric), threshold from a monthly figure; propagation 15 min:");
  console.log("budget/month  period   threshold (requests)   avg req/s   worst under it, 30 d   worst just over, before the switch");
  for (const monthlyBudget of [5, 10, 50]) for (const periodHours of [24, 6]) {
    const s = slowAlarm({ monthlyBudget, periodHours });
    console.log(`${("$" + monthlyBudget).padStart(11)}  ${String(periodHours).padStart(4)} h  ${String(s.threshold).padStart(20)}   ${s.threshold_avg_rps.toFixed(2).padStart(9)}   ${("$" + s.worst_under_threshold_30_days.toFixed(2)).padStart(20)}   $${s.worst_just_over_before_switch.toFixed(2)}`);
  }
  console.log("- " + assumptions.join("\n- "));
}
