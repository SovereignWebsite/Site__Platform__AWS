// Route53Api and Graph.add.route53 over the twin's Route 53 reads (1520020; cloudformation.aws.a's seed), with
// CloudFrontApi and CfnApi over the twin: a zone node (its ARN, type zone, in the account) that is the same node as the
// demo-dns stack's zone; record nodes urn:sws:route53-record:<zoneId>/<name>/<type>[/<setId>] (design 03 refinement 3) in
// their zone, the stack's record set joined by name (its zone, else the only zone holding it, else none); the www alias refers_to the demo distribution's ARN node (api); old.example.com's CNAME names a bucket
// that is not in the account, so it stays dangling and claimed (naming), never guessed to a target; NS and SOA values
// make no edges; the same graph whichever adapter runs first. Node 22, no network. Run: node test/api/graph-route53.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array, Map, Set,
  setTimeout, crypto: globalThis.crypto, console, btoa, atob, encodeURIComponent, decodeURIComponent,
  location: { search: "?twin", origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/cfn-api.js", "api/cloudfront-api.js", "api/route53-api.js", "api/graph.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { Graph, AwsTwin, CfnApi, CloudFrontApi, Route53Api, ApiAll } = ctx, A = AwsTwin.account;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const plain = (v) => JSON.parse(JSON.stringify(v));

const t = await (await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() })).text();
const g1 = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1], creds = { accessKeyId: g1("AccessKeyId"), secretAccessKey: g1("SecretAccessKey"), sessionToken: g1("SessionToken") };
const send = async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body });

// ---- Route53Api over the twin ----
const r53 = Route53Api(send, { account: A });
const zones = plain((await Route53Api.all((next) => r53.zones({ next, max: 1 }))).items);
ok(zones.length === 1 && zones[0].id === "Z0DEMOTWIN0001" && zones[0].arn === "arn:aws:route53:::hostedzone/Z0DEMOTWIN0001" && zones[0].name === "example.com." && zones[0].recordCount === 4, "zones over the twin: the demo zone");
const zone = plain(await r53.zone("Z0DEMOTWIN0001"));
ok(JSON.stringify(zone.nameServers) === '["ns-0000.awsdns-00.org","ns-0001.awsdns-01.co.uk"]', "zone over the twin: its name servers");
let pages = 0;
const records = plain((await Route53Api.all((next) => { pages++; return r53.records("Z0DEMOTWIN0001", { next, max: 1 }); })).items);
ok(pages === 4 && records.map((r) => r.name + " " + r.type).join() === "example.com. NS,example.com. SOA,www.example.com. A,old.example.com. CNAME", "records over the twin, one a page on the name/type triple: the seed's four, in order");
const www = records.find((r) => r.type === "A");
ok(www.id === "urn:sws:route53-record:Z0DEMOTWIN0001/www.example.com/A" && www.ttl === null && www.alias.dnsName === "d111111abcdef8.cloudfront.net." && www.alias.hostedZoneId === null, "the www alias: its target, no HostedZoneId (left out of the seed)");
let e = null; try { await r53.zone("ZNOSUCHZONE1"); } catch (x) { e = x; }
ok(e && e.code === "NoSuchHostedZone" && e.status === 404, "an unknown zone over the twin: NoSuchHostedZone, 404");

// ---- CloudFront and CloudFormation over the twin ----
const cf = CloudFrontApi(send, { account: A });
const distributions = await Promise.all((await CloudFrontApi.all((next) => cf.distributions({ next }))).items.map((d) => cf.distribution(d.id)));
const cfn = CfnApi(send, { account: A });
const dns = (await ApiAll((next) => cfn.stacks("eu-west-2", { next }))).items.find((s) => s.name === "demo-dns");
dns.resources = (await cfn.resources("eu-west-2", dns.arn)).items;
const DIST = "arn:aws:cloudfront::" + A + ":distribution/EDEMOTWIN00001", ZONE = "arn:aws:route53:::hostedzone/Z0DEMOTWIN0001";
const build = (order) => {
  const g = Graph({ account: A, backend: "twin" });
  for (const s of order) {
    if (s === "r53") g.add.route53({ zones: [zone], records });
    if (s === "cf") g.add.cloudfront({ distributions, functions: [] });
    if (s === "cfn") g.add.cfn({ stacks: [dns] });
  }
  return plain(g.toJSON());
};
const j = build(["r53", "cf", "cfn"]);
const node = (id) => j.nodes.find((n) => n.id === id), edge = (f, r, to) => j.edges.find((x) => x.from === f && x.rel === r && x.to === to);
ok(node(ZONE).type === "zone" && node(ZONE).label === "example.com" && node(ZONE).trust === "verified" && edge(ZONE, "in", "urn:sws:account:" + A).evidence === "api", "the zone: its ARN, type zone, verified, in the account");
ok(edge(ZONE, "made_by", dns.arn) && j.nodes.filter((n) => n.id === ZONE).length === 1, "one zone node: the stack's zone and Route 53's are the same");
const RID = (n, t) => "urn:sws:route53-record:Z0DEMOTWIN0001/" + n + "/" + t, W = RID("www.example.com", "A"), OLD = RID("old.example.com", "CNAME"), NSR = RID("example.com", "NS"), SOA = RID("example.com", "SOA");
ok(node(W).type === "record" && node(W).label === "www.example.com A" && node(W).record_name === "www.example.com" && node(W).record_type === "A" && edge(W, "in", ZONE) && edge(W, "made_by", dns.arn).evidence === "api" && /one record set named www\.example\.com/.test(edge(W, "made_by", dns.arn).source), "the www record: in its zone, made_by demo-dns (its WwwAlias joined by name in the stack's own zone)");
ok(!j.nodes.some((n) => n.id.startsWith("urn:sws:cfn-resource:")), "no separate node for the stack's record set once it is joined");
ok(node(NSR) && node(SOA) && NSR !== SOA && edge(NSR, "in", ZONE) && edge(SOA, "in", ZONE) && !edge(NSR, "made_by", dns.arn), "the apex's NS and SOA: two nodes (design 03 refinement 3), not made by the stack");
const toDist = edge(W, "refers_to", DIST);
ok(toDist && toDist.evidence === "api" && toDist.trust === "verified" && /alias target d111111abcdef8\.cloudfront\.net is the distribution's domain/.test(toDist.source), "the www alias refers_to the demo distribution's ARN node (api)");
ok(!j.nodes.some((n) => n.id.startsWith("urn:sws:cloudfront-distribution:")) && j.nodes.filter((n) => n.type === "distribution").length === 1, "no second distribution node");
const toOld = edge(OLD, "refers_to", "arn:aws:s3:::old.example.com");
ok(toOld && toOld.evidence === "naming" && toOld.trust === "claimed" && /names the bucket by its s3-website endpoint/.test(toOld.source), "old.example.com's CNAME names its bucket (naming, claimed)");
ok(node("arn:aws:s3:::old.example.com").dangling === true && node("arn:aws:s3:::old.example.com").trust === "claimed", "a bucket not in the account: dangling, claimed");
ok(!edge(OLD, "made_by", dns.arn), "old.example.com was made by no stack (the seed's finding)");
const rules = plain(Graph.rules(j)), rule = (id) => (Array.isArray(rules) ? rules : rules.items || []).find((r) => r.id === id);
ok(rule("dangling-claimed") && rule("dangling-claimed").kind === "question" && rule("dangling-claimed").nodes.includes("arn:aws:s3:::old.example.com") && !(rule("dangling-confirmed") || { nodes: [] }).nodes.includes("arn:aws:s3:::old.example.com"), "Graph.rules: a question (dangling-claimed), not a finding");
ok(!j.edges.some((x) => (x.from === NSR || x.from === SOA) && x.rel === "refers_to"), "NS and SOA values make no edges");
ok(j.edges.filter((x) => x.rel === "refers_to" && x.from.startsWith("urn:sws:route53-record:")).length === 2, "exactly two record targets: the alias and the CNAME");
for (const order of [["cf", "r53", "cfn"], ["cfn", "cf", "r53"], ["cfn", "r53", "cf"]]) {
  const k = build(order), key = (g) => g.edges.map((x) => [x.from, x.rel, x.to, x.evidence].join(" | ")).sort().join("\n");
  ok(key(k) === key(j) && k.nodes.length === j.nodes.length, "the same graph whatever order the adapters run: " + order);
}
const lone = Graph({ account: A, backend: "twin" }); lone.add.route53({ zones: [zone], records });
const lj = plain(lone.toJSON());
ok(!lj.edges.some((x) => x.to === DIST) && lj.edges.some((x) => x.to === "arn:aws:s3:::old.example.com"), "without CloudFront's answer the alias makes no edge (never a guess); the bucket name still comes from the host");
// ---- by hand: a Vault's A and AAAA pair, and the stack join's three cases ----
{
  const C = "444455556666", VD = "arn:aws:cloudfront::" + C + ":distribution/EVAULTPAIR001", ZV = "ZVAULTZONE01", ZP = "ZPRIVATEZONE1";
  const rec = (z, name, type, alias) => ({ id: Route53Api.recordId(z, name, type, null), zoneId: z, name, type, setIdentifier: null, ttl: alias ? null : 60, values: alias ? [] : ["10.0.0.1"], alias: alias ? { dnsName: alias, hostedZoneId: null, evaluateTargetHealth: false } : null });
  const zoneOf = (id, name) => ({ id, arn: "arn:aws:route53:::hostedzone/" + id, name, private: id === ZP, comment: "", recordCount: 2 });
  const vstack = (resources) => ({ arn: "arn:aws:cloudformation:eu-west-2:" + C + ":stack/sws-vault-v1/00000000-0000-4000-8000-0000000000v1", name: "sws-vault-v1", region: "eu-west-2", status: "CREATE_COMPLETE", resources });
  const rs = (logical, name) => ({ logicalId: logical, physicalId: name, type: "AWS::Route53::RecordSet", arn: "urn:sws:cfn-resource:sws-vault-v1/" + logical, arnDerived: false, status: "CREATE_COMPLETE" });
  const g = Graph({ account: C, backend: "twin" });
  g.add.cloudfront({ distributions: [{ id: "EVAULTPAIR001", arn: VD, domain: "dvaultpair0001.cloudfront.net", aliases: ["vault.example.com"], origins: [], functions: [] }] });
  g.add.route53({ zones: [zoneOf(ZV, "example.com.")], records: [rec(ZV, "vault.example.com.", "A", "dvaultpair0001.cloudfront.net."), rec(ZV, "vault.example.com.", "AAAA", "dvaultpair0001.cloudfront.net.")] });
  const st = vstack([rs("VaultRecordA", "vault.example.com"), rs("VaultRecordAAAA", "vault.example.com")]);
  g.add.cfn({ stacks: [st] });
  const v = plain(g.toJSON()), VA = Route53Api.recordId(ZV, "vault.example.com.", "A"), VAAAA = Route53Api.recordId(ZV, "vault.example.com.", "AAAA");
  const ve = (f, r, t) => v.edges.find((x) => x.from === f && x.rel === r && x.to === t);
  ok(VA !== VAAAA && v.nodes.filter((n) => n.type === "record").length === 2, "a Vault's A and AAAA on one name: two nodes");
  ok(ve(VA, "refers_to", VD).evidence === "api" && ve(VAAAA, "refers_to", VD).evidence === "api", "both refer_to the same distribution (api)");
  ok(ve(VA, "made_by", st.arn) && ve(VAAAA, "made_by", st.arn) && !v.nodes.some((n) => n.id.startsWith("urn:sws:cfn-resource:")), "both made_by the Vault stack: the only zone holding the name (the stack did not make the zone)");
ok(["naming"].includes(ve(VA, "made_by", st.arn).evidence) && ve(VA, "made_by", st.arn).trust === "claimed" && /names vault\.example\.com only; 2 record sets have that name/.test(ve(VA, "made_by", st.arn).source), "two record sets for the name: each made_by is naming and claimed, which is which not guessed");
ok(v.nodes.find((n) => n.id === VA).trust === "verified" && ve(VA, "in", "arn:aws:route53:::hostedzone/" + ZV).evidence === "api", "the record sets themselves stay verified through their zone");
  // A stack's apex record set never takes the zone's NS and SOA (cloudformation.aws.a): one candidate left, api.
  {
    const h = Graph({ account: C, backend: "twin" });
    h.add.route53({ zones: [zoneOf(ZV, "example.com.")], records: [rec(ZV, "example.com.", "NS"), rec(ZV, "example.com.", "SOA"), rec(ZV, "example.com.", "A", "dvaultpair0001.cloudfront.net.")] });
    h.add.cfn({ stacks: [vstack([rs("ApexAlias", "example.com")])] });
    const k = plain(h.toJSON()), mb = (t) => k.edges.find((x) => x.from === Route53Api.recordId(ZV, "example.com.", t) && x.rel === "made_by");
    ok(!mb("NS") && !mb("SOA") && mb("A") && mb("A").evidence === "api", "a stack's apex record set: its A made_by the stack (api); the zone's NS and SOA are not");
  }
  // A stack's A next to a hand-made TXT on one name: two candidates, so both claimed (the stack's is not guessed).
  {
    const h = Graph({ account: C, backend: "twin" });
    h.add.route53({ zones: [zoneOf(ZV, "example.com.")], records: [rec(ZV, "api.example.com.", "A"), rec(ZV, "api.example.com.", "TXT")] });
    h.add.cfn({ stacks: [vstack([rs("ApiRecord", "api.example.com")])] });
    const k = plain(h.toJSON()), mbs = k.edges.filter((x) => x.rel === "made_by" && x.from.includes("/api.example.com/"));
    ok(mbs.length === 2 && mbs.every((x) => x.evidence === "naming" && x.trust === "claimed"), "a stack's A beside a hand-made TXT: both made_by naming, claimed");
  }
  // A name in two zones (public and private): the stack's own zone wins; with neither its own, no record is chosen.
  const two = (madeZone) => {
    const h = Graph({ account: C, backend: "twin" });
    h.add.route53({ zones: [zoneOf(ZV, "example.com."), zoneOf(ZP, "example.com.")], records: [rec(ZV, "app.example.com.", "A"), rec(ZP, "app.example.com.", "A")] });
    const res = [rs("AppRecord", "app.example.com")];
    if (madeZone) res.push({ logicalId: "PrivateZone", physicalId: ZP, type: "AWS::Route53::HostedZone", arn: "arn:aws:route53:::hostedzone/" + ZP, arnDerived: true, status: "CREATE_COMPLETE" });
    h.add.cfn({ stacks: [vstack(res)] });
    return plain(h.toJSON());
  };
  let k = two(true), made = (id) => k.edges.some((x) => x.from === id && x.rel === "made_by");
  ok(Route53Api.recordId(ZV, "app.example.com.", "A") !== Route53Api.recordId(ZP, "app.example.com.", "A") && made(Route53Api.recordId(ZP, "app.example.com.", "A")) && !made(Route53Api.recordId(ZV, "app.example.com.", "A")), "one name in a public and a private zone: two nodes; the stack's own zone's record joins");
  k = two(false);
  ok(!made(Route53Api.recordId(ZP, "app.example.com.", "A")) && !made(Route53Api.recordId(ZV, "app.example.com.", "A")) && k.nodes.some((n) => n.id === "urn:sws:cfn-resource:" + vstack([]).arn + "/AppRecord"), "the name in two zones, neither the stack's: no record chosen, the stack's record set stays its own node");
}
const bad = Graph({ account: A, backend: "twin" });
bad.add.route53({ zones: [null, {}, { arn: "arn:aws:route53:::hostedzone/../x" }], records: [null, { id: "urn:sws:route53-record:Z1/a b/A", zoneId: "Z1" }, { id: "urn:sws:route53-record:Z1/x.example.com/A", zoneId: "Z2" }, { id: "urn:sws:route53-record:Z1/x.example.com/a", zoneId: "Z1" }, { id: "javascript:x", zoneId: "Z1" }] });
bad.add.route53();
ok(plain(bad.toJSON()).nodes.filter((n) => n.type === "zone" || n.type === "record").length === 0, "malformed zones and records are skipped");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (graph route53: " + passed + " checks; Route53Api over the twin, one zone node with the stack's, records in their zone, alias to the distribution, a dangling CNAME as a question, any order)");
