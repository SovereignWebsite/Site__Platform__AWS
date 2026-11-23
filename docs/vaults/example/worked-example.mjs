// Design 01 section 10 step 3: the worked example on the twin. vaults.aws.a@SovereignWebsite.dinis, 23 Nov 2026.
// One S3 bucket read into vault 1 (live reads), its CloudFront log lines appended to a lane as design 03 batches and
// drained into vault 2 (snapshots), and the edges that evidence supports written into vault 3 (the graph).
// The twin (site/twin.js, unchanged) runs in a sandbox; the lane is the in-memory stand-in (lane.mjs); the three
// vaults are plain path -> text maps. Nothing reaches the network, nothing is encrypted, every record is synthetic.
// Run: node docs/vaults/example/worked-example.mjs [--pack baseline|attack|surge] [--json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";
import { makeLane } from "./lane.mjs";
import { sha, cfRecord, batches, writeBatches, drain } from "./records.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ACCOUNT_ALIAS = "demo"; // design 01 section 3: aliases in paths, never account ids
const SIGNED = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261123/eu-west-2/s3/aws4_request" };
const SIGNED_CHANGE = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCHANGE/20261123/eu-west-2/cloudcontrolapi/aws4_request" };

export function loadTwin(pack = "baseline") {
  const win = { location: { search: "?pack=" + pack } };
  const ctx = vm.createContext({ window: win, TextEncoder, Response, Blob, CompressionStream, URL, URLSearchParams, setTimeout, Promise, JSON, Math, Date, String, Object, Array, Uint8Array, Uint32Array, DataView, TextDecoder, ArrayBuffer, TypeError, encodeURIComponent, decodeURIComponent, document: { baseURI: "https://twin.invalid/" } });
  vm.runInContext(readFileSync(join(root, "site", "twin.js"), "utf8"), ctx, { filename: "site/twin.js" });
  if (win.AwsTwin.pack() !== pack) throw new Error("twin did not load pack " + pack);
  return win.AwsTwin;
}

async function s3(twin) {
  for (const b of Object.values(twin.buckets)) { // the page sets CORS before it reads a bucket (as docs/billing/twin-estimate.mjs)
    await twin.handle("https://cloudcontrolapi.eu-west-2.amazonaws.com/", { method: "POST", headers: { ...SIGNED_CHANGE, "x-amz-target": "CloudApiService.UpdateResource" },
      body: JSON.stringify({ TypeName: "AWS::S3::Bucket", Identifier: b, PatchDocument: JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [] } }]) }) });
  }
  const list = async (b) => {
    const out = []; let token = null, requestId = "";
    do {
      const r = await twin.handle(`https://${b}.s3.eu-west-2.amazonaws.com/?list-type=2` + (token ? "&continuation-token=" + encodeURIComponent(token) : ""), { headers: SIGNED });
      requestId = r.headers.get("x-amz-request-id") || requestId;
      const x = await r.text();
      for (const m of x.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) out.push({ key: /<Key>([^<]*)<\/Key>/.exec(m[1])[1].replace(/&amp;/g, "&"), size: +/<Size>(\d+)<\/Size>/.exec(m[1])[1] });
      token = (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(x) || [])[1] || null;
    } while (token);
    return { objects: out, requestId };
  };
  const get = async (b, k) => new Uint8Array(await (await twin.handle(`https://${b}.s3.eu-west-2.amazonaws.com/${encodeURI(k)}`, { headers: SIGNED })).arrayBuffer());
  return { list, get };
}

// ---- vault 1: one file per resource, committed only when it changed (design 01 section 3) ----
export function readIntoLive(live, { alias, region, objects, requestId, readAt }) {
  const path = `${ACCOUNT_ALIAS}/${region}/s3/bucket/${alias}.json`;
  const resource = { alias, objects: objects.length, bytes: objects.reduce((s, o) => s + o.size, 0),
    prefixes: [...new Set(objects.map((o) => o.key.split("/")[0]))].sort(), api_call: "s3:ListObjectsV2", synthetic: true };
  const hash = sha(JSON.stringify(resource));
  const before = live.files[path] ? JSON.parse(live.files[path]) : null;
  if (before && before.hash === hash) return { changed: false, path };
  live.files[path] = JSON.stringify({ ...resource, hash, read_at: readAt, request_id: requestId }, null, 2) + "\n";
  const idxPath = `${ACCOUNT_ALIAS}/_index.json`;
  const idx = live.files[idxPath] ? JSON.parse(live.files[idxPath]) : {};
  idx[path] = { read_at: readAt, by: "s3:ListObjectsV2" };
  live.files[idxPath] = JSON.stringify(idx, null, 2) + "\n";
  live.commits++;
  return { changed: true, path };
}

// ---- vault 3: nodes and edges, each edge with its evidence (design 01 section 5) ----
export function buildGraph(graph, { logsAlias, logKeys, usageFiles }) {
  const put = (p, o) => { graph.files[p] = JSON.stringify(o, null, 2) + "\n"; };
  const edges = new Map();
  const edge = (from, rel, to, evidence) => { if (!edges.has(from)) edges.set(from, []); edges.get(from).push({ rel, to, evidence }); };
  const dists = new Set();
  for (const k of logKeys) {
    const m = /\/([a-z0-9-]+?)-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.gz$/.exec(k);
    if (m) dists.add(m[1]);
  }
  for (const d of dists) {
    const ev = logKeys.filter((k) => k.includes("/" + d + "-")).slice(0, 3).map((k) => ({ vault: "live", note: "log object in " + logsAlias, key: k }));
    edge(`cloudfront/${d}`, "writes-logs-to", `s3/${logsAlias}`, ev);
    put(`assets/cloudfront/${d}/node.json`, { type: "cloudfront:distribution", alias: d, synthetic: true });
  }
  put(`assets/s3/${logsAlias}/node.json`, { type: "s3:bucket", alias: logsAlias, source: `live:${ACCOUNT_ALIAS}/eu-west-2/s3/bucket/${logsAlias}.json`, synthetic: true });
  const served = new Map();
  for (const [path, text] of Object.entries(usageFiles)) for (const line of text.split("\n").filter(Boolean)) {
    const u = JSON.parse(line);
    if (u.ok > 0) { if (!served.has(u.vault)) served.set(u.vault, []); served.get(u.vault).push({ vault: "snapshots", file: path, ok: u.ok }); }
  }
  for (const [v, ev] of served) {
    put(`assets/vault/${v}/node.json`, { type: "vault", alias: v, synthetic: true });
    for (const d of dists) edge(`cloudfront/${d}`, "serves-vault", `vault/${v}`, ev.slice(0, 3));
  }
  const reverse = {};
  for (const [from, list] of edges) {
    put(`assets/${from}/edges.json`, list);
    for (const e of list) (reverse[e.rel] ||= []).push({ from, to: e.to });
  }
  for (const [rel, list] of Object.entries(reverse)) put(`maps/${rel}.json`, list);
  graph.files["live.link.json"] = JSON.stringify({ link: "live", key: "read key only (design 01 section 5); none in this example" }) + "\n";
  graph.files["snapshots.link.json"] = JSON.stringify({ link: "snapshots", key: "read key only (design 01 section 5); none in this example" }) + "\n";
}

export async function run({ pack = "baseline", writeTwice = false } = {}) {
  const twin = loadTwin(pack);
  const { list, get } = await s3(twin);
  const live = { files: {}, commits: 0 }, snapshots = { files: {}, batchIds: new Set(), recordIds: new Set() }, graph = { files: {} };

  // 1. Live read: the logs bucket into vault 1.
  const logsAlias = "logs", logsBucket = twin.buckets.logs;
  const { objects, requestId } = await list(logsBucket);
  const first = readIntoLive(live, { alias: logsAlias, region: "eu-west-2", objects, requestId, readAt: "2026-11-23T09:40:00Z" });
  const again = readIntoLive(live, { alias: logsAlias, region: "eu-west-2", objects, requestId, readAt: "2026-11-23T09:41:00Z" });

  // 2. Capture: every log line becomes a cloudfront-extract/1 record, in batches, appended to one lane per source.
  const token = sha("lane:page:cloudfront-extract").slice(0, 32), key = "enum-key-of-this-example";
  let tick = Date.parse("2026-11-23T09:42:00Z"), seed = 11;
  const lane = makeLane({ clock: () => tick++, rand: () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) });
  lane.configure({ tokens: [token], enum_key: key });
  const logKeys = objects.map((o) => o.key).filter((k) => k.endsWith(".gz")).sort();
  let lines = 0, writes = [];
  for (const k of logKeys) {
    const text = gunzipSync(await get(logsBucket, k)).toString("utf8");
    const recs = text.split("\n").filter(Boolean).map((l, i) => cfRecord(JSON.parse(l), { key: k, line: i + 1 }));
    lines += recs.length;
    const bs = batches(recs, { source: "cloudfront-extract", schema: "cloudfront-extract/1", writer: "page", from: [{ bucket_alias: logsAlias, key: k }], written_at: "2026-11-23T09:42:00Z", synthetic: true });
    writes.push(...writeBatches(lane, token, bs));
    if (writeTwice) writes.push(...writeBatches(lane, token, bs)); // a retry after a timeout: blind writes can duplicate
  }
  const pendingBefore = lane.sizes(token).pending;

  // 3. Drain into vault 2.
  const drained = drain(lane, { key, tokens: [token], state: snapshots });

  // 4. Graph into vault 3, from vaults 1 and 2 only.
  const usageFiles = Object.fromEntries(Object.entries(snapshots.files).filter(([p]) => p.startsWith("vault-usage/")));
  buildGraph(graph, { logsAlias, logKeys, usageFiles });

  return { pack, lines, writes, pendingBefore, after: lane.sizes(token), drained, first, again, live, snapshots, graph };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const r = await run({ pack: arg("--pack", "baseline") });
  const usage = Object.entries(r.snapshots.files).filter(([p]) => p.startsWith("vault-usage/")).flatMap(([, t]) => t.split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const per = {};
  for (const u of usage) { per[u.vault] ||= { ok: 0, refused: 0 }; per[u.vault].ok += u.ok; per[u.vault].refused += u.refused; }
  const out = { pack: r.pack, log_lines: r.lines, lane_writes: r.writes.length, lane_pending_before_drain: r.pendingBefore, lane_after: r.after,
    live: { files: Object.keys(r.live.files), commits: r.live.commits, second_read_changed: r.again.changed },
    snapshots: { files: Object.keys(r.snapshots.files).length, records: r.snapshots.recordIds.size, vault_usage: per },
    graph: { files: Object.keys(r.graph.files).sort() } };
  if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Pack ${out.pack}: ${out.log_lines} log lines, ${out.lane_writes} lane writes, drained to ${out.snapshots.records} records in ${out.snapshots.files} files.`);
    console.log(`Vault 1: ${out.live.files.length} files, ${out.live.commits} commit (second read unchanged: ${!out.live.second_read_changed}).`);
    for (const [v, c] of Object.entries(per)) console.log(`Vault use: ${v} ok ${c.ok}, refused ${c.refused}`);
    console.log(`Vault 3: ${out.graph.files.length} files. Synthetic data from the twin, not Dinis's account.`);
  }
}
