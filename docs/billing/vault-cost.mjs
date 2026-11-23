// Cost of one Vault in a customer's account, per region and per hour: plan step 8 (docs/team/plan-vault-deploy.md on
// work/conductor.aws.a), feeding D5's cost cap and viz.aws.a's "cost so far" (storyboard 02).
// billing.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Resources from vaults design 04 (docs/vaults/2026-11-23__04-vault-deploy-design.md
// on work/vaults.aws.a) and cloudformation.aws.a's template (docs/cloudformation/vault/vault.yaml on work/cloudformation.aws.a):
// S3 bucket, Secrets Manager secret, Lambda arm64 1024 MB behind a Function URL, CloudWatch log group (30 days),
// CloudFront distribution (PriceClass_100) with a CloudFront Function for /health, optional ACM certificate and Route 53 records.
// Prices from prices.json only; nothing here reaches the network. Fixed costs and per-use costs are kept apart.
// Run: node docs/billing/vault-cost.mjs [--json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const book = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "prices.json"), "utf8"));
const P = Object.fromEntries(book.prices.map((p) => [p.id, p]));
export const price = (id, region) => {
  const p = P[id];
  if (!p) throw new Error("No row " + id + " in prices.json: not guessed");
  const v = p.global !== undefined ? p.global : p[region];
  if (typeof v !== "number") throw new Error("No " + region + " price for " + id);
  return v;
};

// The stack's own settings (vault.yaml): change here when the template changes.
export const STACK = { memoryMb: 1024, arch: "arm", logRetentionDays: 30 };

// Traffic per hour. Zero everywhere is an idle Vault.
export const IDLE = { requests: 0, responseBytes: 0, durationMs: 0, s3PutsPerRequest: 0, s3GetsPerRequest: 0, logBytesPerRequest: 0, healthChecks: 0, secretReads: 0 };

const GB = 1e9; // GB read as 10^9 bytes, as in twin-estimate.mjs and forecast.mjs

// One hour of per-use cost, by line.
function perUseHour(region, t) {
  const gbSeconds = t.requests * (Math.ceil(t.durationMs) / 1000) * (STACK.memoryMb / 1024);
  const logGb = (t.requests * t.logBytesPerRequest) / GB;
  return [
    ["lambda.request.arm", t.requests * price("lambda.request.arm", region)],
    ["lambda.duration.arm.tier1", gbSeconds * price("lambda.duration.arm.tier1", region)],
    ["cloudfront.request.https.europe", (t.requests + t.healthChecks) * price("cloudfront.request.https.europe", region)],
    ["cloudfront.transfer_out.europe.first1tb", ((t.requests * t.responseBytes) / GB) * price("cloudfront.transfer_out.europe.first1tb", region)],
    ["cloudfront.function.invocation", t.healthChecks * price("cloudfront.function.invocation", region)],
    ["cloudfront.transfer_from_aws_origin", 0 * price("cloudfront.transfer_from_aws_origin", region)],
    ["s3.request.put", t.requests * t.s3PutsPerRequest * price("s3.request.put", region)],
    ["s3.request.get", t.requests * t.s3GetsPerRequest * price("s3.request.get", region)],
    ["cloudwatch.logs.ingest.standard", logGb * price("cloudwatch.logs.ingest.standard", region)],
    ["secretsmanager.api_request", t.secretReads * price("secretsmanager.api_request", region)],
  ];
}

// The hourly series a page can draw: fixed costs at the hour they are incurred, per-use costs accruing.
// hours: how long the Vault lives; monthHours: hours in the billing month (720 for November, as forecast.mjs);
// storedGb: data in the bucket (versions included); newHostedZone: true only if the customer makes a new zone for the Vault
// (the template adds records to an existing zone and makes none itself).
export function vaultCost({ region = "eu-west-2", hours = 720, monthHours = 720, traffic = IDLE, storedGb = 0, newHostedZone = false } = {}) {
  if (!book.regions[region]) throw new Error("Region not in the price book: " + region);
  if (!(hours > 0 && monthHours > 0 && storedGb >= 0)) throw new Error("bad input");
  const t = { ...IDLE, ...traffic };
  const lines = {};
  const add = (id, kind, v) => { lines[id] = lines[id] || { id, kind, cost: 0 }; lines[id].cost += v; return v; };
  const logGbPerHour = (t.requests * t.logBytesPerRequest) / GB;
  const series = [];
  let cumulative = 0;
  for (let h = 0; h < hours; h++) {
    let fixed = 0;
    if (h === 0 && newHostedZone) fixed += add("route53.hosted_zone.first25", "fixed", price("route53.hosted_zone.first25", region)); // whole month, not prorated
    if (h === 0) add("acm.public_certificate.integrated", "fixed", price("acm.public_certificate.integrated", region));
    fixed += add("secretsmanager.secret", "fixed", price("secretsmanager.secret", region) / monthHours);       // prorated by the hour
    fixed += add("s3.storage.standard.first50tb", "fixed", (storedGb * price("s3.storage.standard.first50tb", region)) / monthHours);
    const storedLogGb = logGbPerHour * Math.min(h + 1, STACK.logRetentionDays * 24);                          // grows until retention
    fixed += add("cloudwatch.logs.storage", "fixed", (storedLogGb * price("cloudwatch.logs.storage", region)) / monthHours);
    let perUse = 0;
    for (const [id, v] of perUseHour(region, t)) perUse += add(id, "per_use", v);
    cumulative += fixed + perUse;
    series.push({ hour: h + 1, fixed, per_use: perUse, total: fixed + perUse, cumulative });
  }
  const sum = (k) => Object.values(lines).filter((l) => l.kind === k).reduce((a, l) => a + l.cost, 0);
  return {
    region, region_name: book.regions[region], hours, month_hours: monthHours, stored_gb: storedGb, new_hosted_zone: newHostedZone,
    traffic_per_hour: t, stack: STACK,
    totals: { fixed: sum("fixed"), per_use: sum("per_use"), total: sum("fixed") + sum("per_use") },
    lines: Object.values(lines), series,
    prices_version: book.retrieved, basis: "list prices before free tiers, credits and tax",
    not_priced: NOT_PRICED, total_is_lower_bound: true,
  };
}

// Lines this Vault may incur that prices.json cannot price yet: unknown, never $0. The total is a lower bound until each is priced.
export const NOT_PRICED = [
  { id: "ecr.image", cost: null, why: "Amazon ECR storage and transfer for the Lambda image: not read yet; depends on which account holds the image." },
  { id: "cloudwatch.logs.lambda_vended_tiers", cost: null, why: "Whether Lambda's own logs use the vended-log tiers instead of Standard ingestion: still to read. Standard is used, as the higher rate." },
  { id: "cloudfront.transfer_out.past_free_tb", cost: null, why: "The first 1 TB a month is $0 per account; an account already past it pays the next tier on this Vault's bytes. Not modelled." },
];

export const assumptions = [
  "Before free tiers: a cost cap should not count on them, and the customer's account may already use them.",
  "Viewers in Europe (PriceClass_100 serves from North America and Europe); every request HTTPS.",
  "CloudFront transfer out uses the page's first tier, which the page itself prices at $0 (\"First 1TB Free\"); that 1 TB is per account, so an account already past it pays cloudfront.transfer_out.europe.next9tb on this Vault's bytes. Not modelled yet.",
  "The Function URL origin's transfer to CloudFront is $0 (CloudFront page); no request goes to the Function URL directly.",
  "CloudWatch Logs at the Standard ingestion rate, and stored uncompressed: both upper bounds.",
  "Secrets Manager prorated by the hour (its page); S3 storage spread evenly over the month's hours.",
  "A new Route 53 hosted zone is charged in full at the hour it is made (not prorated); the template itself makes no zone.",
  "The token reaches the function by a dynamic reference at deploy (design 04 section 6), so no Secrets Manager calls at run time unless secretReads says so.",
  "Not priced (prices.json not_priced_yet): Amazon ECR for the image; whether Lambda logs use the vended-log tiers.",
];

// A stated traffic for the "under traffic" figure: synthetic, for scale only, to be replaced by the twin's or a real Vault's.
export const STATED = { requests: 1000, responseBytes: 20000, durationMs: 200, s3PutsPerRequest: 0.5, s3GetsPerRequest: 1, logBytesPerRequest: 500, healthChecks: 12, secretReads: 0 };

export function report() {
  const out = {};
  for (const region of Object.keys(book.regions)) {
    out[region] = {
      idle_month: vaultCost({ region, storedGb: 1 }).totals,
      stated_traffic_month: vaultCost({ region, storedGb: 1, traffic: STATED }).totals,
      ephemeral_2h_idle: vaultCost({ region, hours: 2 }).totals,
      ephemeral_2h_new_zone: vaultCost({ region, hours: 2, newHostedZone: true }).totals,
      ephemeral_2h_stated_traffic: vaultCost({ region, hours: 2, traffic: STATED }).totals,
    };
  }
  return { stated_traffic: STATED, assumptions, not_priced: NOT_PRICED, totals_are_lower_bounds: true, by_region: out };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const r = report();
  if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  const $ = (v) => "$" + (v < 0.01 ? v.toFixed(5) : v.toFixed(2));
  console.log("One Vault, list prices before free tiers (stored data 1 GB for the month figures).");
  console.log("Stated traffic per hour (synthetic): " + JSON.stringify(STATED));
  for (const [region, x] of Object.entries(r.by_region)) {
    console.log("\n" + region + " (" + book.regions[region] + ")");
    for (const [k, v] of Object.entries(x)) console.log("  " + k.padEnd(28) + " fixed " + $(v.fixed).padStart(9) + "  per use " + $(v.per_use).padStart(9) + "  total " + $(v.total));
  }
  console.log("\nNot priced (unknown, not $0; totals are lower bounds):\n- " + NOT_PRICED.map((n) => n.why).join("\n- "));
  console.log("\nAssumptions:\n- " + assumptions.join("\n- "));
}
