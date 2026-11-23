// Tests for the vault worked example. Run: node --test docs/vaults/example/
import test from "node:test";
import assert from "node:assert/strict";
import { makeLane, toPayload, fromContent, LIMITS } from "./lane.mjs";
import { cfRecord, net, vaultFromPath, batches } from "./records.mjs";
import { run } from "./worked-example.mjs";

const T = "0123456789abcdef0123456789abcdef", K = "k";
const lane = () => { let t = 1795000000000, s = 1; const l = makeLane({ clock: () => t++, rand: () => ((s = (s * 48271) % 2147483647) / 2147483647) }); l.configure({ tokens: [T], enum_key: K }); return l; };

test("lane: write answers exactly {ok:true} and names files {epoch_ms:013d}_{24 hex}.enc", () => {
  const l = lane();
  const r = l.write({ append_token: T, payload: toPayload({ a: 1 }) });
  assert.deepEqual(r.body, { ok: true });
  const e = l.list({ key: K }).body.entries[0];
  assert.match(e.file_id, /^\d{13}_[0-9a-f]{24}\.enc$/);
  assert.equal(e.inbox, T);
  assert.deepEqual(fromContent(l.fetch({ key: K, inbox: T, file_ids: [e.file_id] }).body.files[0].content), { a: 1 });
});

test("lane: the statuses sgit.ai states", () => {
  const l = lane();
  assert.equal(l.write({ append_token: "tok_" + T, payload: "" }).status, 400); // prefixed token
  assert.equal(l.write({ append_token: T }).status, 400);                     // missing field, JSON
  assert.equal(l.write({ append_token: "f".repeat(32), payload: "" }).status, 404); // unknown token
  assert.ok(l.write({ append_token: "f".repeat(32), payload: "" }).html);       // ... with an HTML page
  assert.equal(l.write({ append_token: T, payload: "A".repeat(LIMITS.payloadBytes + 1) }).status, 413);
  assert.equal(l.list({ key: "wrong" }).status, 404);
  assert.equal(l.fetch({ key: K, inbox: T, file_ids: Array(101).fill("0000000000000_000000000000000000000000.enc") }).status, 400);
  assert.equal(l.purge({ inbox: T, folder: "inbox" }).status, 400);
});

test("lane: the 1001st pending write is 507; list pages clamp to 200", () => {
  const l = lane();
  for (let i = 0; i < 1000; i++) assert.equal(l.write({ append_token: T, payload: toPayload(i) }).status, 200);
  assert.equal(l.write({ append_token: T, payload: toPayload(1000) }).status, 507);
  assert.equal(l.list({ key: K, page_size: 500 }).body.entries.length, 200);
  assert.equal(l.list({ key: K }).body.entries.length, 50);
});

test("lane: mark-processed twice puts the id in missing; a processed file cannot be fetched", () => {
  const l = lane();
  l.write({ append_token: T, payload: toPayload(1) });
  const id = l.list({ key: K }).body.entries[0].file_id;
  assert.deepEqual(l.markProcessed({ key: K, inbox: T, file_ids: [id] }).body, { moved: [id], missing: [] });
  assert.deepEqual(l.markProcessed({ key: K, inbox: T, file_ids: [id] }).body, { moved: [], missing: [id] });
  assert.deepEqual(l.fetch({ key: K, inbox: T, file_ids: [id] }).body.files, []);
});

test("records: vault comes from the decoded path, never from the enricher; no address, query or user agent", () => {
  const line = { timestamp: "2026-11-22T10:00:00Z", c_ip: "203.0.113.66", cs_method: "GET", cs_uri_stem: "/vault/../../etc/passwd", sc_status: 404, sc_bytes: 120,
    time_taken: 0.01, x_edge_location: "AMS1-C1", cs_user_agent: "sqlmap/1.8", country: "NL", vault_id: ".." };
  const r = cfRecord(line, { key: "k", line: 1 });
  assert.equal(r.vault, "");
  assert.equal(r.vault_claim, "..");
  assert.equal(r.net, "203.0.113.0/24");
  assert.equal(r.agent_kind, "bot");
  const text = JSON.stringify(r);
  for (const leak of ["203.0.113.66", "sqlmap", "c_ip", "client"]) assert.ok(!text.includes(leak), leak);
  assert.equal(vaultFromPath("/vault/vault-demo-001/files?key=../../secrets"), "vault-demo-001");
  assert.equal(cfRecord({ ...line, cs_uri_stem: "/vault/vault-demo-001/files?key=../../secrets", vault_id: "vault-demo-001" }, { key: "k", line: 2 }).path, "/vault/vault-demo-001/files");
  assert.equal(vaultFromPath("/vault/%2e%2e/x"), "");
  assert.equal(net("2001:db8:abcd:12::1"), "2001:db8:abcd::/48");
});

test("batches: content-hashed, stay under 2 MB of JSON", () => {
  const recs = Array.from({ length: 20000 }, (_, i) => ({ id: String(i).padStart(64, "0"), t: "2026-11-22T10:00:00Z", pad: "x".repeat(200) }));
  const bs = batches(recs, { source: "cloudfront-extract", schema: "cloudfront-extract/1", writer: "page", from: [], written_at: "t", synthetic: true });
  assert.ok(bs.length > 1);
  for (const b of bs) assert.ok(Buffer.byteLength(JSON.stringify(b)) < 2 * 1024 * 1024);
  assert.equal(bs.reduce((n, b) => n + b.records.length, 0), recs.length);
});

test("worked example, baseline: every line drained once, vault 1 commits only on change, lane emptied", async () => {
  const r = await run({ pack: "baseline" });
  assert.equal(r.snapshots.recordIds.size, r.lines);
  assert.equal(r.first.changed, true);
  assert.equal(r.again.changed, false);
  assert.equal(r.live.commits, 1);
  assert.deepEqual(r.after, { pending: 0, processed: 0 });
  assert.ok(r.graph.files["assets/cloudfront/demo-distribution-1/edges.json"].includes("writes-logs-to"));
  assert.ok(Object.keys(r.live.files).every((p) => !/\d{12}/.test(p)), "no account id in vault 1 paths");
});

test("worked example, attack: probes are refused, not vault use; nothing from vault_claim", async () => {
  const r = await run({ pack: "attack" });
  const usage = Object.entries(r.snapshots.files).filter(([p]) => p.startsWith("vault-usage/")).flatMap(([, t]) => t.split("\n").filter(Boolean).map(JSON.parse));
  const sum = (v, f) => usage.filter((u) => u.vault === v).reduce((n, u) => n + u[f], 0);
  assert.equal(sum("vault-demo-001", "refused"), 9);
  assert.ok(usage.every((u) => u.vault !== ".."));
  assert.ok(!JSON.stringify(r.snapshots.files).includes("203.0.113.66"));
});

test("worked example: a retried write duplicates nothing in vault 2", async () => {
  const once = await run({ pack: "baseline" });
  const twice = await run({ pack: "baseline", writeTwice: true });
  assert.equal(twice.writes.length, once.writes.length * 2);
  assert.equal(twice.snapshots.recordIds.size, once.snapshots.recordIds.size);
  const strip = (files) => Object.fromEntries(Object.entries(files).filter(([p]) => !p.includes("_summary")));
  assert.deepEqual(strip(twice.snapshots.files), strip(once.snapshots.files));
});
