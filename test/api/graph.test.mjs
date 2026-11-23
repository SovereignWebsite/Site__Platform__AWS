// Graph (site/api/graph.js) over the twin, built as a page would: S3Api for buckets and objects (after the CORS fix
// a user's Approve would make), Activity.fromBytes for the trail files, then the golden test of design 03,
// refinement 7: against ontology.aws.a's twin-graph.json, compare node id, type, altitude and edge from, rel, to,
// evidence, on the part of the graph the adapters built so far cover (S3, CloudTrail files). The rest of the golden
// graph (IAM, CloudFormation, Lambda, Firehose, file contents, curated) waits for its adapters and is counted.
// Node 22, no network. Run: node test/api/graph.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array, Map, Set,
  setTimeout, crypto: globalThis.crypto, console, btoa,
  location: { search: "?twin", origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/s3-api.js", "api/decode.js", "api/activity.js", "api/graph.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const here = (p) => new URL(p, import.meta.url);
// Pinned copies (golden/README.md): dev's docs/ontology/ still has the older twin: ids until 849f77a lands.
const goldenPath = here("golden/twin-graph.json"), schemaPath = here("golden/twin-graph.schema.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")), schema = JSON.parse(readFileSync(schemaPath, "utf8"));
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };

// ---- build, as the page would ----
const A = ctx.AwsTwin.account;
const assume = async (role) => {
  const r = await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/" + role, RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() });
  const t = await r.text(), g = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1];
  return { accessKeyId: g("AccessKeyId"), secretAccessKey: g("SecretAccessKey"), sessionToken: g("SessionToken") };
};
const sender = (creds) => async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body });
const api = ctx.S3Api(sender(await assume("sws-aws-platform-read")));
const change = sender(await assume("sws-aws-platform-change"));

const buckets = [];
for (const name of await api.listBuckets()) {
  const b = await api.getBucket(name);
  buckets.push({ name, region: b.region, cors: b.cors });
  if (!b.cors) { // the CORS fix the page offers, applied as Approve would (refinement 7)
    const patch = JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [{ AllowedOrigins: ["https://example.test"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"] }] } }]);
    // Sent to the bucket's own region: Cloud Control refuses a bucket change from another region, and so does the twin.
    const r = await change({ service: "cloudcontrolapi", region: b.region, method: "POST", url: "https://cloudcontrolapi." + b.region + ".amazonaws.com/",
      headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": "CloudApiService.UpdateResource" }, body: JSON.stringify({ TypeName: "AWS::S3::Bucket", Identifier: name, PatchDocument: patch }) });
    ok(r.ok, "CORS fix on " + name);
  }
}
for (const b of buckets) {
  b.objects = []; let page = { next: undefined };
  do { page = await api.listObjects(b.name, b.region, { delimiter: "", token: page.next }); b.objects.push(...page.files.map((f) => ({ key: f.key, size: f.size, modified: f.modified }))); } while (page.next);
}
const g = ctx.Graph({ account: A });
g.add.s3(buckets);
const trail = buckets.find((b) => b.name === ctx.AwsTwin.buckets.trail);
for (const o of trail.objects.filter((o) => o.key.endsWith(".json.gz")))
  g.add.activity(await ctx.Activity.fromBytes((await api.getObject(trail.name, trail.region, o.key)).bytes, { name: o.key }), { bucket: trail.name, key: o.key });
const mine = JSON.parse(JSON.stringify(g.toJSON()));

// ---- schema: enums, required fields, id form, every edge end a node, counts ----
const d = schema.$defs, idRe = new RegExp(d.node.properties.id.pattern);
ok(mine.nodes.every((n) => d.node.required.every((k) => k in n) && d.node_type.enum.includes(n.type) && d.altitude.enum.includes(n.altitude) && idRe.test(n.id) && n.label), "nodes fit the schema");
ok(mine.edges.every((e) => d.edge.required.every((k) => k in e) && d.relation.enum.includes(e.rel) && d.evidence.enum.includes(e.evidence)), "edges fit the schema");
const ids = new Set(mine.nodes.map((n) => n.id));
ok(ids.size === mine.nodes.length && mine.edges.every((e) => ids.has(e.from) && ids.has(e.to)), "unique ids, every edge end a node");
ok(mine.counts.nodes === mine.nodes.length && mine.counts.edges === mine.edges.length && Object.values(mine.counts.by_evidence).reduce((a, b) => a + b, 0) === mine.edges.length, "counts add up");

// ---- golden: the covered part, both ways ----
const gNode = new Map(golden.nodes.map((n) => [n.id, n]));
const trailBucket = "arn:aws:s3:::" + ctx.AwsTwin.buckets.trail + "/";
const covered = (e, typeOf) => {
  const ft = typeOf(e.from);
  if (e.evidence === "curated" || e.evidence === "comment") return false;
  if (e.rel === "holds" && e.evidence === "api") return true;
  if (e.rel === "in" && e.evidence === "api" && ft === "bucket") return true;
  if (e.rel === "logs_to" && e.evidence === "naming" && ft === "trail") return true;
  if ((e.rel === "in" || e.rel === "records") && e.evidence === "content" && e.from.startsWith(trailBucket)) return true;
  if (["acted_as", "signed_in_via", "acted_on"].includes(e.rel) && ft === "event") return true;
  return false;
};
const extra = (e) => e.from.startsWith("urn:sws:actor-ip:"); // refinement 6: actor-ip from activity, not in the builder
function slice(graph) {
  const typeOf = (id) => (graph.nodes.find((n) => n.id === id) || {}).type;
  const es = graph.edges.filter((e) => covered(e, typeOf));
  const regions = new Set(es.flatMap((e) => [e.from, e.to]).filter((id) => typeOf(id) === "region"));
  graph.edges.filter((e) => e.rel === "in" && regions.has(e.from) && typeOf(e.to) === "account").forEach((e) => es.push(e));
  const ends = new Set(es.flatMap((e) => [e.from, e.to]));
  return { edges: new Set(es.map((e) => [e.from, e.rel, e.to, e.evidence].join(" | "))), nodes: new Set(graph.nodes.filter((n) => ends.has(n.id)).map((n) => [n.id, n.type, n.altitude].join(" | "))) };
}
const gs = slice(golden), ms = slice({ nodes: mine.nodes, edges: mine.edges.filter((e) => !extra(e)) });
const missing = [...gs.edges].filter((x) => !ms.edges.has(x)), surplus = [...ms.edges].filter((x) => !gs.edges.has(x));
ok(!missing.length, "edges in the golden graph the adapters should give:\n  " + missing.join("\n  "));
ok(!surplus.length, "edges the adapters give that the golden graph lacks:\n  " + surplus.join("\n  "));
const nMissing = [...gs.nodes].filter((x) => !ms.nodes.has(x)), nSurplus = [...ms.nodes].filter((x) => !gs.nodes.has(x));
ok(!nMissing.length && !nSurplus.length, "nodes (id, type, altitude) differ:\n  missing " + nMissing.join("\n  missing ") + "\n  surplus " + nSurplus.join("\n  surplus "));
// Every node the adapters made outright (not a dangling end) is in the golden graph with the same type and altitude,
// apart from actor-ip nodes.
ok(mine.nodes.filter((n) => !n.dangling && !n.id.startsWith("urn:sws:actor-ip:")).every((n) => gNode.has(n.id) && gNode.get(n.id).type === n.type && gNode.get(n.id).altitude === n.altitude), "every built node matches the golden graph");

// ---- refinement 6: the caller's address acts on what the events touched ----
const actorEdges = mine.edges.filter(extra);
ok(actorEdges.length > 0 && actorEdges.every((e) => e.rel === "acted_on" && e.evidence === "content"), "actor-ip nodes with acted_on edges");

// ---- hostile names stay data ----
const h = ctx.Graph({ account: A });
h.add.s3([{ name: "b", region: "eu-west-2", cors: null, objects: [{ key: "<img src=x onerror=alert(1)>.txt", size: 1 }] }]);
ok(h.toJSON().nodes.some((n) => n.label === "<img src=x onerror=alert(1)>.txt"), "a hostile key is a label as it is");
ok(!/\beval\s*\(|new Function|innerHTML|document\.|localStorage|fetch\(/.test(readFileSync(here("../../site/api/graph.js"), "utf8")), "graph.js: no eval, HTML, storage or network");

const uncovered = golden.edges.length - gs.edges.size - golden.edges.filter((e) => e.evidence === "curated" || e.evidence === "comment").length;
if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (graph: " + passed + " checks; " + mine.nodes.length + " nodes, " + mine.edges.length + " edges; golden slice " + gs.nodes.size + " nodes and " + gs.edges.size + " edges equal; " + uncovered + " golden edges wait for the IAM, CloudFormation, Lambda, Firehose and content adapters)");
