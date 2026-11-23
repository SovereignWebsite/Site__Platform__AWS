// The extract module (site/data/extract.js) against the twin's CloudFront logs, all three packs, and
// against hand-made inputs for the formats the twin does not produce. Node 22; no network.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ": got " + JSON.stringify(a) + ", want " + JSON.stringify(b)); };
globalThis.window = globalThis;
new Function(readFileSync(new URL("../../site/data/extract.js", import.meta.url), "utf8"))();
const X = globalThis.LogExtract;
const twinSrc = readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8");
const auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
const tags = (x, n) => [...x.matchAll(new RegExp("<" + n + ">([^<]*)</" + n + ">", "g"))].map((m) => m[1]);

async function loadPack(pack) {
  globalThis.location = { origin: "http://localhost", search: "?pack=" + pack };
  new Function(twinSrc)();
  const T = globalThis.AwsTwin; T.reset();
  if (T.pack() !== pack) fail("twin did not load pack " + pack);
  const base = "https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/";
  const get = (q) => T.handle(base + q, { method: "GET", headers: auth });
  const x = await (await get("?list-type=2&prefix=cloudfront%2F")).text();
  const keys = tags(x, "Key"), sizes = tags(x, "Size");
  const objects = keys.map((k, i) => ({ Key: k, Size: +sizes[i] }));
  const files = [];
  for (const k of keys) files.push({ key: k, bytes: new Uint8Array(await (await get(k)).arrayBuffer()) });
  return { objects, files };
}

async function run(pack) {
  const { objects, files } = await loadPack(pack);
  const d = X.discover(objects);
  eq(d.files, 9, pack + " files"); eq(d.hours.length, 9, pack + " hours"); eq(d.other, [], pack + " keys outside the hourly layout");
  eq(d.first, "2026-11-20T09", pack + " first hour"); eq(d.last, "2026-11-22T11", pack + " last hour");
  eq(d.gaps.map((g) => g.hours), [21, 21], pack + " gaps (12:00 to 08:59 each night)");
  const recs = [], skipped = []; let independent = [];
  for (const f of files) {
    const text = await X.gunzip(f.bytes);
    const r = X.read(text, f.key);
    r.records.forEach((x) => recs.push(X.normalise(x))); skipped.push(...r.skipped);
    independent.push(...text.split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  }
  eq(skipped, [], pack + " skipped lines");
  eq(recs.length, independent.length, pack + " record count");
  if (recs.some((r) => !r.src || !r.src.key || !r.src.line)) fail(pack + " a record without provenance");
  const s = X.summarise(recs);
  // every total checked against a plain count of the raw lines
  eq(s.requests, independent.length, pack + " requests");
  eq(s.bytes, independent.reduce((a, r) => a + r.sc_bytes, 0), pack + " bytes");
  eq(s.errors, independent.filter((r) => r.sc_status >= 400).length, pack + " errors");
  eq(s.clients, new Set(independent.map((r) => r.c_ip)).size, pack + " clients");
  for (const v of ["vault-demo-001", "vault-demo-002"]) {
    const want = independent.filter((r) => r.cs_uri_stem.startsWith("/vault/" + v + "/")).length;
    eq((s.vaults.find((x) => x.key === v) || { requests: 0 }).requests, want, pack + " " + v);
  }
  if (s.hours.reduce((a, h) => a + h.requests, 0) !== s.requests) fail(pack + " hours do not add up");
  if (s.first > s.last) fail(pack + " first after last");
  return { d, s, recs };
}

const base = await run("baseline");
eq(base.s.requests, 225, "baseline requests");
eq(base.s.status.map((x) => [x.key, x.requests]), [["2xx", 190], ["4xx", 35]], "baseline status classes");
eq(base.s.paths.filter((p) => p.errors).map((p) => p.key), ["/favicon.ico"], "baseline: every 404 is /favicon.ico");
eq(base.s.vaults.map((v) => v.key), ["vault-demo-001", "vault-demo-002"], "baseline vaults");
const DOC_NETS = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.0\/24$/; // RFC 5737 documentation ranges only
if (!base.s.networks.length || base.s.networks.some((n) => !DOC_NETS.test(n.key))) fail("baseline: networks outside the documentation ranges " + base.s.networks.map((n) => n.key));
console.log("baseline:", X.headline(base.s, base.d));

const atk = await run("attack");
const probe = atk.recs.filter((r) => r.client === "203.0.113.66");
if (probe.length < 15) fail("attack: probes missing");
if (!atk.s.agent_kinds.find((k) => k.key === "bot")) fail("attack: sqlmap and Nuclei not seen as bots");
// path traversal on the vault API must not be counted as a vault
if (atk.s.vaults.some((v) => v.key === ".." || v.key.includes("/"))) fail("attack: traversal counted as a vault");
const withQuery = atk.recs.find((r) => r.query.includes("key=../../secrets"));
if (!withQuery || withQuery.path !== "/vault/vault-demo-001/files") fail("attack: query not split from the path");
console.log("attack:  ", X.headline(atk.s, atk.d));

const surge = await run("surge");
eq(surge.s.vaults[0].key, "vault-demo-001", "surge: the hot vault first");
if (surge.s.requests < 2000) fail("surge: expected ten times the traffic");
console.log("surge:   ", X.headline(surge.s, surge.d));

// formats the twin does not produce
const cat = X.read('{"c-ip":"198.51.100.7","cs-uri-stem":"/a","sc-status":"200"}{"c-ip":"198.51.100.8","cs-uri-stem":"/b}","sc-status":"500"}\n', "k");
eq(cat.records.length, 2, "concatenated JSON"); eq(cat.records[1].src, { key: "k", line: 1, part: 2 }, "part provenance");
eq(X.normalise(cat.records[1]).path, "/b}", "brace inside a string");
const tsv = X.read("#Version: 1.0\n#Fields: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(User-Agent) cs-uri-query x-edge-result-type x-edge-request-id time-taken\n" +
  "2026-11-21\t10:00:01\tLHR50-C1\t512\t2001:db8:abcd:12::1\tGET\td1.cloudfront.net\t/index.html\t200\tMozilla/5.0\t-\tHit\tabc123==\t0.002\nbroken line\n", "std.gz");
eq(tsv.records.length, 1, "standard log line"); eq(tsv.skipped.length, 1, "broken line skipped");
const n = X.normalise(tsv.records[0]);
eq([n.t, n.net, n.result, n.request_id, n.host, n.ms, n.edge_city, n.kind, n.query], ["2026-11-21T10:00:01.000Z", "2001:db8:abcd::/48", "Hit", "abc123==", "d1.cloudfront.net", 2, "LHR", "page", ""], "standard log fields");
eq(X.read("{not json\n", "k").skipped[0].why, "not JSON", "bad JSON reported");
// two gzip members in one file
const two = new Uint8Array([...gzipSync('{"c_ip":"203.0.113.1"}\n'), ...gzipSync('{"c_ip":"203.0.113.2"}\n')]);
eq(X.read(await X.gunzip(two), "m").records.length, 2, "two gzip members");
eq(X.network("::1"), "0:0:0::/48", "IPv6 short form");
// investigation mode (site/data/links.js)
new Function(readFileSync(new URL("../../site/data/links.js", import.meta.url), "utf8"))();
const L = globalThis.LogLinks;
const ctx = { siteBucket: "site-b", logsBucket: "logs-b", siteKeys: ["index.html", "data/vaults.json"], vaults: [{ id: "vault-demo-001", files: 42 }] };
eq(L.resolve("path", "/", ctx).map((r) => [r.key, r.found]), [["index.html", true]], "/ is index.html");
eq(L.resolve("path", "/nope.css", ctx).map((r) => r.found), [false], "a missing object is not found");
eq(L.resolve("path", "/vault/../../etc/passwd", ctx).map((r) => r.kind), ["none"], "traversal resolves to nothing");
eq(L.resolve("path", "/vault/vault-demo-001/files", ctx).map((r) => r.kind), ["s3-object", "vault", "s3-object"], "vault path refers to object, vault and vaults list");
eq(L.resolve("vault", "vault-demo-009", ctx)[0].found, false, "unknown vault not found");
eq(L.resolve("src", "cloudfront/2026/11/20/09/x.gz:7", ctx)[0], { kind: "s3-object", label: "s3://logs-b/cloudfront/2026/11/20/09/x.gz line 7", bucket: "logs-b", key: "cloudfront/2026/11/20/09/x.gz", line: 7, found: true }, "provenance ref");
const pv = L.pivots(atk.recs, "client", "203.0.113.66", 3);
eq(pv.lines, probe.length, "pivot lines");
if (!pv.by.path || pv.by.path.distinct < 5 || pv.by.client) fail("pivots of the attacker");
eq(pv.by.net.top[0].value, X.network("203.0.113.66"), "pivot net is the attacker's own network");
// the twin's enricher fields (country, vault_id): country read; vault_id only a claim
if (!base.recs.every((r) => /^[A-Z]{2}$/.test(r.country))) fail("country missing on twin lines");
const trav = atk.recs.filter((r) => r.path === "/vault/../../etc/passwd");
if (!trav.length || trav.some((r) => r.vault !== "" || r.vault_claim !== "..")) fail("traversal: vault must be empty, the enricher's claim kept: " + JSON.stringify(trav[0] && [trav[0].vault, trav[0].vault_claim]));
if (base.recs.some((r) => r.vault_claim)) fail("baseline: the enricher and the extract should agree");
eq(X.normalise({ raw: { cs_uri_stem: "/vault/%2e%2e/x" } }).vault, "", "encoded traversal is not a vault");
eq(X.normalise({ raw: { cs_uri_stem: "/vault/a%2Fb/x" } }).vault, "", "encoded slash is not a vault");
// vault cards: served apart from refused
for (const pk of [base, atk, surge]) for (const v of pk.s.vaults) if (v.ok + v.refused !== v.requests) fail("vault ok + refused != requests for " + v.key);
const v1 = atk.s.vaults.find((v) => v.key === "vault-demo-001");
eq(v1.refused, atk.recs.filter((r) => r.vault === "vault-demo-001" && r.status >= 400).length, "attack: refused on vault-demo-001");
if (v1.refused < 1 || base.s.vaults.some((v) => v.refused)) fail("refused: attack has some, baseline none");
if (v1.ok_clients > v1.clients) fail("ok_clients above clients");
// R-014 (security.aws.a): log values that are names on Object.prototype stay plain keys
const hostile = ["__proto__", "constructor", "toString", "hasOwnProperty"];
const hrecs = [];
hostile.forEach((h, i) => hrecs.push(X.normalise({ raw: { timestamp: "2026-11-21T10:0" + i + ":00Z", c_ip: h, cs_method: "GET", cs_uri_stem: "/vault/" + h + "/x", sc_status: 200, sc_bytes: 10, time_taken: 0.001, x_edge_location: h, cs_user_agent: h }, src: { key: h, line: 1 } })));
hostile.forEach((h, i) => hrecs.push(X.normalise({ raw: { timestamp: "2026-11-21T11:0" + i + ":00Z", c_ip: "203.0.113.9", cs_uri_stem: h, sc_status: 404, sc_bytes: 1 }, src: { key: "k", line: i } })));
const hs = X.summarise(hrecs);
if (Object.prototype.requests !== undefined || Object.prototype.bytes !== undefined || ({}).clients !== undefined) fail("Object.prototype was written");
eq(hs.requests, 8, "hostile requests"); eq(hs.vaults.map((v) => [v.key, v.requests]).sort(), hostile.map((h) => [h, 1]).sort(), "hostile vaults");
eq(hs.paths.find((p) => p.key === "__proto__").requests, 1, "path __proto__"); eq(hs.edges.find((e) => e.key === "constructor").requests, 1, "edge constructor");
eq(hs.vaults.find((v) => v.key === "__proto__").days, { "2026-11-21": 1 }, "vault days");
const hp = L.pivots(hrecs, "client", "__proto__", 5);
eq(hp.by.vault.top, [{ value: "__proto__", lines: 1 }], "pivot on __proto__");
const ht = X.read("#Fields: __proto__ constructor c-ip\nx\ty\t203.0.113.4\n", "t");
eq([ht.records.length, X.normalise(ht.records[0]).client], [1, "203.0.113.4"], "TSV header naming __proto__");
eq(X.discover([{ Key: "a/2026/11/21/10/__proto__", Size: 1 }]).files, 1, "discover with a __proto__ key");
// R-015: a gzip bomb stops at the ceiling
const bomb = gzipSync(Buffer.alloc(3 * 1048576));
if (bomb.length > 10000) fail("bomb not small");
let stoppedBomb = false;
try { await X.gunzip(bomb, 1048576); } catch (e) { stoppedBomb = /more than 1 MB/.test(e.message); }
if (!stoppedBomb) fail("gzip bomb not stopped");
eq((await X.gunzip(bomb, 4 * 1048576)).length, 3 * 1048576, "under the ceiling reads");
console.log("ok: extract (Discover, Read, Normalise, Summarise) on 3 packs and 4 extra formats, R-014 hostile keys, R-015 gzip bomb");
