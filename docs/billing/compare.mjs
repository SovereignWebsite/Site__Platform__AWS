// Estimate beside bill: pairs Cost Explorer periods with forecast.mjs months and reports the gap.
// billing.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Nothing here reaches the network.
// Input 1: a Cost Explorer GetCostAndUsage response (ResultsByTime[] with TimePeriod, Total.UnblendedCost, Estimated).
// Input 2: forecast.mjs --json (month, total_after_free_tiers, total_before_free_tiers, synthetic).
// A bill period pairs only with an estimate for exactly the same calendar month; anything else is reported, never forced.
// Run: node docs/billing/compare.mjs [--json]   (on the twin: its Cost Explorer answer against the twin forecast)
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));

// "2026-11" -> { start: "2026-11-01", end: "2026-12-01" } (Cost Explorer's End is exclusive)
export function monthPeriod(month) {
  const [y, m] = month.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return { start: `${y}-${pad(m)}-01`, end: `${ny}-${pad(nm)}-01` };
}

export function compare(ce, forecasts) {
  const list = Array.isArray(forecasts) ? forecasts : [forecasts];
  const byPeriod = new Map(list.map((f) => { const p = monthPeriod(f.month); return [p.start + "/" + p.end, f]; }));
  const rows = [];
  for (const r of ce.ResultsByTime || []) {
    const cost = r.Total && r.Total.UnblendedCost;
    const bill = cost ? { amount: cost.Amount, unit: cost.Unit } : null;
    const tp = r.TimePeriod;
    if (!tp || !tp.Start || !tp.End) { rows.push({ status: "unpaired", reason: "the bill period has no TimePeriod, so it cannot be matched to a month", bill }); continue; }
    const f = byPeriod.get(tp.Start + "/" + tp.End);
    if (!f) { rows.push({ status: "unpaired", reason: "no estimate for this exact period", period: tp, bill }); continue; }
    if (!bill) { rows.push({ status: "unpaired", reason: "the bill period has no UnblendedCost total", period: tp }); continue; }
    if (bill.unit !== "USD") { rows.push({ status: "unpaired", reason: "bill unit is " + bill.unit + "; prices.json is in USD", period: tp, bill }); continue; }
    const billed = Number(bill.amount), est = f.total_after_free_tiers;
    rows.push({
      status: r.Estimated ? "provisional" : "final",
      period: tp, bill, bill_estimated_by_aws: !!r.Estimated,
      estimate_after_free_tiers: est, estimate_before_free_tiers: f.total_before_free_tiers,
      gap: billed - est, ratio: est > 0 ? billed / est : null,
      synthetic: !!(f.synthetic || ce.synthetic),
    });
  }
  return rows;
}

// ---- the twin's Cost Explorer answer, read the way the page reads it ----
async function twinBill() {
  const win = {};
  const ctx = vm.createContext({ window: win, TextEncoder, TextDecoder, Response, Blob, CompressionStream, URL, URLSearchParams, setTimeout, Promise, JSON, Math, Date, String, Object, Array, Uint8Array, Uint32Array, DataView, ArrayBuffer, TypeError, encodeURIComponent, decodeURIComponent, document: { baseURI: "https://twin.invalid/" } });
  vm.runInContext(readFileSync(join(here, "..", "..", "site", "twin.js"), "utf8"), ctx, { filename: "site/twin.js" });
  const r = await win.AwsTwin.handle("https://ce.us-east-1.amazonaws.com/", { method: "POST",
    headers: { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261123/us-east-1/ce/aws4_request", "x-amz-target": "AWSInsightsIndexService.GetCostAndUsage" },
    body: JSON.stringify({ TimePeriod: { Start: "2026-11-01", End: "2026-12-01" }, Granularity: "MONTHLY", Metrics: ["UnblendedCost"] }) });
  return { ...JSON.parse(await r.text()), synthetic: true };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const f = JSON.parse(execFileSync(process.execPath, [join(here, "forecast.mjs"), "--json"], { encoding: "utf8" }));
  const rows = compare(await twinBill(), f);
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(r.status === "unpaired" ? `unpaired: ${r.reason} (bill ${r.bill ? r.bill.amount + " " + r.bill.unit : "none"})` : `${r.period.Start}..${r.period.End} ${r.status}: bill $${r.bill.amount}, estimate $${r.estimate_after_free_tiers.toFixed(4)}, gap $${r.gap.toFixed(2)}${r.synthetic ? " (synthetic)" : ""}`);
}
