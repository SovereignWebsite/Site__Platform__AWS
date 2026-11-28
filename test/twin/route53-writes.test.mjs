// Route 53 writes against the twin (Dinis, 28 Nov 2026: create a hosted zone; add, change and delete NS, A, CNAME and
// TXT records): through Route53Api, signed, in Node, no network. Only the change role may write; a CREATE of a record
// that exists, a DELETE that does not match, a type outside the four and a name outside the zone are refused.
import { readFileSync } from "node:fs"; import vm from "node:vm";
const R = new URL("../../site/", import.meta.url);
const store = {}; const ctx = { TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams, CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array, Map, Set, setTimeout, crypto: globalThis.crypto, console, btoa, atob, location: { search: "?twin", origin: "http://localhost" }, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, fetch: () => { throw new Error("a request left the page"); }, document: { baseURI: "http://localhost/" } };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/route53-api.js", "api/route53-changes.js"]) vm.runInContext(readFileSync(new URL(f, R), "utf8"), ctx, { filename: f });
const { SigV4, AwsTransport, AwsTwin, Route53Api, Route53Changes } = ctx;
let passed = 0; const fail = (m) => { console.error("FAIL", m); process.exit(1); }; const ok = (c, m) => { if (!c) fail(m); passed++; };
async function role(name) {
  const body = new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: "arn:aws:iam::" + AwsTwin.account + ":role/" + name, RoleSessionName: "sws-aws-platform", WebIdentityToken: "twin" }).toString();
  const t = await (await AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body })).text();
  const v = (g) => new RegExp("<" + g + ">([^<]*)</" + g + ">").exec(t)[1];
  const c = { accessKeyId: v("AccessKeyId"), secretAccessKey: v("SecretAccessKey"), sessionToken: v("SessionToken") };
  const send = async (req) => { const h = await SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body || "" }, c, req.region, req.service); return AwsTransport.fetch(req.url, { method: req.method, headers: h, body: req.body }); };
  return Object.assign(Route53Api(send), Route53Changes(send));
}
const read = await role("sws-aws-platform-read"), change = await role("sws-aws-platform-change");
try { await read.createZone("blocked.example.org"); fail("the read role created a zone"); } catch (e) { ok(e.code === "AccessDenied", "read role refused: " + e.message); }
const made = await change.createZone("new.example.org", { comment: "made in the test" });
ok(made.zone.name === "new.example.org." && made.nameServers.length === 4 && made.change.status === "PENDING", "zone created " + JSON.stringify(made).slice(0, 200));
const z = made.zone.id;
ok((await change.change(made.change.id)).status === "INSYNC", "GetChange INSYNC");
const recs = async () => (await read.records(z, {})).items.map((r) => r.name + " " + r.type + " " + r.ttl + " " + r.values.join(","));
ok((await recs()).length === 2, "a new zone has NS and SOA");
const add = [
  { action: "CREATE", record: { name: "new.example.org.", type: "A", ttl: 300, values: ["192.0.2.10"] } },
  { action: "CREATE", record: { name: "www.new.example.org.", type: "CNAME", ttl: 300, values: ["new.example.org"] } },
  { action: "CREATE", record: { name: "new.example.org.", type: "TXT", ttl: 300, values: ["\"v=spf1 -all\""] } },
  { action: "CREATE", record: { name: "sub.new.example.org.", type: "NS", ttl: 3600, values: ["ns1.example.net", "ns2.example.net"] } }];
const ch = await change.changeRecords(z, add, "four records");
ok(ch.status === "PENDING" && /^C0TWIN/.test(ch.id), "batch accepted");
const after = await recs();
ok(after.length === 6 && after.some((r) => r === "www.new.example.org. CNAME 300 new.example.org") && after.some((r) => /TXT 300 "v=spf1 -all"/.test(r)), "records now " + after.join(" | "));
try { await change.changeRecords(z, [add[0]]); fail("created twice"); } catch (e) { ok(e.code === "InvalidChangeBatch" && /already exists/.test(e.message), "duplicate create refused"); }
try { await change.changeRecords(z, [{ action: "DELETE", record: { name: "new.example.org.", type: "A", ttl: 60, values: ["192.0.2.10"] } }]); fail("deleted with the wrong TTL"); } catch (e) { ok(e.code === "InvalidChangeBatch" && /do not match/.test(e.message), "mismatched delete refused"); }
await change.changeRecords(z, [{ action: "UPSERT", record: { name: "new.example.org.", type: "A", ttl: 60, values: ["192.0.2.11", "192.0.2.12"] } }]);
ok((await recs()).includes("new.example.org. A 60 192.0.2.11,192.0.2.12"), "upsert replaced the A record");
await change.changeRecords(z, [{ action: "DELETE", record: { name: "www.new.example.org.", type: "CNAME", ttl: 300, values: ["new.example.org"] } }]);
ok(!(await recs()).some((r) => /CNAME/.test(r)), "the CNAME was deleted");
try { await change.changeRecords(z, [{ action: "CREATE", record: { name: "x.other.org.", type: "A", ttl: 60, values: ["192.0.2.1"] } }]); fail("a name outside the zone"); } catch (e) { ok(e.code === "InvalidChangeBatch", "name outside the zone refused"); }
try { await change.changeRecords(z, [{ action: "CREATE", record: { name: "mx.new.example.org.", type: "MX", ttl: 60, values: ["10 mail.example.org"] } }]); fail("MX accepted"); } catch (e) { ok(e instanceof TypeError, "MX refused before any request"); }
ok(!Route53Changes.checkChange({ action: "CREATE", record: { name: "a.example.org", type: "A", ttl: 60, values: ["999.1.1.1"] } }), "a bad IPv4 address refused");
ok(!Route53Changes.checkChange({ action: "CREATE", record: { name: "a.example.org", type: "TXT", ttl: 60, values: ["unquoted"] } }), "an unquoted TXT value refused");
ok(!Route53Changes.checkChange({ action: "CREATE", record: { name: "a.example.org", type: "CNAME", ttl: 60, values: ["a.org", "b.org"] } }), "a CNAME with two values refused");
console.log("OK (route53 writes: " + passed + " checks; create zone, CREATE, UPSERT, DELETE of NS, A, CNAME, TXT; read role, duplicate, mismatch, outside the zone, other types refused)");
