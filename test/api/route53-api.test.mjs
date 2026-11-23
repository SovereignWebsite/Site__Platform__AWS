// Route53Api (site/api/route53-api.js; architect.aws.a design 03 part 1) over answers in the XML shapes of botocore's
// route53 2013-04-01 (boto3.aws.a note 20), built from cloudformation.aws.a's seed (docs/cloudformation/seed/route53.json)
// until the twin answers Route 53: request shapes (global endpoint, us-east-1, query names), zone ids bare and as ARNs,
// zone paging on Marker, record paging on the name/type/identifier triple, alias and plain records, Route 53's octal
// escapes, errors, refusals before any request, and the contract. Node 22, no network. Run: node test/api/route53-api.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { URLSearchParams, URL, Response, Headers, Promise, Error, TypeError, JSON, Object, Array, String, Number, RegExp, Math, encodeURIComponent };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["api/all.js", "api/route53-api.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { Route53Api, ApiAll } = ctx, A = "111122223333", NS = ' xmlns="https://route53.amazonaws.com/doc/2013-04-01/"';
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const rejects = async (p, test, m) => { try { await p; ok(false, m + ": did not reject"); } catch (e) { ok(test(e), m + ": " + e.message); } };
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- answers, in botocore's shapes, from the seed's demo zone plus a second zone for paging ----
const zoneXml = (id, name, comment, count) => "<HostedZone><Id>/hostedzone/" + id + "</Id><Name>" + name + "</Name><CallerReference>ref-" + id + "</CallerReference>" +
  "<Config><Comment>" + comment + "</Comment><PrivateZone>false</PrivateZone></Config><ResourceRecordSetCount>" + count + "</ResourceRecordSetCount></HostedZone>";
const ZONES = [zoneXml("Z0DEMOTWIN0001", "example.com.", "demo zone (made by stack demo-dns)", 4), zoneXml("Z0DEMOTWIN0002", "example.org.", "&lt;b&gt;second&lt;/b&gt;", 2)];
const rr = (name, type, body) => "<ResourceRecordSet><Name>" + name + "</Name><Type>" + type + "</Type>" + body + "</ResourceRecordSet>";
const vals = (ttl, ...v) => "<TTL>" + ttl + "</TTL><ResourceRecords>" + v.map((x) => "<ResourceRecord><Value>" + x + "</Value></ResourceRecord>").join("") + "</ResourceRecords>";
const RECORDS = [
  rr("example.com.", "NS", vals(172800, "ns-0000.awsdns-00.org.", "ns-0001.awsdns-01.co.uk.")),
  rr("example.com.", "SOA", vals(900, "ns-0000.awsdns-00.org. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400")),
  rr("\\052.example.com.", "CNAME", vals(300, "example.com")),
  rr("old.example.com.", "CNAME", vals(300, "old.example.com.s3-website.eu-west-2.amazonaws.com")),
  rr("www.example.com.", "A", "<AliasTarget><HostedZoneId>ZALIASZONE</HostedZoneId><DNSName>d111111abcdef8.cloudfront.net.</DNSName><EvaluateTargetHealth>false</EvaluateTargetHealth></AliasTarget>"),
  rr("www.example.com.", "AAAA", "<SetIdentifier>eu</SetIdentifier>" + vals(60, "2001:db8::1"))
];
const xml = (body) => new Response('<?xml version="1.0"?>' + body, { status: 200 });
const err = (status, code, message) => new Response('<?xml version="1.0"?><ErrorResponse' + NS + "><Error><Type>Sender</Type><Code>" + code + "</Code><Message>" + message + "</Message></Error><RequestId>r</RequestId></ErrorResponse>", { status });
const sent = [];
function answer(req) {
  sent.push(req);
  const u = new URL(req.url), p = u.pathname, q = u.searchParams;
  if (p === "/2013-04-01/hostedzone") {
    const max = +(q.get("maxitems") || 100), from = q.get("marker") ? ZONES.findIndex((z) => z.includes("<Id>/hostedzone/" + q.get("marker") + "<")) : 0;
    if (from < 0) return err(400, "InvalidInput", "bad marker");
    const page = ZONES.slice(from, from + max), more = from + max < ZONES.length;
    return xml("<ListHostedZonesResponse" + NS + "><HostedZones>" + page.join("") + "</HostedZones><Marker>" + (q.get("marker") || "") + "</Marker><IsTruncated>" + more + "</IsTruncated>" +
      (more ? "<NextMarker>" + /<Id>\/hostedzone\/([^<]*)/.exec(ZONES[from + max])[1] + "</NextMarker>" : "") + "<MaxItems>" + max + "</MaxItems></ListHostedZonesResponse>");
  }
  let m = /^\/2013-04-01\/hostedzone\/([^/]+)$/.exec(p);
  if (m) {
    if (m[1] !== "Z0DEMOTWIN0001") return err(404, "NoSuchHostedZone", "No hosted zone found with ID: " + m[1]);
    return xml("<GetHostedZoneResponse" + NS + ">" + ZONES[0] + "<DelegationSet><NameServers><NameServer>ns-0000.awsdns-00.org</NameServer><NameServer>ns-0001.awsdns-01.co.uk</NameServer></NameServers></DelegationSet></GetHostedZoneResponse>");
  }
  m = /^\/2013-04-01\/hostedzone\/([^/]+)\/rrset$/.exec(p);
  if (m) {
    const max = +(q.get("maxitems") || 300), key = (r) => /<Name>([^<]*)/.exec(r)[1] + "|" + /<Type>([^<]*)/.exec(r)[1] + "|" + ((/<SetIdentifier>([^<]*)/.exec(r) || [])[1] || "");
    const from = q.get("name") ? RECORDS.findIndex((r) => key(r) === q.get("name") + "|" + (q.get("type") || "") + "|" + (q.get("identifier") || "")) : 0;
    if (from < 0) return err(400, "InvalidInput", "bad start");
    const page = RECORDS.slice(from, from + max), more = from + max < RECORDS.length, nx = more ? key(RECORDS[from + max]).split("|") : null;
    return xml("<ListResourceRecordSetsResponse" + NS + "><ResourceRecordSets>" + page.join("") + "</ResourceRecordSets><IsTruncated>" + more + "</IsTruncated>" +
      (more ? "<NextRecordName>" + nx[0] + "</NextRecordName><NextRecordType>" + nx[1] + "</NextRecordType>" + (nx[2] ? "<NextRecordIdentifier>" + nx[2] + "</NextRecordIdentifier>" : "") : "") + "<MaxItems>" + max + "</MaxItems></ListResourceRecordSetsResponse>");
  }
  return new Response("not here", { status: 501 });
}
const api = Route53Api(async (req) => answer(req), { account: A });

// ---- zones ----
let page = plain(await api.zones());
ok(page.items.length === 2 && page.next === null, "zones: one page");
ok(sent[0].service === "route53" && sent[0].region === "us-east-1" && sent[0].method === "GET" && sent[0].url === "https://route53.amazonaws.com/2013-04-01/hostedzone", "request: global endpoint, signed us-east-1, no query");
const z = page.items[0];
ok(z.id === "Z0DEMOTWIN0001" && z.arn === "arn:aws:route53:::hostedzone/Z0DEMOTWIN0001" && z.name === "example.com." && z.private === false && z.recordCount === 4 && z.callerReference === "ref-Z0DEMOTWIN0001", "a zone: bare id, ARN as CfnApi derives it, name with its dot, private, count");
ok(z.comment === "demo zone (made by stack demo-dns)" && page.items[1].comment === "<b>second</b>", "comments as text, entities decoded (render as text)");
page = plain(await api.zones({ max: 1 }));
ok(page.items.map((x) => x.id).join() === "Z0DEMOTWIN0001" && page.next === "Z0DEMOTWIN0002" && /[?&]maxitems=1(&|$)/.test(sent.at(-1).url), "zones({ max: 1 }): maxitems, NextMarker as next");
page = plain(await api.zones({ next: page.next, max: 1 }));
ok(page.items.map((x) => x.id).join() === "Z0DEMOTWIN0002" && page.next === null && /[?&]marker=Z0DEMOTWIN0002(&|$)/.test(sent.at(-1).url), "the next page by marker; null on the last");
ok(plain(await Route53Api.all((next) => api.zones({ next, max: 1 }))).items.length === 2, "Route53Api.all drains zones");
ok(/maxitems=300/.test((await api.zones({ max: 99999 }), sent.at(-1).url)) && /maxitems=1(&|$)/.test((await api.zones({ max: -5 }), sent.at(-1).url)), "max clamped to 1..300");

// ---- one zone ----
const zd = plain(await api.zone("Z0DEMOTWIN0001"));
ok(zd.id === "Z0DEMOTWIN0001" && JSON.stringify(zd.nameServers) === '["ns-0000.awsdns-00.org","ns-0001.awsdns-01.co.uk"]', "zone(id): the zone and its name servers");
ok(sent.at(-1).url === "https://route53.amazonaws.com/2013-04-01/hostedzone/Z0DEMOTWIN0001" && (await api.zone("/hostedzone/Z0DEMOTWIN0001")).id === "Z0DEMOTWIN0001" && sent.at(-1).url.endsWith("/hostedzone/Z0DEMOTWIN0001"), "the bare id in the path, whether given bare or as /hostedzone/Z...");
await rejects(api.zone("ZNOSUCHZONE1"), (e) => e.code === "NoSuchHostedZone" && e.status === 404 && e.message === "NoSuchHostedZone: No hosted zone found with ID: ZNOSUCHZONE1", "an unknown zone: NoSuchHostedZone, 404");
const before = sent.length;
for (const bad of ["", "z0lower", "Z0../x", "Z0DEMO/rrset", "/hostedzone/../Z1", "Z" + "A".repeat(40), null, undefined, { n: 0, toString() { return this.n++ ? "../x" : "Z1x" } }])
  await rejects(api.zone(bad), (e) => e instanceof TypeError, "zone(" + JSON.stringify(String(bad)).slice(0, 30) + ") refused");
await rejects(api.records("../hostedzone"), (e) => e instanceof TypeError, "records with a hostile id refused");
ok(sent.length === before, "no request for any refused id");
let reads = 0; await rejects(api.zone({ toString() { reads++; return reads > 1 ? "../evil" : "ZNOSUCH1"; } }), (e) => e.code === "NoSuchHostedZone", "an id is converted once");
ok(reads === 1 && sent.at(-1).url.endsWith("/hostedzone/ZNOSUCH1"), "and the request uses that one reading");

// ---- records ----
const rec = plain(await api.records("Z0DEMOTWIN0001"));
ok(rec.items.length === 6 && rec.next === null && sent.at(-1).url === "https://route53.amazonaws.com/2013-04-01/hostedzone/Z0DEMOTWIN0001/rrset", "records: one page, the rrset path");
const by = (n, t) => rec.items.find((r) => r.name === n && r.type === t);
ok(JSON.stringify(by("example.com.", "NS")) === JSON.stringify({ zoneId: "Z0DEMOTWIN0001", name: "example.com.", type: "NS", setIdentifier: null, ttl: 172800, values: ["ns-0000.awsdns-00.org.", "ns-0001.awsdns-01.co.uk."], alias: null }), "a plain record: TTL and values");
ok(JSON.stringify(by("www.example.com.", "A")) === JSON.stringify({ zoneId: "Z0DEMOTWIN0001", name: "www.example.com.", type: "A", setIdentifier: null, ttl: null, values: [], alias: { dnsName: "d111111abcdef8.cloudfront.net.", hostedZoneId: "ZALIASZONE", evaluateTargetHealth: false } }), "an alias record: no TTL, no values, the alias target");
ok(by("*.example.com.", "CNAME") && by("www.example.com.", "AAAA").setIdentifier === "eu", "\\052 decoded to *; SetIdentifier kept");
ok(by("old.example.com.", "CNAME").values[0] === "old.example.com.s3-website.eu-west-2.amazonaws.com", "a value is text as given (the dangling name is the graph's finding, not the API's)");
let rp = plain(await api.records("Z0DEMOTWIN0001", { max: 4 }));
ok(rp.items.length === 4 && rp.next === JSON.stringify(["www.example.com.", "A", null]), "a truncated page: next is the record triple");
rp = plain(await api.records("Z0DEMOTWIN0001", { next: rp.next, max: 1 }));
const u = new URL(sent.at(-1).url);
ok(u.searchParams.get("name") === "www.example.com." && u.searchParams.get("type") === "A" && !u.searchParams.has("identifier") && u.searchParams.get("maxitems") === "1", "the triple goes back as name, type (identifier only when there is one), maxitems");
ok(rp.items[0].name === "www.example.com." && rp.items[0].type === "A" && rp.next === JSON.stringify(["www.example.com.", "AAAA", "eu"]), "paging carries the identifier when the next record has one");
rp = plain(await api.records("Z0DEMOTWIN0001", { next: rp.next }));
ok(new URL(sent.at(-1).url).searchParams.get("identifier") === "eu" && rp.items.length === 1 && rp.next === null, "identifier sent; last page");
const all = plain(await Route53Api.all((next) => api.records("Z0DEMOTWIN0001", { next, max: 2 })));
ok(all.items.length === 6 && new Set(all.items.map((r) => r.name + r.type)).size === 6, "Route53Api.all drains records over the triple, each once");
const nb = sent.length;
for (const bad of ["nope", "[]", '["a"]', '[1,2,3]', '["", null, null]', '["a","b","c","d"]', '{"0":"a"}'])
  await rejects(api.records("Z0DEMOTWIN0001", { next: bad }), (e) => e instanceof TypeError && /cursor/.test(e.message), "cursor " + bad + " refused");
ok(sent.length === nb, "no request for a bad cursor");

// ---- errors and limits ----
const r503 = Route53Api(async () => new Response("<html>busy</html>", { status: 503 }));
await rejects(r503.zones(), (e) => e.code === "HTTP 503" && e.status === 503 && !/busy/.test(e.message), "a non-XML failure: its status, not its body");
const cors = Route53Api(async () => { throw new TypeError("Failed to fetch"); });
await rejects(cors.zones(), (e) => e instanceof TypeError && e.message === "Failed to fetch", "a CORS TypeError passes through");
let read = false;
const declared = Route53Api(async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": String(5 * 1024 * 1024) }), text: async () => { read = true; return ""; } }));
await rejects(declared.zones(), (e) => e.code === "TooLarge", "over 4 MB by its declared length");
ok(!read, "refused before the body is read");
const huge = Route53Api(async () => new Response("<a>" + "x".repeat(4 * 1024 * 1024) + "</a>"));
await rejects(huge.zones(), (e) => e.code === "TooLarge", "over 4 MB by its length when it declares none");
try { Route53Api(); ok(false, "no send"); } catch (e) { ok(e instanceof TypeError, "Route53Api needs a send"); }
const t0 = Date.now(); await Route53Api(async () => xml("<ListHostedZonesResponse>" + "<HostedZones>".repeat(20000) + "<" + "a".repeat(200000))).zones(); ok(Date.now() - t0 < 1000, "a hostile, unclosed answer parses in linear time");

// ---- the contract ----
const doc = JSON.parse(readFileSync(new URL("../../site/api/route53.openapi.json", import.meta.url), "utf8"));
const ops = Object.values(doc.paths).map((p) => p.get);
ok(doc["x-browser-global"] === "Route53Api" && ops.map((o) => o.operationId).sort().join() === Object.keys(api).sort().join(), "contract: one operation per method");
ok(ops.every((o) => o["x-role"] === "read"), "every operation is a read");
const wire = { zones: "route53:ListHostedZones", zone: "route53:GetHostedZone", records: "route53:ListResourceRecordSets" };
ok(ops.every((o) => JSON.stringify(o["x-aws-actions"]) === JSON.stringify([wire[o.operationId]])), "each operation lists exactly its action");
const pat = new RegExp(doc.paths["/zones/{id}"].get.parameters[0].schema.pattern);
ok(["Z0DEMOTWIN0001", "/hostedzone/Z0DEMOTWIN0001"].every((s) => pat.test(s) && Route53Api.zoneId(s)) && ["z1", "Z0../x", ""].every((s) => !pat.test(s) && !Route53Api.zoneId(s)), "the contract's id pattern and Route53Api.zoneId agree");
const src = readFileSync(new URL("../../site/api/route53-api.js", import.meta.url), "utf8");
ok(!/\beval\(|new Function|innerHTML|document\.|localStorage|fetch\(|ChangeResourceRecordSets|method: "(POST|PUT|DELETE)"/.test(src.replace(/^\s*\/\/.*$/gm, "")), "no eval, DOM, storage, direct fetch or write in route53-api.js");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (route53-api: " + passed + " checks; zones, zone, records over botocore route53 2013-04-01 shapes, paging, errors, refusals, contract)");
