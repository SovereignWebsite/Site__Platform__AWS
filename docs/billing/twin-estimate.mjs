// Price model v1 run over the twin. billing.aws.c@SovereignWebsite.dinis, 23 Nov 2026.
// Reads site/twin.js (unchanged) in a sandbox, talks to it through the same endpoints the page uses,
// measures what the synthetic stack did, and prices it with docs/billing/prices.json.
// Every price comes from prices.json, which cites AWS's public pricing pages. Nothing here reaches the network.
// Run: node docs/billing/twin-estimate.mjs            (prints a table)
//      node docs/billing/twin-estimate.mjs --json     (prints the estimate as JSON)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const book = JSON.parse(readFileSync(join(here, "prices.json"), "utf8"));
const P = Object.fromEntries(book.prices.map((p) => [p.id, p]));
const REGION = "eu-west-2";
const price = (id, region = REGION) => {
  const p = P[id];
  if (!p) throw new Error("No price for " + id + ": not in prices.json, so not guessed");
  return p.global !== undefined ? p.global : p[region];
};

// ---- the twin, in a sandbox with only what it needs ----
function loadTwin() {
  const win = {};
  const ctx = vm.createContext({ window: win, TextEncoder, Response, Blob, CompressionStream, URL, URLSearchParams, setTimeout, Promise, JSON, Math, Date, String, Object, Array, Uint8Array, Uint32Array, DataView, TextDecoder, ArrayBuffer, TypeError, encodeURIComponent, decodeURIComponent, document: { baseURI: "https://twin.invalid/" } });
  vm.runInContext(readFileSync(join(root, "site", "twin.js"), "utf8"), ctx, { filename: "site/twin.js" });
  return win.AwsTwin;
}
const SIGNED = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261123/eu-west-2/s3/aws4_request" };
const SIGNED_CHANGE = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCHANGE/20261123/eu-west-2/cloudcontrolapi/aws4_request" };

async function measure() {
  const twin = loadTwin();
  const B = twin.buckets;
  // The page sets CORS before it can read a bucket; do the same through Cloud Control.
  for (const b of Object.values(B)) {
    await twin.handle("https://cloudcontrolapi.eu-west-2.amazonaws.com/", { method: "POST", headers: { ...SIGNED_CHANGE, "x-amz-target": "CloudApiService.UpdateResource" },
      body: JSON.stringify({ TypeName: "AWS::S3::Bucket", Identifier: b, PatchDocument: JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [] } }]) }) });
  }
  // Every page (ListObjectsV2 returns up to 1,000 keys a page); Key and Size are read from each Contents element.
  // (Paging and the element order were adjusted by aws.c when the twin learnt AWS's full ListObjectsV2 shape, 787735b.)
  const list = async (b) => {
    const out = []; let token = null;
    do {
      const r = await twin.handle(`https://${b}.s3.eu-west-2.amazonaws.com/?list-type=2` + (token ? "&continuation-token=" + encodeURIComponent(token) : ""), { headers: SIGNED });
      const x = await r.text();
      for (const m of x.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) out.push({ key: /<Key>([^<]*)<\/Key>/.exec(m[1])[1].replace(/&amp;/g, "&"), size: +/<Size>(\d+)<\/Size>/.exec(m[1])[1] });
      token = (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(x) || [])[1] || null;
    } while (token);
    return out;
  };
  const get = async (b, k) => new Uint8Array(await (await twin.handle(`https://${b}.s3.eu-west-2.amazonaws.com/${encodeURI(k)}`, { headers: SIGNED })).arrayBuffer());

  const stored = {};
  for (const [name, b] of Object.entries(B)) stored[name] = (await list(b)).reduce((s, o) => s + o.size, 0);

  const logFiles = (await list(B.logs)).filter((o) => o.key.endsWith(".gz"));
  const hits = [];
  for (const f of logFiles) {
    const text = gunzipSync(await get(B.logs, f.key)).toString("utf8");
    for (const line of text.split("\n").filter(Boolean)) hits.push({ raw: Buffer.byteLength(line, "utf8") + 1, ...JSON.parse(line) });
  }
  const trailFiles = (await list(B.trail)).filter((o) => o.key.endsWith(".gz"));
  const trail = [];
  for (const f of trailFiles) trail.push(...JSON.parse(gunzipSync(await get(B.trail, f.key)).toString("utf8")).Records);

  const hours = new Set(hits.map((h) => h.timestamp.slice(0, 13))).size;
  return { stored, logFiles: logFiles.length, hits, trail, hours };
}

function estimate(m) {
  const GB = 1e9; // AWS prices per GB; the model uses 10^9 bytes. To confirm against a real bill (AWS may bill per GiB).
  const lines = [];
  const add = (service, item, qty, unit, priceId, per = 1, note = "") => {
    const unitPrice = price(priceId);
    const cost = qty * unitPrice / per;
    lines.push({ service, item, qty, unit, price_id: priceId, unit_price: unitPrice, cost, note });
  };
  const reqs = m.hits.length, bytesOut = m.hits.reduce((s, h) => s + h.sc_bytes, 0);
  const europe = m.hits.every((h) => /^(LHR|DUB|AMS|FRA|CDG|MAD|MXP|ARN)/.test(h.x_edge_location));
  // CloudFront: the twin logs carry no protocol, so every request is priced as HTTPS (the dearer rate).
  add("CloudFront", "HTTPS requests (Europe)", reqs, "requests", "cloudfront.request.https.europe", 1, "Twin logs have no protocol field: priced as HTTPS. Before the free tier.");
  add("CloudFront", "Data transfer out (Europe, past first 1 TB)", bytesOut / GB, "GB", "cloudfront.transfer_out.europe.next9tb", 1, "Priced as if the first free 1 TB were used up, to show the marginal rate.");
  // S3 origin: between all cache hits (no S3 GET) and all misses (one GET per request). Shown as the upper bound.
  add("S3", "GET from CloudFront, all misses (upper bound)", reqs, "requests", "s3.request.get", 1, "Real cache hit ratio unknown on the twin; lower bound is 0.");
  add("S3", "Transfer S3 to CloudFront", bytesOut / GB, "GB", "s3.transfer.to_cloudfront");
  // Firehose: one record per log line, each billed in 5 KB increments.
  const billedBytes = m.hits.reduce((s, h) => s + Math.ceil(h.raw / 5120) * 5120, 0);
  add("Data Firehose", "Ingestion, Direct PUT (5 KB per record)", billedBytes / GB, "GB", "firehose.ingest.directput.first500tb", 1, "Assumes one record per log line; KB read as 1,024 bytes.");
  add("S3", "PUT of hourly log objects", m.logFiles, "requests", "s3.request.put");
  // Storage: what sits in the buckets, for a month.
  const storedBytes = Object.values(m.stored).reduce((a, b) => a + b, 0);
  add("S3", "Standard storage, all twin buckets, one month", storedBytes / GB, "GB-month", "s3.storage.standard.first50tb");
  // CloudTrail: management events in the first trail are free; data events cost.
  const data = m.trail.filter((r) => r.eventSource === "s3.amazonaws.com" && /Object$/.test(r.eventName)).length;
  add("CloudTrail", "Management events, first copy", m.trail.length - data, "events", "cloudtrail.management.first_copy");
  add("CloudTrail", "S3 data events (if data events are on)", data, "events", "cloudtrail.data_event", 1, "Whether the real trail records data events is unknown.");
  const total = lines.reduce((s, l) => s + l.cost, 0);
  const perHour = total / Math.max(1, m.hours);
  return { window: { hours: m.hours, requests: reqs, bytes_out: bytesOut, all_edges_in_europe: europe }, lines, total, per_hour: perHour };
}

const m = await measure();
const e = estimate(m);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ priced_with: "docs/billing/prices.json retrieved " + book.retrieved, ...e }, null, 2));
} else {
  const usd = (n) => "$" + (n < 0.01 && n > 0 ? n.toExponential(2) : n.toFixed(2));
  console.log(`Twin, account 111122223333, ${e.window.hours} logged hours: ${e.window.requests} requests, ${e.window.bytes_out} bytes out. Prices from prices.json (${book.retrieved}), ${REGION}, list prices before free tiers.`);
  for (const l of e.lines) console.log(`${l.service.padEnd(14)} ${l.item.padEnd(48)} ${String(+l.qty.toPrecision(4)).padStart(12)} ${l.unit.padEnd(9)} ${usd(l.cost).padStart(10)}`);
  console.log(`${"Total for the window".padEnd(63)} ${usd(e.total).padStart(23)}`);
  console.log(`Per logged hour: ${usd(e.per_hour)}. Synthetic data: shows the model works, not what Dinis's account costs.`);
}
