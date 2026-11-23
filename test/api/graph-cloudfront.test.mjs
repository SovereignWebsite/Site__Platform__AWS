// Graph.add.cloudfront (site/api/graph.js; architect.aws.a design 06, section 3) over CloudFrontApi reading answers in
// botocore cloudfront 2020-05-31 shapes (the twin's answers come from dev.1.aws.a), with CfnApi over the twin: a node per
// distribution by its ARN, serves_from origin targets (api), no edge for an origin without a target, invokes for
// CloudFront Functions, logs_to the logging bucket; one node with the stack's resource (CfnApi's derived ARN) and with a
// naming node from log files whose name is the distribution's id. Node 22, no network. Run: node test/api/graph-cloudfront.test.mjs
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
for (const f of ["sigv4.js", "twin.js", "transport.js", "zip.js", "data/extract.js", "api/all.js", "api/cfn-api.js", "api/cloudfront-api.js", "api/graph.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { Graph, AwsTwin, CfnApi, CloudFrontApi } = ctx, A = AwsTwin.account, SITE = AwsTwin.buckets.site, LOGS = AwsTwin.buckets.logs;
const schema = JSON.parse(readFileSync(new URL("golden/twin-graph.schema.json", import.meta.url), "utf8"));
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };

// CloudFront answers in botocore's shapes: the demo distribution (the stack's EDEMOTWIN00001) and a Vault's.
const HEALTH = "arn:aws:cloudfront::" + A + ":function/sws-vault-0a1b2c3d4e5f-health";
const origin = (id, domain) => "<Origin><Id>" + id + "</Id><DomainName>" + domain + "</DomainName><OriginPath></OriginPath><CustomHeaders><Quantity>1</Quantity><Items><OriginCustomHeader><HeaderName>X-Verify</HeaderName><HeaderValue>topsecret-value</HeaderValue></OriginCustomHeader></Items></CustomHeaders></Origin>";
const dist = (id, domain, origins, fns, logging) => "<Distribution><Id>" + id + "</Id><ARN>arn:aws:cloudfront::" + A + ":distribution/" + id + "</ARN><Status>Deployed</Status><DomainName>" + domain + "</DomainName>" +
  "<DistributionConfig><Aliases><Quantity>0</Quantity></Aliases><Origins><Quantity>" + origins.length + "</Quantity><Items>" + origins.join("") + "</Items></Origins>" +
  "<DefaultCacheBehavior><FunctionAssociations><Quantity>0</Quantity></FunctionAssociations></DefaultCacheBehavior>" +
  "<CacheBehaviors><Quantity>" + (fns ? 1 : 0) + "</Quantity>" + (fns ? "<Items><CacheBehavior><PathPattern>/health</PathPattern><FunctionAssociations><Quantity>1</Quantity><Items><FunctionAssociation><FunctionARN>" + HEALTH + "</FunctionARN><EventType>viewer-request</EventType></FunctionAssociation></Items></FunctionAssociations></CacheBehavior></Items>" : "") + "</CacheBehaviors>" +
  "<Logging><Enabled>" + (logging ? "true" : "false") + "</Enabled><IncludeCookies>false</IncludeCookies><Bucket>" + (logging || "") + "</Bucket><Prefix>cf/</Prefix></Logging><Enabled>true</Enabled></DistributionConfig></Distribution>";
const answers = {
  EDEMOTWIN00001: dist("EDEMOTWIN00001", "d111111abcdef8.cloudfront.net", [origin("site", SITE + ".s3.eu-west-2.amazonaws.com")], false, LOGS + ".s3.amazonaws.com"),
  EVAULTTWIN0001: dist("EVAULTTWIN0001", "d222222abcdef8.cloudfront.net", [origin("vault", "abcdefghij0123456789klmnopqrstuv.lambda-url.eu-west-2.on.aws")], true, null)
};
const fnList = "<FunctionList><NextMarker></NextMarker><Quantity>1</Quantity><Items><FunctionSummary><Name>sws-vault-0a1b2c3d4e5f-health</Name><Status>DEPLOYED</Status><FunctionConfig><Runtime>cloudfront-js-2.0</Runtime></FunctionConfig><FunctionMetadata><FunctionARN>" + HEALTH + "</FunctionARN><Stage>LIVE</Stage></FunctionMetadata></FunctionSummary></Items></FunctionList>";
const cf = CloudFrontApi(async (req) => { const p = new URL(req.url).pathname; return new Response(p.endsWith("/function") ? fnList : answers[p.split("/").pop()]); });
const distributions = [await cf.distribution("EDEMOTWIN00001"), await cf.distribution("EVAULTTWIN0001")], functions = (await cf.functions()).items;

// CfnApi over the twin (the demo-site stack makes EDEMOTWIN00001).
const t = await (await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() })).text();
const g1 = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1], creds = { accessKeyId: g1("AccessKeyId"), secretAccessKey: g1("SecretAccessKey"), sessionToken: g1("SessionToken") };
const send = async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body });
const cfn = CfnApi(send, { account: A });
const site = (await cfn.stacks("eu-west-2")).items.find((s) => s.name === "demo-site");
site.resources = (await cfn.resources("eu-west-2", site.arn)).items;

const build = (order) => {
  const g = Graph({ account: A, backend: "twin" });
  for (const step of order) {
    if (step === "cf") g.add.cloudfront({ distributions, functions });
    if (step === "cfn") g.add.cfn({ stacks: [site] });
    if (step === "logs") g.add.content([{ bucket: LOGS, key: "cloudfront/2026/11/22/edemotwin00001-2026-11-22-10-00-00.gz", text: JSON.stringify({ c_ip: "198.51.100.7", cs_uri_stem: "/", sc_status: 200 }) }]);
  }
  return JSON.parse(JSON.stringify(g.toJSON()));
};
const j = build(["cf", "cfn", "logs"]);
const node = (id) => j.nodes.find((n) => n.id === id), has = (f, rel, to) => j.edges.find((e) => e.from === f && e.rel === rel && e.to === to);
const D1 = "arn:aws:cloudfront::" + A + ":distribution/EDEMOTWIN00001", D2 = "arn:aws:cloudfront::" + A + ":distribution/EVAULTTWIN0001";

// ---- schema (invokes waits for ontology.aws.a's schema; everything else must fit) ----
const d = schema.$defs, idRe = new RegExp(d.node.properties.id.pattern);
ok(j.nodes.every((n) => d.node.required.every((k) => k in n) && d.node_type.enum.includes(n.type) && d.altitude.enum.includes(n.altitude) && idRe.test(n.id) && n.label), "nodes fit the schema");
ok(j.edges.every((e) => d.edge.required.every((k) => k in e) && (d.relation.enum.includes(e.rel) || e.rel === "invokes") && d.evidence.enum.includes(e.evidence) && Object.keys(e).every((k) => k in d.edge.properties)), "edges fit the schema (invokes pending ontology.aws.a's schema)");
const ids = new Set(j.nodes.map((n) => n.id));
ok(ids.size === j.nodes.length && j.edges.every((e) => ids.has(e.from) && ids.has(e.to)), "unique ids, every edge end a node");

// ---- nodes and edges ----
ok(node(D1) && node(D1).type === "distribution" && node(D1).label === "d111111abcdef8.cloudfront.net" && node(D1).trust === "verified" && node(D1).distribution_id === "EDEMOTWIN00001", "a node per distribution: its ARN, labelled by its domain, verified");
ok(has(D1, "serves_from", "arn:aws:s3:::" + SITE) && has(D1, "serves_from", "arn:aws:s3:::" + SITE).evidence === "api" && has(D1, "serves_from", "arn:aws:s3:::" + SITE).trust === "verified", "serves_from the site bucket, api and verified (the golden's content edge, now from the API)");
ok(!j.edges.some((e) => e.from === D2 && e.rel === "serves_from") && JSON.stringify(node(D2).origin_domains) === JSON.stringify(["abcdefghij0123456789klmnopqrstuv.lambda-url.eu-west-2.on.aws"]), "a Function URL origin: no edge (never a guess), its domain an attribute");
const inv = has(D2, "invokes", HEALTH);
ok(inv && inv.evidence === "api" && /viewer-request on \/health/.test(inv.source) && node(HEALTH).type === "function" && node(HEALTH).cfn_type === "AWS::CloudFront::Function" && node(HEALTH).runtime === "cloudfront-js-2.0", "invokes the health function, event and path in the source");
ok(has(D1, "logs_to", "arn:aws:s3:::" + LOGS) && has(D1, "logs_to", "arn:aws:s3:::" + LOGS).evidence === "api", "logs_to the legacy logging bucket, api");
ok(!JSON.stringify(j).includes("topsecret-value"), "no header value anywhere in the graph");

// ---- one node per distribution ----
ok(j.nodes.filter((n) => n.type === "distribution").length === 2, "two distributions, two nodes");
ok(has(D1, "made_by", site.arn) && node(D1).logical_id === undefined, "the stack's resource (derived ARN) is the same node: made_by the stack, CloudFront's own node kept");
ok(!node("urn:sws:cloudfront-distribution:edemotwin00001") && j.edges.some((e) => e.rel === "records" && e.to === D1 && e.evidence === "naming"), "the log files' naming node folds into the ARN node; its records edge moves with its own evidence");
for (const order of [["cfn", "logs", "cf"], ["logs", "cf", "cfn"], ["cfn", "cf", "logs"]])
  ok(JSON.stringify(build(order).edges) === JSON.stringify(j.edges) && build(order).nodes.length === j.nodes.length, "the same graph whatever order the adapters run: " + order);

// A name that matches no distribution id stays its own node.
{
  const g = Graph({ account: A, backend: "twin" });
  g.add.cloudfront({ distributions });
  g.add.content([{ bucket: LOGS, key: "cloudfront/demo-distribution-1-2026-11-22-10-00-00.gz", text: JSON.stringify({ c_ip: "198.51.100.7", cs_uri_stem: "/", sc_status: 200 }) }]);
  ok(g.toJSON().nodes.some((n) => n.id === "urn:sws:cloudfront-distribution:demo-distribution-1"), "a log name that is no distribution's id stays its own node");
}
// Bad input skipped.
{
  const g = Graph({ account: A, backend: "twin" });
  g.add.cloudfront({ distributions: [null, {}, { arn: "arn:aws:cloudfront::" + A + ":distribution/x/../y" }, { arn: D1, origins: [{ id: "o", target: "arn:aws:s3:::Bad Bucket" }], functions: [{ arn: "javascript:x" }] }], functions: [null] });
  g.add.cloudfront();
  const k = g.toJSON();
  ok(k.nodes.length === 1 && k.edges.length === 0, "bad distributions, origins and functions are skipped: " + k.nodes.map((n) => n.id));
}

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (graph cloudfront: " + passed + " checks; " + j.nodes.length + " nodes, " + j.edges.length + " edges)");
