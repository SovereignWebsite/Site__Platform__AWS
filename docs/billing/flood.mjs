// Denial of wallet on one Vault's public Function URL: requests at the reserved-concurrency cap for a stated time.
// billing.aws.a@SovereignWebsite.dinis, 23 Nov 2026, for iam.aws.a's condition (c) (docs/iam/vault-deploy/02-deploy-role.md
// on work/iam.aws.a) and V5 (guard rails, cost cap). Prices from prices.json only; nothing here reaches the network.
// The bound: with reserved concurrency C, at most C invocations run at once, so billed duration is at most
// C x hours x 3600 seconds whatever each request takes. Request count then depends on how long each request runs.
// Run: node docs/billing/flood.mjs [--json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const book = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "prices.json"), "utf8"));
const P = Object.fromEntries(book.prices.map((p) => [p.id, p]));
const price = (id, region) => { if (!P[id]) throw new Error("No row " + id + " in prices.json: not guessed"); return P[id][region]; };

// concurrency: reserved concurrency; memoryMb: function memory; durationMs: billed time per request (Lambda bills in 1 ms steps);
// arch: "arm" (design 04 says arm64) or "x86"; hours: length of the flood.
export function flood({ concurrency, memoryMb, durationMs, hours = 1, arch = "arm", region = "eu-west-2" }) {
  if (!(concurrency > 0 && memoryMb > 0 && durationMs >= 1 && hours > 0)) throw new Error("bad input");
  const seconds = hours * 3600;
  const busySeconds = concurrency * seconds;                       // the cap: never more than C at once
  const requests = Math.floor(busySeconds * 1000 / Math.ceil(durationMs));
  const gbSeconds = busySeconds * (memoryMb / 1024);              // Lambda's GB-second uses memory in GB (MB/1024)
  const reqId = arch === "arm" ? "lambda.request.arm" : "lambda.request.x86";
  const durId = arch === "arm" ? "lambda.duration.arm.tier1" : "lambda.duration.x86.tier1";
  const requestCost = requests * price(reqId, region);
  const durationCost = gbSeconds * price(durId, region);
  return { concurrency, memoryMb, durationMs, hours, arch, region, requests, gb_seconds: gbSeconds,
    request_cost: requestCost, duration_cost: durationCost, total: requestCost + durationCost, price_ids: [reqId, durId] };
}

export const assumptions = [
  "Before free tiers: a cost cap should not count on them.",
  "Every request runs for the stated duration and the function is kept busy all the time at the cap (the attacker's best case).",
  "Requests throttled above the cap are not counted as billed invocations; to confirm on the Lambda pricing page.",
  "The server's token gates every route (design 04), so an attacker without it gets a 401: short duration, small response, no S3 call. Data transfer out, CloudWatch Logs ingestion of the function's log lines and any Function URL charge are not in prices.json yet and are left out, not treated as free.",
  "Memory, duration and the reserved-concurrency default are not set yet (design 04, iam 02): the table spans plausible values; replace them with the stack's when cloudformation.aws.a fixes them.",
];

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const rows = [];
  for (const concurrency of [2, 5, 10, 50]) for (const memoryMb of [512, 1024]) for (const durationMs of [20, 200, 1000])
    rows.push(flood({ concurrency, memoryMb, durationMs }));
  if (process.argv.includes("--json")) console.log(JSON.stringify({ priced_with: "prices.json retrieved " + book.retrieved, assumptions, rows }, null, 2));
  else {
    console.log("One hour at the reserved-concurrency cap, arm64, eu-west-2, list prices before free tiers (prices.json " + book.retrieved + ").");
    console.log("conc  mem MB  ms/req      requests   GB-s       requests $  duration $  total $");
    for (const r of rows) console.log(`${String(r.concurrency).padStart(4)}  ${String(r.memoryMb).padStart(6)}  ${String(r.durationMs).padStart(6)}  ${String(r.requests).padStart(12)}  ${String(r.gb_seconds).padStart(8)}  ${r.request_cost.toFixed(4).padStart(10)}  ${r.duration_cost.toFixed(4).padStart(10)}  ${r.total.toFixed(4).padStart(7)}`);
    for (const a of assumptions) console.log("- " + a);
  }
}
