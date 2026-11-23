// Monthly forecast from the twin's traffic, with the cited free tiers applied.
// billing.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Builds on twin-estimate.mjs (billing.aws.c), which it runs unchanged.
// Every price and every free allowance comes from prices.json, which cites AWS's public pricing pages.
// A free tier not in prices.json is not applied (the line says so), never assumed. Nothing here reaches the network.
// Run: node docs/billing/forecast.mjs           (prints a table)
//      node docs/billing/forecast.mjs --json    (prints the forecast as JSON, for a page to show)
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(here, "prices.json"), "utf8"));
const P = Object.fromEntries(book.prices.map((p) => [p.id, p]));
const REGION = "eu-west-2";
const need = (id) => {
  if (!P[id]) throw new Error("No row " + id + " in prices.json: not guessed");
  return P[id];
};
const price = (id) => (need(id).global !== undefined ? need(id).global : need(id)[REGION]);

// The month being forecast: the calendar month of the twin's window, in hours (no average month length assumed).
export function hoursInMonth(year, month1) {
  return (Date.UTC(year, month1, 1) - Date.UTC(year, month1 - 1, 1)) / 3600e3;
}

// CloudFront transfer out, Europe, pay-as-you-go tiers from prices.json. Past the tiers we hold: refuse, do not guess.
export function cloudfrontTransferCost(gb) {
  const tiers = [
    ["cloudfront.transfer_out.europe.first1tb", 1000],
    ["cloudfront.transfer_out.europe.next9tb", 9000],
    ["cloudfront.transfer_out.europe.next40tb", 40000],
  ];
  let left = gb, cost = 0;
  for (const [id, size] of tiers) {
    const q = Math.min(left, size);
    cost += q * price(id);
    left -= q;
    if (left <= 0) return cost;
  }
  throw new Error("CloudFront transfer past 50 TB a month: tier not in prices.json, not guessed");
}

// Turn the window's estimate into a month, then apply the free tiers prices.json cites.
export function forecast(est, { year, month }) {
  const monthHours = hoursInMonth(year, month);
  const scale = monthHours / Math.max(1, est.window.hours);
  const cfFree = need("cloudfront.free_tier").free;
  const out = [];
  for (const l of est.lines) {
    const monthly = /one month/.test(l.item); // storage is already a month's worth
    const qty = monthly ? l.qty : l.qty * scale;
    const before = qty * l.unit_price;
    let after = before, free = "No free tier in prices.json for this line: shown before any free tier.";
    if (l.price_id === "cloudfront.request.https.europe") {
      const billable = Math.max(0, qty - cfFree.requests);
      after = billable * l.unit_price;
      free = `CloudFront always free: ${cfFree.requests.toLocaleString("en-GB")} HTTP or HTTPS requests a month (cloudfront.free_tier).`;
    } else if (l.price_id === "cloudfront.transfer_out.europe.next9tb") {
      after = cloudfrontTransferCost(qty);
      free = `CloudFront always free: first ${cfFree.transfer_out_gb} GB out a month, then the Europe tiers (cloudfront.free_tier, cloudfront.transfer_out.europe.*).`;
    } else if (l.unit_price === 0) {
      free = "No charge at list price (see the price row).";
    }
    out.push({ service: l.service, item: l.item, unit: l.unit, price_id: l.price_id, unit_price: l.unit_price, qty_month: qty, cost_before_free_tiers: before, cost_after_free_tiers: after, free_tier: free, note: l.note });
  }
  const sum = (k) => out.reduce((s, l) => s + l[k], 0);
  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    month_hours: monthHours,
    from_window_hours: est.window.hours,
    scaling: "Requests, transfer and log volume scaled from the window's hourly rate to the whole month; storage taken as it stands.",
    lines: out,
    total_before_free_tiers: sum("cost_before_free_tiers"),
    total_after_free_tiers: sum("cost_after_free_tiers"),
    not_applied: [
      "S3 free tier and account-level credits: not in prices.json, so not applied.",
      ...book.not_priced_yet,
    ],
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const est = JSON.parse(execFileSync(process.execPath, [join(here, "twin-estimate.mjs"), "--json"], { encoding: "utf8" }));
  const [year, month] = book.retrieved.split("-").map(Number); // the twin's window sits in the month the prices were read
  const f = { priced_with: "docs/billing/prices.json retrieved " + book.retrieved, region: REGION, synthetic: true, ...forecast(est, { year, month }) };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(f, null, 2));
  } else {
    const usd = (n) => "$" + (n < 0.01 && n > 0 ? n.toExponential(2) : n.toFixed(2));
    console.log(`Forecast for ${f.month} (${f.month_hours} h) from ${f.from_window_hours} logged twin hours, ${REGION}, list prices from prices.json (${book.retrieved}).`);
    console.log(`${"".padEnd(63)} ${"before free".padStart(12)} ${"after free".padStart(12)}`);
    for (const l of f.lines) console.log(`${l.service.padEnd(14)} ${l.item.padEnd(48)} ${usd(l.cost_before_free_tiers).padStart(12)} ${usd(l.cost_after_free_tiers).padStart(12)}`);
    console.log(`${"Month".padEnd(63)} ${usd(f.total_before_free_tiers).padStart(12)} ${usd(f.total_after_free_tiers).padStart(12)}`);
    console.log("Synthetic data: shows the model works, not what Dinis's account costs. Not applied: " + f.not_applied[0]);
  }
}
