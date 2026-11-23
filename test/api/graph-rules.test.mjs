// Graph.rules (site/api/graph.js): Desk's findings and questions (ux.aws.a design 08 section 7; design 07 "Worth a
// look") as data over a toJSON() result: unowned, by-name-only, dangling-confirmed, dangling-claimed. First on a small
// graph made by hand, then on the twin's buckets and stacks read through S3Api and CfnApi. Node 22, no network.
// Run: node test/api/graph-rules.test.mjs
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
for (const f of ["sigv4.js", "twin.js", "transport.js", "zip.js", "api/all.js", "api/s3-api.js", "api/cfn-api.js", "api/iam-api.js", "api/graph.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { Graph, AwsTwin, CfnApi, S3Api } = ctx, A = AwsTwin.account;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- by hand ----
{
  const g = Graph({ account: A, backend: "twin" });
  const stack = { name: "s", arn: "arn:aws:cloudformation:eu-west-2:" + A + ":stack/s/1", region: "eu-west-2", status: "CREATE_COMPLETE",
    resources: [{ logicalId: "B", physicalId: "made-bucket", type: "AWS::S3::Bucket", status: "CREATE_COMPLETE", arn: "arn:aws:s3:::made-bucket", arnDerived: true }] };
  g.add.s3([{ name: "made-bucket", region: "eu-west-2" }, { name: "lone-bucket", region: "eu-west-2" }, { name: "aws-cloudtrail-logs-" + A + "-main", region: "eu-west-2" }]);
  g.add.cfn({ stacks: [stack] });
  g.add.lambda([{ name: "f", arn: "arn:aws:lambda:eu-west-2:" + A + ":function:f", region: "eu-west-2" }]);
  // A stream AWS answered for writes to a bucket S3 did not list: named by an API answer, described by no adapter.
  g.add.firehose([{ name: "st", arn: "arn:aws:firehose:eu-west-2:" + A + ":deliverystream/st", region: "eu-west-2", destinations: [{ kind: "s3", bucket: "missing-bucket", prefix: "" }] }]);
  const r = plain(Graph.rules(g.toJSON())), by = Object.fromEntries(r.map((x) => [x.id, x]));
  ok(r.map((x) => x.id).join() === "dangling-confirmed,unowned,by-name-only", "rules, findings first: " + r.map((x) => x.id));
  ok(JSON.stringify(by.unowned.nodes) === JSON.stringify(["arn:aws:firehose:eu-west-2:" + A + ":deliverystream/st", "arn:aws:lambda:eu-west-2:" + A + ":function:f", "arn:aws:s3:::aws-cloudtrail-logs-" + A + "-main", "arn:aws:s3:::lone-bucket"]) && by.unowned.kind === "finding" && by.unowned.evidence === "confirmed" && by.unowned.count === 4,
    "unowned: the buckets, function and stream no stack made, not the made bucket, not the missing one: " + JSON.stringify(by.unowned.nodes));
  ok(by["dangling-confirmed"] && JSON.stringify(by["dangling-confirmed"].nodes) === JSON.stringify(["arn:aws:s3:::missing-bucket"]) && by["dangling-confirmed"].title === "Named by AWS, not found", "dangling-confirmed: the bucket the stream names, which S3 did not list " + JSON.stringify(r.map((x) => [x.id, x.nodes])));
  ok(by["by-name-only"].kind === "question" && by["by-name-only"].evidence === "claimed" && by["by-name-only"].count === 1 &&
    JSON.stringify(by["by-name-only"].edges) === JSON.stringify([{ from: "urn:sws:cloudtrail-trail:main", rel: "logs_to", to: "arn:aws:s3:::aws-cloudtrail-logs-" + A + "-main" }]), "by-name-only: the trail named by its bucket, a question");
  ok(r.every((x) => Object.keys(x).every((k) => ["id", "kind", "evidence", "title", "count", "nodes", "edges"].includes(k))), "items carry only id, kind, evidence, title, count, nodes and edges: nothing that changes anything");

  // Without stacks nothing is known about who made what: no unowned item.
  const h = Graph({ account: A, backend: "twin" });
  h.add.s3([{ name: "lone-bucket", region: "eu-west-2" }]);
  ok(!Graph.rules(h.toJSON()).some((x) => x.id === "unowned"), "no stacks read: no unowned claim");
  // A dangling end named only by a claimed edge is a question.
  const q = Graph({ account: A, backend: "twin" });
  q.add.content([{ bucket: "b", key: "config.json", text: JSON.stringify({ data: "s3://nowhere-bucket/x" }) }]);
  const qr = plain(Graph.rules(q.toJSON()));
  const dc = qr.find((x) => x.id === "dangling-claimed");
  ok(dc && dc.kind === "question" && dc.nodes.includes("arn:aws:s3:::nowhere-bucket") && !qr.some((x) => x.id === "dangling-confirmed" && x.nodes.includes("arn:aws:s3:::nowhere-bucket")), "dangling-claimed: a bucket only a file names, a question " + JSON.stringify(qr.map((x) => [x.id, x.nodes])));
  ok(JSON.stringify(plain(Graph.rules({}))) === "[]" && JSON.stringify(plain(Graph.rules(null))) === "[]" && JSON.stringify(plain(Graph.rules({ nodes: [null, 3], edges: [null] }))) === "[]", "bad input gives no items, not an error");
  ok(JSON.stringify(Graph.rules(g.toJSON())) === JSON.stringify(Graph.rules(g.toJSON())), "stable order");
}

// ---- over the twin: buckets through S3Api, stacks through CfnApi ----
{
  const r = await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() });
  const t = await r.text(), gt = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1];
  const creds = { accessKeyId: gt("AccessKeyId"), secretAccessKey: gt("SecretAccessKey"), sessionToken: gt("SessionToken") };
  const send = async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body });
  const s3 = S3Api(send), cfn = CfnApi(send, { account: A });
  const buckets = [];
  for (const name of await s3.listBuckets()) buckets.push({ name, region: (await s3.getBucket(name)).region });
  const stacks = [];
  for (const region of ["us-east-1", "eu-west-2"])
    for (const st of (await CfnApi.all((next) => cfn.stacks(region, { next }))).items) {
      st.resources = (await CfnApi.all((next) => cfn.resources(region, st.arn, { next }))).items;
      stacks.push(st);
    }
  const g = Graph({ account: A, backend: "twin" });
  g.add.s3(buckets); g.add.cfn({ stacks });
  const items = plain(Graph.rules(g.toJSON())), un = items.find((x) => x.id === "unowned");
  const made = new Set([AwsTwin.buckets.site, AwsTwin.buckets.logs, AwsTwin.buckets.deps].map((b) => "arn:aws:s3:::" + b));
  const expect = buckets.map((b) => "arn:aws:s3:::" + b.name).filter((id) => !made.has(id)).sort();
  ok(un && JSON.stringify(un.nodes) === JSON.stringify(expect), "twin: unowned is every bucket but the three the demo stacks made (" + (un && un.count) + "): " + JSON.stringify(un && un.nodes));
  ok(un && ![...made].some((id) => un.nodes.includes(id)), "twin: the stacks' buckets are not unowned");
  ok(!items.some((x) => x.kind === "question" && /remove|delete|narrow|replace/i.test(x.title)), "no question suggests removing, replacing or narrowing anything (R-020)");
}

const src = readFileSync(new URL("../../site/api/graph.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("Graph.rules = function"), src.indexOf("// A zip's facts"));
ok(body.length > 0 && !/send\(|fetch\(|plan|innerHTML|localStorage/.test(body.replace(/\/\/.*$/gm, "")), "Graph.rules reads only: no requests, no plans, no HTML, no storage");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (graph rules: " + passed + " checks; unowned, by-name-only, dangling-confirmed and dangling-claimed, by hand and over the twin)");
