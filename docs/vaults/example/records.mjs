// Records and batches for the snapshot lanes (design 03), and the drain that folds lanes into dated files.
// vaults.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Pure functions over plain objects: no DOM, no network.
// cfRecord is a stand-in for data.aws.a's extract module (f28ef80 on work/data.aws.a); once that lands on dev,
// the example should import it rather than keep a second copy.
import { createHash } from "node:crypto";
import { toPayload, fromContent, LIMITS } from "./lane.mjs";

export const sha = (s) => createHash("sha256").update(s).digest("hex");
const BATCH_JSON_MAX = 2 * 1024 * 1024; // design 03 section 1: two base64 layers grow it ~16/9, under the 5 MB cap

// ---- design 03, section 3.1 ----
export function net(ip) {
  if (!ip) return "";
  if (ip.includes(":")) {
    const [head, tail = ""] = ip.split("::");
    const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
    const full = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
    return full.slice(0, 3).map((g) => (parseInt(g, 16) || 0).toString(16)).join(":") + "::/48";
  }
  const p = ip.split(".");
  return p.length === 4 ? p.slice(0, 3).join(".") + ".0/24" : "";
}

export function vaultFromPath(stem) {
  let path = stem.split("?")[0];
  try { path = decodeURIComponent(path); } catch { return ""; }
  const m = /^\/vault\/([^/]+)\//.exec(path);
  return m && !m[1].includes(".") ? m[1] : "";
}

function agentKind(ua = "") {
  if (/^Mozilla\//.test(ua)) return "browser";
  if (/^(curl|python-requests|wget)\b/i.test(ua)) return "script";
  if (/sqlmap|nuclei|bot|crawler|spider/i.test(ua)) return "bot";
  return "other";
}
function kindOf(path, vault) {
  if (vault) return "vault";
  if (path === "/" || path.endsWith(".html")) return "page";
  if (/\.(css|js|ico|png|svg|woff2?)$/.test(path)) return "asset";
  if (path.startsWith("/data/") || path.endsWith(".json")) return "data";
  return "other";
}

export function cfRecord(line, src) {
  const path = line.cs_uri_stem.split("?")[0]; // the query is left out (probe strings, possibly tokens)
  const vault = vaultFromPath(line.cs_uri_stem);
  const r = {
    id: sha(["cloudfront-extract", src.key, src.line].join("\n")),
    t: line.timestamp, hour: line.timestamp.slice(0, 13) + ":00:00Z",
    method: line.cs_method, path, status: line.sc_status, bytes: line.sc_bytes, ms: Math.round(line.time_taken * 1000),
    edge: line.x_edge_location, edge_city: (line.x_edge_location || "").slice(0, 3), // the edge, not the visitor
    country: line.country || "", ...(line.city ? { city: line.city } : {}), // the enricher's claim (privacy decided 11:15 UTC)
    agent_kind: agentKind(line.cs_user_agent), kind: kindOf(path, vault), vault,
    net: net(line.c_ip), src
  };
  if (line.vault_id !== undefined && line.vault_id !== vault) r.vault_claim = line.vault_id;
  for (const [k, f] of [["request_id", "x_edge_request_id"], ["result", "x_edge_result_type"], ["host", "cs_host"]]) if (line[f] !== undefined) r[k] = line[f];
  return r;
}

// ---- design 03, section 2 ----
export function batches(records, { source, schema, writer, from, written_at, synthetic }) {
  const out = []; let cur = [], size = 0;
  const close = () => {
    if (!cur.length) return;
    const ts = cur.map((r) => r.t).sort();
    out.push({ v: 1, source, schema, writer, batch_id: sha(source + "\n" + cur.map((r) => r.id).sort().join("\n")), written_at,
      covers: { from: ts[0], to: ts[ts.length - 1] }, from, synthetic, records: cur });
    cur = []; size = 0;
  };
  for (const r of records) {
    const n = Buffer.byteLength(JSON.stringify(r), "utf8") + 1;
    if (size + n > BATCH_JSON_MAX - 4096) close();
    cur.push(r); size += n;
  }
  close();
  return out;
}

export function writeBatches(lane, token, list) {
  return list.map((b) => lane.write({ append_token: token, payload: toPayload(b) }));
}

// ---- design 03, sections 3.2 and 5: the drain ----
const SCHEMAS = new Set(["cloudfront-extract/1"]);
function validBatch(b) {
  return b && b.v === 1 && SCHEMAS.has(b.schema) && Array.isArray(b.records) && b.records.every((r) => typeof r.id === "string" && typeof r.t === "string");
}

// `state` is what the snapshot vault already holds: { files: {path: text}, batchIds: Set, recordIds: Set }.
export function drain(lane, { key, tokens, state }) {
  const seenBatches = state.batchIds, seenRecords = state.recordIds;
  const byHour = new Map(), touched = new Set();
  const summaries = new Map(); // path of the hour's _summary.json -> counts
  const sum = (path) => { if (!summaries.has(path)) summaries.set(path, JSON.parse(state.files[path] || '{"records":0,"dropped":0,"duplicates":0,"batches":[],"lane_files":[]}')); return summaries.get(path); };
  const folded = [];
  for (const inbox of tokens) {
    let after = null, ids = [];
    for (;;) {
      const page = lane.list({ key, inbox, include_content: false, after_file_id: after, page_size: LIMITS.pageMax });
      if (page.status !== 200) throw new Error("list " + page.status);
      ids.push(...page.body.entries.map((e) => e.file_id));
      if (page.body.entries.length < LIMITS.pageMax) break;
      after = page.body.entries[page.body.entries.length - 1].file_id;
    }
    for (let i = 0; i < ids.length; i += LIMITS.ids) {
      const chunk = ids.slice(i, i + LIMITS.ids);
      const got = lane.fetch({ key, inbox, file_ids: chunk });
      if (got.status !== 200) throw new Error("fetch " + got.status);
      for (const f of got.body.files) {
        let b = null; try { b = fromContent(f.content); } catch { /* counted below */ }
        const where = "_drain/" + (b && b.source ? b.source : "unknown") + "/_summary.json";
        if (!validBatch(b)) { sum(where).dropped++; folded.push({ inbox, id: f.file_id }); continue; }
        if (seenBatches.has(b.batch_id)) { sum(where).duplicates += b.records.length; folded.push({ inbox, id: f.file_id }); continue; }
        seenBatches.add(b.batch_id);
        for (const r of b.records) {
          const [y, m, d, h] = [r.t.slice(0, 4), r.t.slice(5, 7), r.t.slice(8, 10), r.t.slice(11, 13)];
          const dir = `${b.source}/${y}/${m}/${d}`;
          const s = sum(`${dir}/_summary.json`);
          if (seenRecords.has(r.id)) { s.duplicates++; continue; }
          seenRecords.add(r.id); s.records++;
          if (!s.batches.includes(b.batch_id)) s.batches.push(b.batch_id);
          if (!s.lane_files.includes(f.file_id)) s.lane_files.push(f.file_id);
          const path = `${dir}/${h}.jsonl`;
          if (!byHour.has(path)) byHour.set(path, (state.files[path] || "").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
          byHour.get(path).push({ ...r, synthetic: b.synthetic === true || undefined });
          touched.add(path);
        }
        folded.push({ inbox, id: f.file_id });
      }
    }
  }
  // Write the hour files, then vault usage from the same records, in the same "commit".
  const commit = {};
  const usage = new Map();
  for (const [path, recs] of byHour) {
    recs.sort((a, b) => (a.t === b.t ? (a.id < b.id ? -1 : 1) : a.t < b.t ? -1 : 1));
    commit[path] = recs.map((r) => JSON.stringify(r)).join("\n") + "\n";
    if (!path.startsWith("cloudfront-extract/")) continue;
    for (const r of recs) {
      if (!r.vault) continue; // never from vault_claim
      const k = r.hour + "\n" + r.vault;
      if (!usage.has(k)) usage.set(k, { t: r.hour, vault: r.vault, ok: 0, refused: 0, bytes: 0, nets: new Set(), edges: new Set(), countries: new Set(), synthetic: r.synthetic });
      const u = usage.get(k);
      if (r.status < 400) { u.ok++; u.bytes += r.bytes; } else u.refused++;
      u.nets.add(r.net); u.edges.add(r.edge_city); if (r.country) u.countries.add(r.country);
    }
  }
  const usageByHour = new Map();
  for (const u of usage.values()) {
    const path = `vault-usage/${u.t.slice(0, 4)}/${u.t.slice(5, 7)}/${u.t.slice(8, 10)}/${u.t.slice(11, 13)}.jsonl`;
    const rec = { id: sha("vault-usage\n" + u.t + "\n" + u.vault), t: u.t, vault: u.vault, ok: u.ok, refused: u.refused, bytes: u.bytes,
      nets: u.nets.size, edges: [...u.edges].sort(), countries: [...u.countries].sort(), synthetic: u.synthetic };
    if (!usageByHour.has(path)) usageByHour.set(path, []);
    usageByHour.get(path).push(rec);
  }
  for (const [path, recs] of usageByHour) commit[path] = recs.sort((a, b) => (a.vault < b.vault ? -1 : 1)).map((r) => JSON.stringify(r)).join("\n") + "\n";
  for (const [path, s] of summaries) commit[path] = JSON.stringify(s, null, 2) + "\n";
  Object.assign(state.files, commit);
  // Only after the commit is "pushed": mark processed, then purge (design 01 section 4).
  for (const inbox of tokens) {
    const mine = folded.filter((f) => f.inbox === inbox).map((f) => f.id);
    for (let i = 0; i < mine.length; i += LIMITS.ids) lane.markProcessed({ key, inbox, file_ids: mine.slice(i, i + LIMITS.ids) });
    lane.purge({ inbox, folder: "processed" });
  }
  return { commit: Object.keys(commit).sort(), folded: folded.length };
}
