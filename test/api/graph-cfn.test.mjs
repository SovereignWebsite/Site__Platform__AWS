// Graph.add.cfn (site/api/graph.js) over the twin's CloudFormation reads through CfnApi: stacks, their regions, what
// each made (made_by), imports (refers_to); derived ARNs giving way to the owning service's node (IAM); the same
// graph whether stacks are read by name or by ARN; everything in ontology.aws.a's schema. The golden graph's
// CloudFormation part is not compared yet: it predates the twin's CloudFormation reads (ontology.aws.a re-runs it).
// Node 22, no network. Run: node test/api/graph-cfn.test.mjs
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
for (const f of ["sigv4.js", "twin.js", "transport.js", "zip.js", "api/all.js", "api/cfn-api.js", "api/iam-api.js", "api/graph.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { CfnApi, IamApi, Graph, AwsTwin } = ctx, A = AwsTwin.account;
const schema = JSON.parse(readFileSync(new URL("golden/twin-graph.schema.json", import.meta.url), "utf8"));
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };

const r = await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() });
const t = await r.text(), g1 = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1];
const creds = { accessKeyId: g1("AccessKeyId"), secretAccessKey: g1("SecretAccessKey"), sessionToken: g1("SessionToken") };
const send = async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body });
const cfn = CfnApi(send, { account: A });

// What a page does: per region, the stacks (ARNs from stacks()), each one's resources by its ARN, the exports and,
// lazily, their importers.
async function read(byName) {
  const stacks = [], exports = [];
  for (const region of ["us-east-1", "eu-west-2"]) {
    const list = (await CfnApi.all((next) => cfn.stacks(region, { next }))).items;
    const ex = (await CfnApi.all((next) => cfn.exports(region, { next }))).items;
    exports.push(...ex);
    for (const st of list) {
      st.resources = (await CfnApi.all((next) => cfn.resources(region, byName ? st.name : st.arn, { next }))).items;
      st.importers = [];
      for (const x of ex.filter((e) => e.stackArn === st.arn))
        for (const name of (await CfnApi.all((next) => cfn.importers(region, x.name, { next }))).items) st.importers.push({ export: x.name, stack: name });
      stacks.push(st);
    }
  }
  return { stacks, exports };
}
const input = await read(false);
const g = Graph({ account: A, backend: "twin" });
g.add.cfn(input);
const j = JSON.parse(JSON.stringify(g.toJSON()));
const node = (id) => j.nodes.find((n) => n.id === id), has = (f, rel, to) => j.edges.find((e) => e.from === f && e.rel === rel && e.to === to);

// ---- schema ----
const d = schema.$defs, idRe = new RegExp(d.node.properties.id.pattern);
ok(j.nodes.every((n) => d.node.required.every((k) => k in n) && d.node_type.enum.includes(n.type) && d.altitude.enum.includes(n.altitude) && idRe.test(n.id) && n.label), "nodes fit the schema");
ok(j.edges.every((e) => d.edge.required.every((k) => k in e) && d.relation.enum.includes(e.rel) && d.evidence.enum.includes(e.evidence) && d.trust.enum.includes(e.trust)), "edges fit the schema");
const ids = new Set(j.nodes.map((n) => n.id));
ok(ids.size === j.nodes.length && j.edges.every((e) => ids.has(e.from) && ids.has(e.to)), "unique ids, every edge end a node");
ok(!j.nodes.some((n) => n.dangling), "no dangling nodes: every resource is described");

// ---- stacks and regions ----
const stacks = j.nodes.filter((n) => n.type === "stack");
ok(stacks.map((n) => n.label).sort().join() === "demo-dns,demo-lambda,demo-site,sws-aws-platform", "four stacks");
ok(stacks.every((n) => /^arn:aws:cloudformation:[a-z0-9-]+:\d{12}:stack\/[a-z0-9-]+\/[0-9a-f-]{36}$/.test(n.id) && n.trust === "verified" && n.altitude === "A2" && n.cfn_type === "AWS::CloudFormation::Stack"), "stack ids are AWS's StackIds, verified");
const arnOf = (name) => stacks.find((n) => n.label === name).id;
ok(has(arnOf("sws-aws-platform"), "in", "urn:sws:region:us-east-1") && has(arnOf("demo-site"), "in", "urn:sws:region:eu-west-2") && has("urn:sws:region:eu-west-2", "in", "urn:sws:account:" + A), "stacks in their regions, regions in the account");
ok(node(arnOf("demo-lambda")).status === "UPDATE_ROLLBACK_COMPLETE" && node(arnOf("demo-lambda")).attribute_trust.status.trust === "verified", "status kept as AWS's value, verified");

// ---- made_by ----
const made = (name) => j.edges.filter((e) => e.rel === "made_by" && e.to === arnOf(name)).map((e) => e.from).sort();
ok(made("sws-aws-platform").join() === ["change", "read"].map((x) => "arn:aws:iam::" + A + ":role/sws-aws-platform-" + x).join(), "the platform roles are made by sws-aws-platform (us-east-1)");
ok(made("demo-site").join() === ["arn:aws:cloudfront::" + A + ":distribution/EDEMOTWIN00001", "arn:aws:s3:::" + AwsTwin.buckets.logs, "arn:aws:s3:::" + AwsTwin.buckets.site].sort().join(), "demo-site made its buckets and distribution");
ok(made("demo-dns").join() === ["arn:aws:route53:::hostedzone/Z0DEMOTWIN0001", "urn:sws:record:www.example.com"].sort().join(), "demo-dns made its zone and a record set (the record id Route53Api gives www.example.com)");
ok(j.edges.filter((e) => e.rel === "made_by").every((e) => e.evidence === "api" && e.trust === "verified" && e.source === "CloudFormation ListStackResources"), "made_by: api evidence");
ok(node("arn:aws:s3:::" + AwsTwin.buckets.site).type === "bucket" && node("arn:aws:iam::" + A + ":role/demo-handler-role").type === "role" && node("arn:aws:iam::" + A + ":role/demo-handler-role").altitude === "A4"
  && node("arn:aws:lambda:eu-west-2:" + A + ":function:demo-handler").type === "function" && node("urn:sws:record:www.example.com").type === "record"
  && node("arn:aws:route53:::hostedzone/Z0DEMOTWIN0001").type === "unknown", "resources typed from their CloudFormation type where the schema has one");
ok(node("arn:aws:s3:::" + AwsTwin.buckets.site).arn_derived === true && node("arn:aws:s3:::" + AwsTwin.buckets.site).logical_id === "SiteBucket", "a derived ARN says so");
ok(node("arn:aws:s3:::" + AwsTwin.buckets.site).attribute_trust.id.trust === "claimed" && node(arnOf("demo-site")).attribute_trust.id === undefined && node("urn:sws:record:www.example.com").attribute_trust.id.trust === "claimed", "a node made only from a derived ARN or record id: its id is claimed");

// ---- refers_to (imports) ----
ok(has(arnOf("demo-dns"), "refers_to", arnOf("demo-site")) && has(arnOf("demo-dns"), "refers_to", arnOf("demo-site")).evidence === "api" && /demo-site-distribution-domain/.test(has(arnOf("demo-dns"), "refers_to", arnOf("demo-site")).source), "demo-dns imports from demo-site");

// ---- name or ARN: the same graph (architect.aws.a) ----
const h = Graph({ account: A, backend: "twin" });
h.add.cfn(await read(true));
ok(JSON.stringify(h.toJSON()) === JSON.stringify(g.toJSON()), "stacks read by name or by ARN give the same graph");
ok(JSON.stringify(g.toJSON()) === JSON.stringify(g.toJSON()), "toJSON twice gives the same graph");

// ---- a derived ARN gives way to the owning service's own (a role with a path) ----
{
  const k = Graph({ account: A, backend: "twin" });
  const st = { name: "s", arn: "arn:aws:cloudformation:eu-west-2:" + A + ":stack/s/00000000-0000-4000-8000-000000000001", region: "eu-west-2", status: "CREATE_COMPLETE",
    resources: [{ logicalId: "R", physicalId: "pathed", type: "AWS::IAM::Role", status: "CREATE_COMPLETE", arn: "arn:aws:iam::" + A + ":role/pathed", arnDerived: true }] };
  k.add.cfn({ stacks: [st] });
  k.add.iam({ roles: [{ name: "pathed", arn: "arn:aws:iam::" + A + ":role/team/pathed", path: "/team/", trust: { statements: [] }, attached: [] }] });
  const kj = k.toJSON();
  ok(kj.edges.some((e) => e.rel === "made_by" && e.from === "arn:aws:iam::" + A + ":role/team/pathed") && !kj.nodes.some((n) => n.id === "arn:aws:iam::" + A + ":role/pathed"), "IAM's ARN (with its path) wins over the derived one, whichever adapter ran first");
}
// ---- with IAM read too: one node per role, IAM's facts kept ----
{
  const iam = IamApi(send), k = Graph({ account: A, backend: "twin" });
  const roles = await Promise.all((await IamApi.all((next) => iam.roles({ next }))).items.map(async (x) => Object.assign(x, { attached: (await IamApi.all((next) => iam.attached(x.name, { next }))).items })));
  k.add.iam({ roles }); k.add.cfn(await read(false));
  const kj = k.toJSON(), rd = kj.nodes.filter((n) => n.id === "arn:aws:iam::" + A + ":role/sws-aws-platform-read");
  ok(rd.length === 1 && rd[0].logical_id === undefined && rd[0].attribute_trust.cfn_type.source.startsWith("IAM ") && kj.edges.some((e) => e.from === rd[0].id && e.rel === "made_by"), "the read role: one node, IAM's own (not remade from CloudFormation), made_by its stack");
}
// ---- bad input is skipped, not thrown ----
{
  const k = Graph({ account: A, backend: "twin" });
  k.add.cfn({ stacks: [null, {}, { name: "x" }, { name: "y", arn: "arn:aws:cloudformation:eu-west-2:" + A + ":stack/y/1", resources: [null, { logicalId: "Q" }], importers: [null, { export: "nope", stack: "z" }] }], exports: [null] });
  k.add.cfn();
  ok(k.toJSON().nodes.filter((n) => n.type === "stack").length === 1 && !k.toJSON().edges.some((e) => e.rel === "made_by" || e.rel === "refers_to"), "bad stacks, resources and imports are skipped");
}

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (graph cfn: " + passed + " checks; " + j.nodes.length + " nodes, " + j.edges.length + " edges from CloudFormation)");
