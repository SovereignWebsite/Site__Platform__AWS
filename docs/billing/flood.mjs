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
const price = (id, region) => {
  if (!P[id]) throw new Error("No row " + id + " in prices.json: not guessed");
  const v = P[id].global !== undefined ? P[id].global : P[id][region];
  if (typeof v !== "number") throw new Error("No " + region + " price for " + id);
  return v;
};

// concurrency: reserved concurrency; memoryMb: function memory; durationMs: billed time per request (Lambda bills in 1 ms steps);
// arch: "arm" (design 04 says arm64) or "x86"; hours: length of the flood.
// Optional, all default 0 so the Lambda-only figure is unchanged:
// edgeRps: requests per second the attacker sends to the CloudFront address. CloudFront bills every one, served or
//   throttled, so this line is NOT capped by concurrency. edgeRps below what Lambda serves is raised to it.
// responseBytes: bytes CloudFront sends back per request (a 401 or 429 body and headers).
// logBytesPerInvocation: CloudWatch Logs bytes the function writes per invocation (its own lines plus Lambda's).
// waf: null, or { rules, antiDdos } for a web ACL on the distribution: { rules: 1 } is one rate-based rule;
//   antiDdos: true adds the Anti-DDoS managed rule group, whose blocked requests WAF does not charge (its page).
//   Fixed WAF fees are prorated hourly over monthHours. WAF never lowers the CloudFront request line in this model.
export function flood({ concurrency, memoryMb, durationMs, hours = 1, arch = "arm", region = "eu-west-2", edgeRps = 0, responseBytes = 0, logBytesPerInvocation = 0, waf = null, monthHours = 720 }) {
  if (!(concurrency > 0 && memoryMb > 0 && durationMs >= 1 && hours > 0 && edgeRps >= 0 && responseBytes >= 0 && logBytesPerInvocation >= 0)) throw new Error("bad input");
  const seconds = hours * 3600;
  const capRequests = Math.floor(concurrency * seconds * 1000 / Math.ceil(durationMs)); // the cap: never more than C at once
  // With no edge rate the function is kept busy at the cap (the attacker's best case); with one, Lambda serves
  // what arrives, up to the cap.
  const requests = edgeRps > 0 ? Math.min(capRequests, Math.floor(edgeRps * seconds)) : capRequests;
  const busySeconds = requests * Math.ceil(durationMs) / 1000;
  const gbSeconds = busySeconds * (memoryMb / 1024);              // Lambda's GB-second uses memory in GB (MB/1024)
  const reqId = arch === "arm" ? "lambda.request.arm" : "lambda.request.x86";
  const durId = arch === "arm" ? "lambda.duration.arm.tier1" : "lambda.duration.x86.tier1";
  const requestCost = requests * price(reqId, region);
  const durationCost = gbSeconds * price(durId, region);
  const lambdaOnly = requestCost + durationCost;
  // Edge and logs: only when asked for (edgeRps, responseBytes or logBytesPerInvocation set).
  const edgeRequests = edgeRps > 0 ? Math.max(Math.floor(edgeRps * seconds), requests) : 0;
  const edgeRequestCost = edgeRequests * price("cloudfront.request.https.europe", region);
  const edgeTransferCost = (edgeRequests * responseBytes / 1e9) * price("cloudfront.transfer_out.europe.next9tb", region); // past the free TB: a flood is when it runs out
  const logCost = (requests * logBytesPerInvocation / 1e9) * price("cloudwatch.logs.ingest.standard", region);
  let wafCost = 0;
  if (waf) {
    const fixedMonth = price("waf.web_acl", region) + (waf.rules || 0) * price("waf.rule", region) + (waf.antiDdos ? price("waf.anti_ddos_amr.month", region) : 0);
    const perReq = waf.antiDdos ? price("waf.anti_ddos_amr.request", region) : price("waf.request", region); // with the AMR on, counted as if it blocks all
    wafCost = fixedMonth * hours / monthHours + edgeRequests * perReq;
  }
  const extra = edgeRequestCost + edgeTransferCost + logCost + wafCost;
  return { concurrency, memoryMb, durationMs, hours, arch, region, requests, gb_seconds: gbSeconds,
    request_cost: requestCost, duration_cost: durationCost,
    edge_requests: edgeRequests, edge_request_cost: edgeRequestCost, edge_transfer_cost: edgeTransferCost, log_cost: logCost, waf_cost: wafCost,
    lambda_total: lambdaOnly, total: lambdaOnly + extra,
    price_ids: [reqId, durId].concat(extra ? ["cloudfront.request.https.europe", "cloudfront.transfer_out.europe.next9tb", "cloudwatch.logs.ingest.standard"] : []) };
}

export const assumptions = [
  "Before free tiers: a cost cap should not count on them.",
  "Every request runs for the stated duration and the function is kept busy all the time at the cap (the attacker's best case).",
  "Requests throttled above the cap are not counted as billed invocations; to confirm on the Lambda pricing page.",
  "The server's token gates every route (design 04), so an attacker without it gets a 401: short duration, small response, no S3 call.",
  "Through CloudFront, every request is billed at the edge whether Lambda serves it or throttles it: that line grows with the attacker's rate, not with concurrency. CloudFront's per-request price is used past its free 10 million, and transfer at the 1 to 10 TB tier (a flood is when the free TB runs out). A request sent straight to the Function URL skips CloudFront and pays only the Lambda lines.",
  "Log bytes per invocation and the attacker's rate are inputs, not known: the table spans values. Logs at the Standard ingestion rate (an upper bound; whether Lambda's logs use the vended tiers is still to read).",
  "Stack defaults from cloudformation.aws.a's vault.yaml: 1024 MB, arm64, reserved concurrency 10, timeout 30 s.",
  "AWS WAF bills every request it inspects whatever the action (its page), so a rate rule adds cost during a flood rather than removing it; with the Anti-DDoS managed rule group, blocked requests are not charged as WAF requests but its own per-request fee applies (counted on every request here, an upper bound). Whether CloudFront bills requests WAF blocks is not stated on the pages read, so the CloudFront line is kept.",
];

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const rows = [];
  for (const concurrency of [2, 5, 10, 50]) for (const memoryMb of [512, 1024]) for (const durationMs of [20, 200, 1000])
    rows.push(flood({ concurrency, memoryMb, durationMs }));
  const stack = [0, 1000, 10000].flatMap((edgeRps) => [300, 1000].map((logBytesPerInvocation) => flood({ concurrency: 10, memoryMb: 1024, durationMs: 20, edgeRps, responseBytes: 500, logBytesPerInvocation })));
  if (process.argv.includes("--json")) console.log(JSON.stringify({ priced_with: "prices.json retrieved " + book.retrieved, assumptions, rows, stack_through_cloudfront: stack }, null, 2));
  else {
    console.log("One hour at the reserved-concurrency cap, arm64, eu-west-2, list prices before free tiers (prices.json " + book.retrieved + ").");
    console.log("conc  mem MB  ms/req      requests   GB-s       requests $  duration $  total $");
    for (const r of rows) console.log(`${String(r.concurrency).padStart(4)}  ${String(r.memoryMb).padStart(6)}  ${String(r.durationMs).padStart(6)}  ${String(r.requests).padStart(12)}  ${String(r.gb_seconds).padStart(8)}  ${r.request_cost.toFixed(4).padStart(10)}  ${r.duration_cost.toFixed(4).padStart(10)}  ${r.total.toFixed(4).padStart(7)}`);
    console.log("\nThe stack as written (1024 MB, concurrency 10, 20 ms per 401), one hour, eu-west-2 (edge req/s 0 = sent straight to the Function URL):");
    console.log("edge req/s  log B/inv  resp B     lambda $   edge req $  edge out $   logs $    total $");
    for (const edgeRps of [0, 1000, 10000]) for (const logBytesPerInvocation of [300, 1000]) {
      const r = flood({ concurrency: 10, memoryMb: 1024, durationMs: 20, edgeRps, responseBytes: 500, logBytesPerInvocation });
      console.log(`${String(edgeRps).padStart(10)}  ${String(logBytesPerInvocation).padStart(9)}  ${"500".padStart(6)}  ${r.lambda_total.toFixed(2).padStart(9)}  ${r.edge_request_cost.toFixed(2).padStart(10)}  ${r.edge_transfer_cost.toFixed(2).padStart(10)}  ${r.log_cost.toFixed(2).padStart(7)}  ${r.total.toFixed(2).padStart(8)}`);
    }
    console.log("\nWith a web ACL, 10,000 req/s, 300 B logs: what WAF adds, not what it saves:");
    for (const [name, waf] of [["no WAF", null], ["rate rule", { rules: 1 }], ["rate rule + Anti-DDoS AMR", { rules: 1, antiDdos: true }]]) {
      const r = flood({ concurrency: 10, memoryMb: 1024, durationMs: 20, edgeRps: 10000, responseBytes: 500, logBytesPerInvocation: 300, waf });
      console.log(`  ${name.padEnd(28)} waf $${r.waf_cost.toFixed(2).padStart(6)}  total $${r.total.toFixed(2)} an hour`);
    }
    for (const a of assumptions) console.log("- " + a);
  }
}
