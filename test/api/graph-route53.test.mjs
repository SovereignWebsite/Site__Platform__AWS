// Route53Api and Graph.add.route53 over the twin's Route 53 reads (1520020; cloudformation.aws.a's seed), with
// CloudFrontApi and CfnApi over the twin: a zone node (its ARN, type zone, in the account) that is the same node as the
// demo-dns stack's zone; record nodes urn:sws:record:<name> in their zone, the www record the same node as the stack's
// record set; the www alias refers_to the demo distribution's ARN node (api); old.example.com's CNAME names a bucket
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
ok(www.id === "urn:sws:record:www.example.com" && www.ttl === null && www.alias.dnsName === "d111111abcdef8.cloudfront.net." && www.alias.hostedZoneId === null, "the www alias: its target, no HostedZoneId (left out of the seed)");
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
const W = "urn:sws:record:www.example.com", OLD = "urn:sws:record:old.example.com", APEX = "urn:sws:record:example.com";
ok(node(W).type === "record" && edge(W, "in", ZONE) && edge(W, "made_by", dns.arn) && j.nodes.filter((n) => n.id === W).length === 1, "the www record: in its zone, and the same node as the stack's record set");
ok(JSON.stringify(node(APEX).record_types) === '["NS","SOA"]' && edge(APEX, "in", ZONE), "the apex: one node for its NS and SOA");
const toDist = edge(W, "refers_to", DIST);
ok(toDist && toDist.evidence === "api" && toDist.trust === "verified" && /alias target d111111abcdef8\.cloudfront\.net is the distribution's domain/.test(toDist.source), "the www alias refers_to the demo distribution's ARN node (api)");
ok(!j.nodes.some((n) => n.id.startsWith("urn:sws:cloudfront-distribution:")) && j.nodes.filter((n) => n.type === "distribution").length === 1, "no second distribution node");
const toOld = edge(OLD, "refers_to", "arn:aws:s3:::old.example.com");
ok(toOld && toOld.evidence === "naming" && toOld.trust === "claimed" && /names the bucket by its s3-website endpoint/.test(toOld.source), "old.example.com's CNAME names its bucket (naming, claimed)");
ok(node("arn:aws:s3:::old.example.com").dangling === true && node("arn:aws:s3:::old.example.com").trust === "claimed", "a bucket not in the account: dangling, claimed");
ok(!edge(OLD, "made_by", dns.arn), "old.example.com was made by no stack (the seed's finding)");
const rules = plain(Graph.rules(j)), rule = (id) => (Array.isArray(rules) ? rules : rules.items || []).find((r) => r.id === id);
ok(rule("dangling-claimed") && rule("dangling-claimed").kind === "question" && rule("dangling-claimed").nodes.includes("arn:aws:s3:::old.example.com") && !(rule("dangling-confirmed") || { nodes: [] }).nodes.includes("arn:aws:s3:::old.example.com"), "Graph.rules: a question (dangling-claimed), not a finding");
ok(!j.edges.some((x) => x.from === APEX && x.rel === "refers_to"), "NS and SOA values make no edges");
ok(j.edges.filter((x) => x.rel === "refers_to" && x.from.startsWith("urn:sws:record:")).length === 2, "exactly two record targets: the alias and the CNAME");
for (const order of [["cf", "r53", "cfn"], ["cfn", "cf", "r53"], ["cfn", "r53", "cf"]]) {
  const k = build(order), key = (g) => g.edges.map((x) => [x.from, x.rel, x.to, x.evidence].join(" | ")).sort().join("\n");
  ok(key(k) === key(j) && k.nodes.length === j.nodes.length, "the same graph whatever order the adapters run: " + order);
}
const lone = Graph({ account: A, backend: "twin" }); lone.add.route53({ zones: [zone], records });
const lj = plain(lone.toJSON());
ok(!lj.edges.some((x) => x.to === DIST) && lj.edges.some((x) => x.to === "arn:aws:s3:::old.example.com"), "without CloudFront's answer the alias makes no edge (never a guess); the bucket name still comes from the host");
const bad = Graph({ account: A, backend: "twin" });
bad.add.route53({ zones: [null, {}, { arn: "arn:aws:route53:::hostedzone/../x" }], records: [null, { id: "urn:sws:record:a b", zoneId: "Z1" }, { id: "urn:sws:record:x.example.com", zoneId: "../Z" }, { id: "javascript:x", zoneId: "Z1" }] });
bad.add.route53();
ok(plain(bad.toJSON()).nodes.filter((n) => n.type === "zone" || n.type === "record").length === 0, "malformed zones and records are skipped");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (graph route53: " + passed + " checks; Route53Api over the twin, one zone node with the stack's, records in their zone, alias to the distribution, a dangling CNAME as a question, any order)");
