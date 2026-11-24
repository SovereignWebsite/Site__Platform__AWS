// Cost of CPU above the baseline on a T4g instance in unlimited mode, for ec2.aws.a's EC2 Vault (design 01 on
// work/ec2.aws.a, open item 1: "t4g instances start in unlimited credit mode by default ... (check)").
// billing.aws.a@SovereignWebsite.dinis, 24 Nov 2026. Prices from prices.json only; no network.
// Run: node docs/billing/cpu-credits.mjs [--json]
//
// The price: ec2.cpu_credit.t4g.linux, $0.04 per vCPU-hour, every size and every region (EC2 on-demand pricing page).
// The facts per size, from the EC2 User Guide (not a pricing page, so kept here rather than in prices.json):
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html (credit table:
//   credits earned per hour, vCPUs, baseline utilisation per vCPU), read 24 Nov 2026.
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode.html:
//   "T9g, T8i, T4g, T3a, and T3 instances launch as unlimited by default"; "If the average CPU usage over a
//   24-hour period exceeds the baseline, the instance is billed for the additional usage at a flat additional
//   rate per vCPU-hour." In standard mode the instance is held to its baseline instead, and nothing extra is billed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const book = JSON.parse(readFileSync(new URL("./prices.json", import.meta.url), "utf8"));
const row = (id) => { const p = book.prices.find((x) => x.id === id); if (!p) throw new Error("no price " + id); return p; };
const at = (p, region) => (p[region] !== undefined ? p[region] : p.global);

// One CPU credit is one vCPU at 100% for one minute; earned per hour = vCPUs x baseline x 60.
export const T4G = {
  "t4g.nano": { vcpus: 2, creditsPerHour: 6, baseline: 0.05 },
  "t4g.micro": { vcpus: 2, creditsPerHour: 12, baseline: 0.10 },
  "t4g.small": { vcpus: 2, creditsPerHour: 24, baseline: 0.20 },
  "t4g.medium": { vcpus: 2, creditsPerHour: 24, baseline: 0.20 },
};

// cpu: average utilisation across all vCPUs over the day, 0 to 1. Returns the instance and the surplus, per hour,
// per day and per 30 days, for one instance held at that average. mode "standard" bills no surplus.
export function creditCost({ type = "t4g.nano", cpu, region = "eu-west-2", mode = "unlimited" }) {
  const f = T4G[type];
  if (!f || !(cpu >= 0 && cpu <= 1)) throw new Error("bad input");
  const instance = at(row("ec2.ondemand.linux." + type), region);
  const price = at(row("ec2.cpu_credit.t4g.linux"), region);
  const surplusVcpuHours = mode === "unlimited" ? f.vcpus * Math.max(0, cpu - f.baseline) : 0;
  const surplus = surplusVcpuHours * price;
  const h = { instance, surplus, total: instance + surplus };
  const scale = (k) => Object.fromEntries(Object.entries(h).map(([n, v]) => [n, v * k]));
  return { type, region, mode, cpu, surplus_vcpu_hours_per_hour: surplusVcpuHours, per_hour: h, per_day: scale(24), per_30_days: scale(720),
    times_instance: instance > 0 ? h.total / instance : null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = [];
  for (const region of ["eu-west-2", "eu-west-1"]) for (const cpu of [0.05, 0.25, 0.5, 1]) for (const mode of ["unlimited", "standard"])
    rows.push(creditCost({ cpu, region, mode }));
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`${r.region} t4g.nano ${r.mode.padEnd(9)} CPU ${String(r.cpu * 100).padStart(3)}%: ` +
    `${r.per_30_days.total.toFixed(2)} USD per 30 days (instance ${r.per_30_days.instance.toFixed(2)}, surplus ${r.per_30_days.surplus.toFixed(2)}), x${r.times_instance.toFixed(1)}`);
}
