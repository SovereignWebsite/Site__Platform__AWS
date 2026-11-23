// Graph (site/api/graph.js) over the twin, built as a page would: S3Api for buckets and objects (after the CORS fix
// a user's Approve would make), Activity.fromBytes for the trail files, then the golden test of design 03,
// refinement 7: against ontology.aws.a's twin-graph.json, compare node id, type, altitude and edge from, rel, to,
// evidence, on the part of the graph the adapters built so far cover (S3, CloudTrail files, what files say, Lambda, Firehose, zips, IAM). The rest of the golden
// graph (CloudFormation, serves_from, curated) waits for its adapters and is counted.
// Node 22, no network. Run: node test/api/graph.test.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Each demo pack is a whole synthetic world, chosen when the twin loads: one process per pack.
const PACK = process.env.GRAPH_TEST_PACK;
if (!PACK) {
  let failed = false;
  for (const p of ["baseline", "attack", "surge"]) {
    try { process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, GRAPH_TEST_PACK: p }, stdio: ["ignore", "pipe", "pipe"] }).toString()); }
    catch (e) { process.stderr.write(String(e.stdout || "") + String(e.stderr || e.message)); failed = true; }
  }
  process.exit(failed ? 1 : 0);
}

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array, Map, Set,
  setTimeout, crypto: globalThis.crypto, console, btoa, atob, encodeURIComponent, decodeURIComponent,
  location: { search: "?twin&pack=" + PACK, origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "zip.js", "api/all.js", "api/s3-api.js", "api/lambda-api.js", "api/firehose-api.js", "api/iam-api.js", "data/extract.js", "api/decode.js", "api/activity.js", "api/graph.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const here = (p) => new URL(p, import.meta.url);
// Pinned copies (golden/README.md): ontology.aws.a's builder run against this branch's twin.
const goldenPath = here("golden/twin-graph" + (PACK === "baseline" ? "" : "." + PACK) + ".json"), schemaPath = here("golden/twin-graph.schema.json");
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
const g = ctx.Graph({ account: A, backend: "twin" });
g.add.s3(buckets);
const trail = buckets.find((b) => b.name === ctx.AwsTwin.buckets.trail);
for (const o of trail.objects.filter((o) => o.key.endsWith(".json.gz")))
  g.add.activity(await ctx.Activity.fromBytes((await api.getObject(trail.name, trail.region, o.key)).bytes, { name: o.key }), { bucket: trail.name, key: o.key });
// Content: every object the graph shows on its own (not inside a grouped prefix), read and decoded as a page would.
const D = ctx.Decode, files = [];
const grouped = (b, key) => b.objects.filter((o) => o.key.slice(0, o.key.lastIndexOf("/") + 1) === key.slice(0, key.lastIndexOf("/") + 1)).length > 50;
for (const b of buckets) for (const o of b.objects) {
  if (o.key.includes("/") && grouped(b, o.key)) continue;
  let bytes = (await api.getObject(b.name, b.region, o.key)).bytes, kind = D.sniff(bytes, { name: o.key });
  if (kind === "gzip") { bytes = (await D.gunzip(bytes)).bytes; kind = D.sniff(bytes, { name: o.key.replace(/\.gz$/, "") }); }
  if (kind === "zip" || kind === "binary") continue;
  files.push({ bucket: b.name, key: o.key, text: D.text(bytes) });
}
g.add.content(files, { site: { name: "demo", label: "Demo site", bucket: ctx.AwsTwin.buckets.site } });
// Lambda and Firehose, in the twin's region, every page through ApiAll.
const readSend = sender(await assume("sws-aws-platform-read"));
const lam = ctx.LambdaApi(readSend), fh = ctx.FirehoseApi(readSend, { account: A }), R = "eu-west-2";
g.add.lambda((await ctx.LambdaApi.all((next) => lam.functions(R, { next }))).items);
const names = (await ctx.FirehoseApi.all((next) => fh.streams(R, { next }))).items;
g.add.firehose(await Promise.all(names.map((s) => fh.stream(R, s.name))));
// Deployment packages: every zip the graph shows, its facts read in memory.
const zipFacts = [];
for (const b of buckets) for (const o of b.objects.filter((o) => ctx.Zip.isZip(o.key) && !(o.key.includes("/") && grouped(b, o.key))))
  zipFacts.push(Object.assign({ bucket: b.name, key: o.key }, await ctx.Graph.zipFacts((await api.getObject(b.name, b.region, o.key)).bytes)));
ok(zipFacts.length > 0 && zipFacts.every((z) => /^[A-Za-z0-9+/]{43}=$/.test(z.sha256)), "zip facts: " + JSON.stringify(zipFacts.map((z) => [z.key, z.packageName, z.entries])));
g.add.zips(zipFacts);
// IAM: every role, its trust and attached policies, and the OIDC providers.
const iamApi = ctx.IamApi(readSend);
// ListRoles carries each role's trust, so no GetRole per role (design 04).
const roles = await Promise.all((await ctx.IamApi.all((next) => iamApi.roles({ next }))).items.map(async (r) =>
  Object.assign(r, { attached: (await ctx.IamApi.all((next) => iamApi.attached(r.name, { next }))).items })));
g.add.iam({ roles, providers: await iamApi.providers() });
const mine = JSON.parse(JSON.stringify(g.toJSON()));

// ---- schema: enums, required fields, id form, every edge end a node, counts ----
const d = schema.$defs, idRe = new RegExp(d.node.properties.id.pattern);
ok(mine.nodes.every((n) => d.node.required.every((k) => k in n) && d.node_type.enum.includes(n.type) && d.altitude.enum.includes(n.altitude) && idRe.test(n.id) && n.label), "nodes fit the schema");
ok(mine.edges.every((e) => d.edge.required.every((k) => k in e) && d.relation.enum.includes(e.rel) && d.evidence.enum.includes(e.evidence)), "edges fit the schema");
const ids = new Set(mine.nodes.map((n) => n.id));
ok(ids.size === mine.nodes.length && mine.edges.every((e) => ids.has(e.from) && ids.has(e.to)), "unique ids, every edge end a node");
ok(mine.backend === "twin" && d.backend.enum.includes(mine.backend) && mine.nodes.every((n) => n.backend === mine.backend && d.trust.enum.includes(n.trust)) && mine.edges.every((e) => d.trust.enum.includes(e.trust)), "backend and trust fit the schema");
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
  // Lambda and Firehose adapters
  if (e.rel === "in" && e.evidence === "api" && (ft === "function" || ft === "stream")) return true;
  if (["runs_as", "writes_to", "transforms_with"].includes(e.rel) && e.evidence === "api") return true;
  if (e.rel === "logs_to" && e.evidence === "naming" && ft === "distribution") return true;
  if (e.rel === "packages") return true;
  // IAM adapter
  if (e.rel === "in" && e.evidence === "api" && ft === "role") return true;
  if ((e.rel === "trusts" || e.rel === "allows_subject") && e.evidence === "api") return true;
  if (e.rel === "has_policy") return true;
  // content adapter
  if (e.rel === "refers_to" && e.evidence === "content") return true;
  if ((e.rel === "in" || e.rel === "part_of") && e.evidence === "content" && ft === "vault") return true;
  if (e.rel === "records" && e.evidence === "naming" && typeOf(e.to) === "distribution") return true;
  if ((e.rel === "seen_in" || e.rel === "targeted" || e.rel === "acted_on") && e.evidence === "content" && ft === "actor") return true;
  return false;
};
function slice(graph) {
  const typeOf = (id) => (graph.nodes.find((n) => n.id === id) || {}).type;
  const es = graph.edges.filter((e) => covered(e, typeOf));
  const regions = new Set(es.flatMap((e) => [e.from, e.to]).filter((id) => typeOf(id) === "region"));
  graph.edges.filter((e) => e.rel === "in" && regions.has(e.from) && typeOf(e.to) === "account").forEach((e) => es.push(e));
  const ends = new Set(es.flatMap((e) => [e.from, e.to]));
  return { edges: new Set(es.map((e) => [e.from, e.rel, e.to, e.evidence, e.trust].join(" | "))), nodes: new Set(graph.nodes.filter((n) => ends.has(n.id)).map((n) => [n.id, n.type, n.altitude, n.trust].join(" | "))) };
}
ok(!golden.nodes.some((n) => n.id.startsWith("urn:sws:actor-ip:")), "the golden graph names networks, not addresses");
const gs = slice(golden), ms = slice(mine);
const missing = [...gs.edges].filter((x) => !ms.edges.has(x)), surplus = [...ms.edges].filter((x) => !gs.edges.has(x));
ok(!missing.length, "edges in the golden graph the adapters should give:\n  " + missing.join("\n  "));
ok(!surplus.length, "edges the adapters give that the golden graph lacks:\n  " + surplus.join("\n  "));
const nMissing = [...gs.nodes].filter((x) => !ms.nodes.has(x)), nSurplus = [...ms.nodes].filter((x) => !gs.nodes.has(x));
ok(!nMissing.length && !nSurplus.length, "nodes (id, type, altitude) differ:\n  missing " + nMissing.join("\n  missing ") + "\n  surplus " + nSurplus.join("\n  surplus "));
// Every node the adapters made outright (not a dangling end) is in the golden graph with the same type, altitude,
// trust and backend.
const offGolden = mine.nodes.filter((n) => !n.dangling && !(gNode.has(n.id) && gNode.get(n.id).type === n.type && gNode.get(n.id).altitude === n.altitude && gNode.get(n.id).trust === n.trust && gNode.get(n.id).backend === n.backend));
ok(!offGolden.length, "every built node matches the golden graph: " + offGolden.map((n) => n.id + " " + n.type).join(", "));

// ---- refinement 6: the caller's address acts on what the events touched ----
const actorEdges = mine.edges.filter((e) => e.from.startsWith("urn:sws:actor-net:") && e.rel === "acted_on");
ok(actorEdges.length > 0 && actorEdges.every((e) => e.rel === "acted_on" && e.evidence === "content"), "actor-net nodes with acted_on edges");
// Privacy (design 03): no address anywhere in the graph, only networks.
const json = JSON.stringify(mine);
ok(!/urn:sws:actor-ip:|"src_ip"/.test(json) && !/\b(\d{1,3}\.){3}(?!0\/24)\d{1,3}\b/.test(json.replace(/arn:aws:[^"]*/g, "")), "no addresses in the graph, only networks");
// Design 03's split (dev.1.aws.a b44f852): visitors are in 198.51.100.0/24 and 192.0.2.0/24, the attack pack's
// attacker alone in 203.0.113.0/24, so at /24 the refused-requests rule singles the attacker out again: in the
// attack pack its network is the one CloudFront actor; in the others there is none.
const cfActors = mine.edges.filter((e) => e.rel === "seen_in" || e.rel === "targeted");
if (PACK === "attack") ok(cfActors.length > 0 && cfActors.every((e) => e.from === "urn:sws:actor-net:203.0.113.0/24"), "pack attack: the attacker's network, and only it, is singled out (" + cfActors.length + " edges)");
else ok(!cfActors.length, "pack " + PACK + ": no CloudFront actor singled out");
// The operator's network (192.0.2.0/24, CloudTrail's sourceIPAddress 192.0.2.7) holds only the operator: its node has
// CloudTrail acted_on edges and no CloudFront edges, in every pack (architect.aws.a on b44f852).
const opEdges = mine.edges.filter((e) => e.from === "urn:sws:actor-net:192.0.2.0/24");
ok(opEdges.length > 0 && opEdges.every((e) => e.rel === "acted_on") && !cfActors.some((e) => e.from === "urn:sws:actor-net:192.0.2.0/24"), "pack " + PACK + ": the operator's network has only CloudTrail acted_on edges (" + opEdges.length + ")");

// ---- hostile names stay data ----
const h = ctx.Graph({ account: A, backend: "twin" });
h.add.s3([{ name: "b", region: "eu-west-2", cors: null, objects: [{ key: "<img src=x onerror=alert(1)>.txt", size: 1 }] }]);
ok(h.toJSON().nodes.some((n) => n.label === "<img src=x onerror=alert(1)>.txt"), "a hostile key is a label as it is");
ok(!/\beval\s*\(|new Function|innerHTML|document\.|localStorage|fetch\(/.test(readFileSync(here("../../site/api/graph.js"), "utf8")), "graph.js: no eval, HTML, storage or network");

// ---- content rules at their edges ----
{
  const c = ctx.Graph({ account: A, backend: "twin" });
  const line = (ip, st, path = "/x") => JSON.stringify({ c_ip: ip, cs_uri_stem: path, sc_status: st });
  const log = (k, ls) => ({ bucket: "logs", key: "cf/" + k + "-2026-11-22-10-00-00.gz", text: ls.join("\n") + "\n" });
  c.add.content([
    { bucket: "site", key: "data/v.json", text: JSON.stringify({ vaults: [{ id: "v1", region: "eu-west-1" }, { id: "" }, { region: "x" }, "junk", { id: "v2", region: "not a region" }] }) },
    { bucket: "site", key: "data/other.json", text: JSON.stringify({ items: [{ id: "nope" }] }) },
    { bucket: "site", key: "notes.txt", text: "see s3://not-config-file/" },
    { bucket: "site", key: "app.env", text: "A=s3://bucket-one/x\nB=s3://bucket-one/y\n" },
    log("d1", [...Array(9)].map(() => line("192.0.2.1", 403))),                                        // 9 refused: under 10
    log("d2", [...Array(10)].map((_, i) => line(i % 2 ? "198.51.100.2" : "198.51.100.77", i < 8 ? 404 : 200, "/vault/v1/files"))), // 8 of 10 in one /24: exactly 80%
    log("d3", [...Array(10)].map(() => line("203.0.113.3", 503))),                                     // 5xx is not refused
    log("d4", ["not json", JSON.stringify({ hello: 1 })])                                              // no log lines: no distribution
  ], { site: { name: "s", bucket: "site" } });
  const j = JSON.parse(JSON.stringify(c.toJSON())), has = (id) => j.nodes.some((n) => n.id === id && !n.dangling);
  const e = (f, r, t) => j.edges.some((x) => x.from === f && x.rel === r && x.to === t);
  ok(has("urn:sws:vault:v1") && has("urn:sws:vault:v2") && !has("urn:sws:vault:") && !has("urn:sws:vault:nope"), "only well-formed vault entries in a vaults list");
  ok(e("urn:sws:vault:v1", "in", "urn:sws:region:eu-west-1") && !j.edges.some((x) => x.from === "urn:sws:vault:v2" && x.rel === "in"), "a vault's region only when it is a region");
  ok(e("urn:sws:vault:v1", "part_of", "urn:sws:site:s"), "a vault listed in the site's bucket is part of the site");
  ok(!j.edges.some((x) => x.to === "arn:aws:s3:::not-config-file") && j.edges.filter((x) => x.to === "arn:aws:s3:::bucket-one").length === 1, "s3:// only from config files, once per file");
  ok(!has("urn:sws:actor-net:192.0.2.0/24") && has("urn:sws:actor-net:198.51.100.0/24") && !has("urn:sws:actor-net:203.0.113.0/24"), "actor rule per network: at least 10 requests, at least 80% 4xx");
  ok(e("urn:sws:actor-net:198.51.100.0/24", "targeted", "urn:sws:vault:v1") && e("logs/cf/d2-2026-11-22-10-00-00.gz".replace(/^/, "arn:aws:s3:::"), "refers_to", "urn:sws:vault:v1"), "actor targets the vault; the log file refers to it");
  ok(has("urn:sws:cloudfront-distribution:d1") && !has("urn:sws:cloudfront-distribution:d4"), "a distribution only from files with log lines");
}

// ---- packages: by SHA-256 (api), else by METADATA name (naming), whichever order adapters run ----
{
  const z = ctx.Graph({ account: A, backend: "twin" }), fnArn = (n) => "arn:aws:lambda:eu-west-2:" + A + ":function:" + n;
  z.add.zips([{ bucket: "deps", key: "a.zip", sha256: "S1", packageName: "other" }, { bucket: "deps", key: "b.zip", sha256: "nope", packageName: "f2" }, { bucket: "deps", key: "c.zip", sha256: "nope", packageName: null }]);
  z.add.lambda([{ name: "f1", arn: fnArn("f1"), region: "eu-west-2", codeSha256: "S1" }, { name: "f2", arn: fnArn("f2"), region: "eu-west-2", codeSha256: "S2" }]);
  const pk = JSON.parse(JSON.stringify(z.toJSON())).edges.filter((e) => e.rel === "packages").map((e) => e.from.split("/").pop() + ">" + e.to.split(":").pop() + ":" + e.evidence);
  ok(JSON.stringify(pk) === JSON.stringify(["a.zip>f1:api", "b.zip>f2:naming"]), "packages rules " + JSON.stringify(pk));
}

// ---- IAM rules, and one edge per from, rel, to with the strongest evidence and both sources ----
{
  const i = ctx.Graph({ account: A, backend: "twin" }), R = "arn:aws:iam::" + A + ":role/", OIDC = (h) => "arn:aws:iam::" + A + ":oidc-provider/" + h;
  const st = (effect, principals, conditions = []) => ({ effect, actions: ["sts:AssumeRoleWithWebIdentity"], notActions: [], principals, notPrincipals: [], conditions });
  i.add.iam({ roles: [
    { name: "a", arn: R + "a", trust: { statements: [st("Allow", [{ kind: "federated", id: OIDC("token.actions.githubusercontent.com") }], [{ op: "StringLike", key: "token.actions.githubusercontent.com:sub", values: ["repo:org/app:ref:refs/heads/main", "not-a-subject"] }])] } },
    { name: "b", arn: R + "b", trust: { statements: [st("Allow", [{ kind: "federated", id: OIDC("oidc.example.test") }], [{ op: "StringEquals", key: "oidc.example.test:sub", values: ["repo:org/app:x"] }])] } },
    { name: "c", arn: R + "c", trust: { statements: [st("Deny", [{ kind: "federated", id: "accounts.google.com" }]), st("Allow", [{ kind: "service", id: "lambda.amazonaws.com" }, { kind: "aws", id: "arn:aws:iam::444455556666:root" }])] } },
    { name: "d", arn: R + "d", trust: { statements: [st("Allow", [{ kind: "federated", id: "arn:aws:iam::" + A + ":saml-provider/Corp" }])] }, attached: [{ name: "Mine", arn: "arn:aws:iam::" + A + ":policy/Mine" }] }
  ] });
  const j = JSON.parse(JSON.stringify(i.toJSON())), e = (f, r, t) => j.edges.find((x) => x.from === f && x.rel === r && x.to === t);
  ok(e(R + "a", "allows_subject", "urn:sws:github-subject:org/app:ref:refs/heads/main") && j.edges.filter((x) => x.rel === "allows_subject").length === 1, "GitHub sub under StringLike; non-subjects skipped");
  ok(e(R + "b", "trusts", OIDC("oidc.example.test")) && !j.edges.some((x) => x.from === R + "b" && x.rel === "allows_subject"), "another OIDC provider is trusted, with no GitHub subjects");
  ok(!j.edges.some((x) => x.from === R + "c" && x.rel === "trusts"), "Deny statements and service or account principals make no trusts edge");
  ok(e(R + "d", "trusts", "arn:aws:iam::" + A + ":saml-provider/Corp") && e(R + "d", "has_policy", "arn:aws:iam::" + A + ":policy/Mine") && !j.nodes.find((n) => n.id.endsWith(":policy/Mine")).aws_managed, "SAML provider; a customer managed policy");
  const m = ctx.Graph({ account: A, backend: "twin" });
  m.add.iam({ roles: [{ name: "x", arn: R + "x", trust: { statements: [] }, attached: [{ name: "P", arn: "arn:aws:iam::aws:policy/P" }] }] });
  const me = JSON.parse(JSON.stringify(m.toJSON())).edges.find((x) => x.rel === "has_policy");
  ok(me.evidence === "api" && me.source === "IAM ListAttachedRolePolicies", "has_policy from IAM");
  // The same edge again from a weaker source (as a stack template would give it): one edge, api kept, both sources.
  const g2 = ctx.Graph({ account: A, backend: "twin" });
  g2.add.s3([{ name: "b1", region: "eu-west-2", cors: {}, objects: [] }]);
  g2.add.activity({ events: [] }, { bucket: "b1", key: "AWSLogs/" + A + "/CloudTrail/eu-west-2/x.json.gz" });
  const rin = JSON.parse(JSON.stringify(g2.toJSON())).edges.find((x) => x.from === "urn:sws:region:eu-west-2" && x.rel === "in");
  ok(rin.evidence === "api" && rin.source === "Cloud Control GetResource; CloudTrail key path", "one edge, strongest evidence, both sources: " + JSON.stringify(rin));
}

// ---- security R-019 a: addresses and keys from files are data, never object keys that reach a prototype ----
{
  const c = ctx.Graph({ account: A, backend: "twin" }), lines = (ip, n) => [...Array(n)].map(() => JSON.stringify({ c_ip: ip, cs_uri_stem: "/vault/__proto__/files", sc_status: 403 }));
  c.add.content([{ bucket: "b", key: "data/v.json", text: JSON.stringify({ vaults: [{ id: "__proto__" }, { id: "constructor" }] }) },
    { bucket: "logs", key: "cf/__proto__-2026-11-22-10-00-00.gz", text: lines("__proto__", 5).concat(lines("constructor", 12)).join("\n") }], {});
  const j = JSON.parse(JSON.stringify(c.toJSON()));
  ok(({}).requests === undefined && ({}).polluted === undefined, "Object.prototype untouched");
  ok(j.nodes.some((n) => n.id === "urn:sws:vault:__proto__") && !j.nodes.some((n) => /actor-(ip|net):(__proto__|constructor)/.test(n.id)), "vault ids are data; non-addresses are never actors");
}

// ---- security R-020, design 03 "Trust of evidence" ----
{
  let threw = false; try { ctx.Graph({ account: A }); } catch (e) { threw = e instanceof TypeError; }
  ok(threw, "no backend: refused, never inferred");
  const R = "arn:aws:iam::" + A + ":role/";
  // A planted CloudTrail record and a planted zip: only claimed edges and nodes.
  const p = ctx.Graph({ account: A, backend: "aws" });
  p.add.activity({ events: [{ node: "urn:sws:cloudtrail-event:planted", words: "w", iso: "2026-11-22T12:00:00Z", from: { net: "203.0.113.0/24" }, who: { kind: "role", name: "dormant", arn: R + "dormant", via: "accounts.google.com" },
    targets: [{ type: "role", id: R + "admin", name: "admin" }] }] }, { bucket: "b1", key: "AWSLogs/" + A + "/CloudTrail/eu-west-2/x.json.gz" });
  p.add.zips([{ bucket: "b1", key: "evil.zip", sha256: "nope", packageName: "real-fn" }]);
  p.add.lambda([{ name: "real-fn", arn: "arn:aws:lambda:eu-west-2:" + A + ":function:real-fn", region: "eu-west-2", codeSha256: "S" }]);
  const pj = JSON.parse(JSON.stringify(p.toJSON())), N = (id) => pj.nodes.find((n) => n.id === id);
  const fromFiles = pj.edges.filter((e) => e.from.includes("planted") || e.from.includes("actor-net") || e.from.includes("evil.zip") || e.from.includes("x.json.gz"));
  ok(fromFiles.length >= 5 && fromFiles.every((e) => e.trust === "claimed"), "planted record and zip: every edge claimed " + JSON.stringify(fromFiles.map((e) => e.rel + ":" + e.trust)));
  ok(["urn:sws:cloudtrail-event:planted", "urn:sws:actor-net:203.0.113.0/24", R + "dormant", R + "admin"].every((id) => N(id).trust === "claimed"), "nodes only files name are claimed");
  ok(N("arn:aws:lambda:eu-west-2:" + A + ":function:real-fn").trust === "verified" && pj.backend === "aws" && pj.nodes.every((n) => n.backend === "aws"), "the real function stays verified; backend aws everywhere");
  // A merged edge with an api source is verified, whatever else said it.
  const m = ctx.Graph({ account: A, backend: "twin" });
  m.add.activity({ events: [] }, { bucket: "b1", key: "AWSLogs/" + A + "/CloudTrail/eu-west-2/y.json.gz" });
  m.add.s3([{ name: "b1", region: "eu-west-2", cors: {}, objects: [] }]);
  const rin = JSON.parse(JSON.stringify(m.toJSON())).edges.find((e) => e.from === "urn:sws:region:eu-west-2" && e.rel === "in");
  ok(rin.trust === "verified" && rin.evidence === "api" && /CloudTrail key path/.test(rin.source), "merged edge with an api source is verified " + JSON.stringify(rin));
  // Attributes keep their own trust: an api-verified role with a file-derived last_seen keeps last_seen claimed.
  const a = ctx.Graph({ account: A, backend: "twin" });
  a.add.iam({ roles: [{ name: "r", arn: R + "r", trust: { statements: [] }, lastUsed: { when: "2026-11-01T00:00:00Z", region: "eu-west-2" } }] });
  a.add.activity({ events: [{ node: "urn:sws:cloudtrail-event:e1", words: "w", iso: "2026-11-22T10:00:00Z", from: {}, who: { kind: "role", name: "r", arn: R + "r" }, targets: [] }] }, null);
  const rn = JSON.parse(JSON.stringify(a.toJSON())).nodes.find((n) => n.id === R + "r");
  ok(rn.trust === "verified" && rn.last_used === "2026-11-01T00:00:00Z" && rn.attribute_trust.last_used.trust === "verified" && rn.last_seen === "2026-11-22T10:00:00Z" && rn.attribute_trust.last_seen.trust === "claimed", "role verified; last_used verified; last_seen claimed " + JSON.stringify(rn.attribute_trust));
  // A claimed fact never overwrites a verified one.
  const o = ctx.Graph({ account: A, backend: "twin" });
  o.add.s3([{ name: "b1", region: "eu-west-2", cors: {}, objects: [{ key: "k.zip", size: 10 }] }]);
  o.add.zips([{ bucket: "b1", key: "k.zip", entries: 3 }]);
  const on = JSON.parse(JSON.stringify(o.toJSON())).nodes.find((n) => n.id === "arn:aws:s3:::b1/k.zip");
  ok(on.bytes === 10 && on.attribute_trust.bytes.trust === "verified" && on.entries === 3 && on.attribute_trust.entries.trust === "claimed", "object size verified, zip entry count claimed");
  ok(ctx.Graph.verified({ trust: "verified" }) && !ctx.Graph.verified({ trust: "claimed" }) && ctx.Graph.verified({ evidence: "api" }) && !ctx.Graph.verified({ evidence: "naming" }), "Graph.verified");
  // Curated only when every edge naming a node is curated (no curated adapter yet; none of ours makes curated edges).
  ok(!pj.nodes.some((n) => n.trust === "curated"), "no curated nodes without curated edges");
}

const G = golden, uncovered = G.edges.length - gs.edges.size - G.edges.filter((e) => e.evidence === "curated" || e.evidence === "comment").length;
if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
if (ctx.AwsTwin.pack() !== PACK) { console.error("FAIL the twin loaded pack " + ctx.AwsTwin.pack() + ", not " + PACK); process.exit(1); }
console.log("OK (graph, pack " + PACK + ": " + passed + " checks; " + mine.nodes.length + " nodes, " + mine.edges.length + " edges; golden slice " + gs.nodes.size + " nodes and " + gs.edges.size + " edges equal; " + uncovered + " golden edges wait for the CloudFormation adapter and serves_from" + ")");
