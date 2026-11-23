#!/usr/bin/env node
// Builds docs/ontology/twin-graph.json from the twin itself, so the graph never drifts from the data.
// ontology.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Schema and terms: 2026-11-23__01-resource-ontology.md.
//
// It loads site/twin.js as the page does and asks it questions over the same AWS wire formats the page uses
// (Cloud Control, S3 ListObjectsV2 and GetObject, IAM GetRole, CloudFormation DescribeStacks and GetTemplate).
// Nothing leaves this process: the twin answers in memory. No AWS is called and no credential is used; the
// twin only checks that a request carries a twin access key (ASIATWIN...), which is not a secret.
//
//   node docs/ontology/build-twin-graph.mjs                write twin-graph.json (demo pack "baseline")
//   node docs/ontology/build-twin-graph.mjs --pack attack  write twin-graph.attack.json (any pack in twin.js)
//   node docs/ontology/build-twin-graph.mjs --all          every pack, one file each
//   node docs/ontology/build-twin-graph.mjs --check --all  exit 1 if any file differs from the twin
//   node docs/ontology/build-twin-graph.mjs --stdout       print instead of writing
//
// Every edge says how we know it (evidence): api, template, content, naming, comment, or curated.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SITE = join(ROOT, "site");
const argv = process.argv.slice(2);
const args = new Set(argv);
const PACK = argv.includes("--pack") ? argv[argv.indexOf("--pack") + 1] : "baseline";
const OUT = join(HERE, PACK === "baseline" ? "twin-graph.json" : "twin-graph." + PACK + ".json");
if (args.has("--all")) {
  // The twin picks its pack when it loads, so each pack runs in its own process.
  const packs = Object.keys(JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--list-packs"]).toString()));
  let failed = false;
  for (const p of packs) {
    try { process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--pack", p, ...argv.filter((a) => a !== "--all")], { stdio: ["ignore", "pipe", "pipe"] }).toString()); }
    catch (e) { process.stderr.write(String(e.stderr || e.message)); failed = true; }
  }
  process.exit(failed ? 1 : 0);
}

// ---- load the twin as the browser would ----
const twinSrc = readFileSync(join(SITE, "twin.js"), "utf8");
globalThis.window = globalThis;
globalThis.location = new URL("https://twin.local/?pack=" + encodeURIComponent(PACK));
globalThis.document = { baseURI: "https://twin.local/" };
globalThis.fetch = (u) => {
  const url = new URL(u);
  if (url.host !== "twin.local") return Promise.reject(new Error("no network: " + url.host)); // the twin only fetches its own template
  return Promise.resolve(new Response(readFileSync(join(SITE, url.pathname.slice(1)))));
};
(0, eval)(twinSrc);
const twin = globalThis.AwsTwin;
if (args.has("--list-packs")) { process.stdout.write(JSON.stringify(twin.packs)); process.exit(0); }
if (twin.pack() !== PACK) { console.error("no such demo pack in site/twin.js: " + PACK + " (have: " + Object.keys(twin.packs).join(", ") + ")"); process.exit(2); }
const ACCOUNT = twin.account;

const AUTH = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261123/eu-west-2/svc/aws4_request" };
async function call(url, init = {}) {
  const r = await twin.handle(url, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
}
const text = (b) => new TextDecoder().decode(b);
const form = (o) => new URLSearchParams(o).toString();
const tag = (xml, name) => [...xml.matchAll(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "g"))].map((m) => m[1]);
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// ---- the graph ----
const nodes = new Map(), edges = new Map();
function node(id, type, altitude, label, extra = {}) {
  const n = nodes.get(id) || { id, type, label, altitude };
  Object.assign(n, extra);
  nodes.set(id, n);
  return id;
}
function edge(from, rel, to, evidence, source) {
  const k = from + "\u0000" + rel + "\u0000" + to;
  // The same link from two sources keeps the stronger evidence (an API answer beats a template, and so on).
  const RANK = ["api", "template", "content", "naming", "comment", "curated"];
  const old = edges.get(k);
  if (!old || RANK.indexOf(evidence) < RANK.indexOf(old.evidence)) edges.set(k, { from, rel, to, evidence, source });
  return k;
}
const ids = {
  account: "twin:account/" + ACCOUNT,
  region: (r) => "twin:region/" + r,
  bucket: (b) => "arn:aws:s3:::" + b,
  object: (b, k) => "arn:aws:s3:::" + b + "/" + k,
  prefix: (b, p) => "arn:aws:s3:::" + b + "/" + p + "*",
  role: (n) => "arn:aws:iam::" + ACCOUNT + ":role/" + n,
  vault: (v) => "twin:vault/" + v,
  site: "twin:site/demo",
};
node(ids.account, "account", "A2", ACCOUNT, { note: "the example account AWS uses in its own documentation; synthetic" });
function region(r, evidence, source) { node(ids.region(r), "region", "A2", r); edge(ids.region(r), "in", ids.account, evidence, source); return ids.region(r); }

// ---- S3: buckets (Cloud Control), objects (ListObjectsV2) ----
const CC = "https://cloudcontrolapi.eu-west-2.amazonaws.com/";
const cc = async (target, body) => JSON.parse(text((await call(CC, { method: "POST", headers: { "x-amz-target": "CloudApiService." + target }, body: JSON.stringify(body) })).bytes));
const buckets = (await cc("ListResources", { TypeName: "AWS::S3::Bucket" })).ResourceDescriptions.map((d) => d.Identifier).sort();
const GROUP = 50; // a folder with more keys than this is one node, so the graph stays readable
const objectsOf = {};
for (const b of buckets) {
  const props = JSON.parse((await cc("GetResource", { TypeName: "AWS::S3::Bucket", Identifier: b })).ResourceDescription.Properties);
  const r = /\.s3\.([a-z0-9-]+)\.amazonaws\.com$/.exec(props.RegionalDomainName)[1];
  node(ids.bucket(b), "bucket", "A2", b, { cfn_type: "AWS::S3::Bucket", browser_readable: !!props.CorsConfiguration });
  if (!props.CorsConfiguration) {
    // No CORS rule: a browser cannot read it until one is added. The page offers that fix; do the same here,
    // in the twin's memory only, so the graph can see inside the bucket.
    const rule = { CorsRules: [{ AllowedOrigins: ["https://twin.local"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"] }] };
    await cc("UpdateResource", { TypeName: "AWS::S3::Bucket", Identifier: b, PatchDocument: JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: rule }]) });
  }
  edge(ids.bucket(b), "in", region(r, "api", "Cloud Control GetResource"), "api", "Cloud Control GetResource (RegionalDomainName)");
  const keys = [];
  let token = null;
  do {
    const base = b.includes(".") ? "https://s3.eu-west-2.amazonaws.com/" + b + "/" : "https://" + b + ".s3.eu-west-2.amazonaws.com/";
    const xml = text((await call(base + "?list-type=2" + (token ? "&continuation-token=" + token : ""))).bytes);
    tag(xml, "Contents").forEach((c) => keys.push({ key: unesc(tag(c, "Key")[0]), size: +tag(c, "Size")[0], modified: tag(c, "LastModified")[0] }));
    token = tag(xml, "IsTruncated")[0] === "true" ? tag(xml, "NextContinuationToken")[0] : null;
  } while (token);
  objectsOf[b] = keys;
  const byFolder = {};
  keys.forEach((o) => { const f = o.key.includes("/") ? o.key.slice(0, o.key.lastIndexOf("/") + 1) : ""; (byFolder[f] = byFolder[f] || []).push(o); });
  for (const [f, list] of Object.entries(byFolder)) {
    if (f && list.length > GROUP) {
      node(ids.prefix(b, f), "prefix", "A1", f + " (" + list.length + " objects)", { objects: list.length, bytes: list.reduce((s, o) => s + o.size, 0) });
      edge(ids.bucket(b), "holds", ids.prefix(b, f), "api", "S3 ListObjectsV2");
    } else list.forEach((o) => {
      node(ids.object(b, o.key), "object", "A1", o.key, { bytes: o.size, modified: o.modified });
      edge(ids.bucket(b), "holds", ids.object(b, o.key), "api", "S3 ListObjectsV2");
    });
  }
}
async function get(b, k) {
  const base = b.includes(".") ? "https://s3.eu-west-2.amazonaws.com/" + b + "/" : "https://" + b + ".s3.eu-west-2.amazonaws.com/";
  return (await call(base + k.split("/").map(encodeURIComponent).join("/"))).bytes;
}
const B = twin.buckets;

// ---- what the files say (content) ----
// config/site.yaml names its log destination
const yaml = text(await get(B.site, "config/site.yaml"));
const logsTo = /^logs:\s*s3:\/\/([^/\s]+)/m.exec(yaml);
if (logsTo) edge(ids.object(B.site, "config/site.yaml"), "refers_to", ids.bucket(logsTo[1]), "content", "config/site.yaml (logs: s3://...)");
// data/vaults.json lists the vaults
const vaults = JSON.parse(text(await get(B.site, "data/vaults.json"))).vaults;
node(ids.site, "site", "A3", "Demo site", { title: /<title>([^<]*)<\/title>/.exec(text(await get(B.site, "index.html")))?.[1] });
for (const v of vaults) {
  node(ids.vault(v.id), "vault", "A5", v.id, { files: v.files });
  edge(ids.object(B.site, "data/vaults.json"), "refers_to", ids.vault(v.id), "content", "data/vaults.json");
  edge(ids.vault(v.id), "in", region(v.region, "content", "data/vaults.json (region)"), "content", "data/vaults.json (region)");
  edge(ids.vault(v.id), "part_of", ids.site, "content", "data/vaults.json in the site's bucket");
}

// CloudFront logs: the key names the distribution; the lines name the paths and visitors
const DIST = (name) => "twin:cloudfront/distribution/" + name;
const vaultPath = /^\/vault\/([^/]+)\/files/;
const visitors = new Set();
const perVault = {}; // vault -> requests for its paths
const countries = {}; // country -> requests (a field the stream's processor adds to each line)
const byIp = {}; // address -> { requests, refused, agents, files, vaults, first, last, paths }
let requests = 0;
for (const o of objectsOf[B.logs]) {
  const m = /\/([a-z0-9-]+)-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.gz$/.exec(o.key);
  const lines = text(gunzipSync(await get(B.logs, o.key))).trim().split("\n").map((l) => JSON.parse(l));
  requests += lines.length;
  lines.forEach((l) => {
    visitors.add(l.c_ip);
    const a = (byIp[l.c_ip] = byIp[l.c_ip] || { requests: 0, refused: 0, agents: new Set(), files: new Set(), vaults: new Set(), paths: new Set(), first: l.timestamp, last: l.timestamp });
    a.requests++; if (l.sc_status >= 400) a.refused++;
    a.agents.add(l.cs_user_agent); a.files.add(o.key); a.paths.add(l.cs_uri_stem);
    const v = /^\/vault\/([^/?]+)/.exec(l.cs_uri_stem)?.[1]; if (v) a.vaults.add(v);
    // Prefer the vault_id the processor wrote into the line; fall back to the path for lines without it.
    const vid = "vault_id" in l ? l.vault_id : v; if (vid) perVault[vid] = (perVault[vid] || 0) + 1;
    if (l.country) countries[l.country] = (countries[l.country] || 0) + 1;
    if (l.timestamp < a.first) a.first = l.timestamp; if (l.timestamp > a.last) a.last = l.timestamp;
  });
  const times = lines.map((l) => l.timestamp).sort();
  Object.assign(nodes.get(ids.object(B.logs, o.key)), { requests: lines.length, first: times[0], last: times[times.length - 1], ocsf_class: "HTTP Activity" });
  if (m) {
    node(DIST(m[1]), "distribution", "A2", m[1], { cfn_type: "AWS::CloudFront::Distribution", inferred: true, note: "no CloudFront API in the twin; named by its log files" });
    edge(ids.object(B.logs, o.key), "records", DIST(m[1]), "naming", "log object key names " + m[1]);
  }
  const seen = new Set(lines.map((l) => vaultPath.exec(l.cs_uri_stem)?.[1]).filter((v) => v && nodes.has(ids.vault(v))));
  [...seen].sort().forEach((v) => edge(ids.object(B.logs, o.key), "refers_to", ids.vault(v), "content", "log lines (cs_uri_stem /vault/" + v + "/files)"));
}
Object.assign(nodes.get(ids.bucket(B.logs)), { requests, visitors: visitors.size },
  Object.keys(countries).length ? { countries: Object.fromEntries(Object.entries(countries).sort()) } : {});
for (const [v, n] of Object.entries(perVault)) if (nodes.has(ids.vault(v))) Object.assign(nodes.get(ids.vault(v)), { requests: n, share_of_requests: +(n / requests).toFixed(3) });
// An address stands out as an actor when most of what it asks for is refused (4xx): a rule on the data, no list
// of known bad addresses. Normal visitors stay a count on the bucket, not a node each.
for (const [ip, a] of Object.entries(byIp).sort()) {
  if (a.requests < 10 || a.refused / a.requests < 0.8) continue;
  const aid = "twin:actor/ip/" + ip;
  node(aid, "actor", "A4", ip + " (refused " + a.refused + " of " + a.requests + ")", {
    ocsf_class: "HTTP Activity", src_ip: ip, requests: a.requests, refused: a.refused, first: a.first, last: a.last,
    user_agents: [...a.agents].sort(), distinct_paths: a.paths.size, rule: "at least 10 requests, at least 80% refused (4xx)" });
  [...a.files].sort().forEach((f) => edge(aid, "seen_in", ids.object(B.logs, f), "content", "log lines (c_ip " + ip + ")"));
  [...a.vaults].sort().filter((v) => nodes.has(ids.vault(v))).forEach((v) => edge(aid, "targeted", ids.vault(v), "content", "log lines (c_ip " + ip + ", paths under /vault/" + v + ")"));
}
for (const d of [...nodes.values()].filter((n) => n.type === "distribution"))
  if (/Served from S3 through CloudFront/.test(text(await get(B.site, "index.html")))) edge(d.id, "serves_from", ids.bucket(B.site), "content", "index.html ('Served from S3 through CloudFront')");

// ---- Lambda and Firehose (read APIs) ----
const runsAs = new Map(); // role name -> what names it, for the IAM step below
const LAMBDA = "https://lambda.eu-west-2.amazonaws.com/2015-03-31/functions/";
const functions = JSON.parse(text((await call(LAMBDA)).bytes)).Functions || [];
for (const f of functions) {
  const r = /^arn:aws:lambda:([a-z0-9-]+):/.exec(f.FunctionArn)[1];
  node(f.FunctionArn, "function", "A2", f.FunctionName, { cfn_type: "AWS::Lambda::Function", runtime: f.Runtime, handler: f.Handler, memory: f.MemorySize, timeout: f.Timeout, code_bytes: f.CodeSize, code_sha256: f.CodeSha256, modified: f.LastModified, description: f.Description });
  edge(f.FunctionArn, "in", region(r, "api", "Lambda ListFunctions (FunctionArn)"), "api", "Lambda ListFunctions (FunctionArn)");
  if (f.Role) { const rn = f.Role.split(":role/")[1]; node(ids.role(rn), "role", "A4", rn, { cfn_type: "AWS::IAM::Role" }); edge(f.FunctionArn, "runs_as", ids.role(rn), "api", "Lambda ListFunctions (Role)"); runsAs.set(rn, "Lambda ListFunctions (" + f.FunctionName + ")"); }
}
const FH = "https://firehose.eu-west-2.amazonaws.com/";
const fh = async (target, body) => JSON.parse(text((await call(FH, { method: "POST", headers: { "x-amz-target": "Firehose_20150804." + target }, body: JSON.stringify(body) })).bytes));
for (const name of (await fh("ListDeliveryStreams", {})).DeliveryStreamNames || []) {
  const d = (await fh("DescribeDeliveryStream", { DeliveryStreamName: name })).DeliveryStreamDescription;
  const r = /^arn:aws:firehose:([a-z0-9-]+):/.exec(d.DeliveryStreamARN)[1];
  node(d.DeliveryStreamARN, "stream", "A2", name, { cfn_type: "AWS::KinesisFirehose::DeliveryStream", status: d.DeliveryStreamStatus, stream_type: d.DeliveryStreamType });
  edge(d.DeliveryStreamARN, "in", region(r, "api", "Firehose DescribeDeliveryStream (ARN)"), "api", "Firehose DescribeDeliveryStream (ARN)");
  for (const dest of d.Destinations || []) {
    const s3d = dest.ExtendedS3DestinationDescription || dest.S3DestinationDescription; if (!s3d) continue;
    const bucket = s3d.BucketARN.replace("arn:aws:s3:::", "");
    Object.assign(nodes.get(d.DeliveryStreamARN), { s3_prefix: s3d.Prefix, compression: s3d.CompressionFormat, buffer_seconds: s3d.BufferingHints?.IntervalInSeconds });
    edge(d.DeliveryStreamARN, "writes_to", ids.bucket(bucket), "api", "Firehose DescribeDeliveryStream (BucketARN)");
    if (s3d.RoleARN) { const rn = s3d.RoleARN.split(":role/")[1]; node(ids.role(rn), "role", "A4", rn, { cfn_type: "AWS::IAM::Role" }); edge(d.DeliveryStreamARN, "runs_as", ids.role(rn), "api", "Firehose DescribeDeliveryStream (RoleARN)"); runsAs.set(rn, "Firehose DescribeDeliveryStream (" + name + ")"); }
    for (const pr of s3d.ProcessingConfiguration?.Enabled ? s3d.ProcessingConfiguration.Processors || [] : []) {
      const arn = (pr.Parameters || []).find((x) => x.ParameterName === "LambdaArn")?.ParameterValue?.replace(/:\$LATEST$/, "");
      if (arn) edge(d.DeliveryStreamARN, "transforms_with", arn, "api", "Firehose DescribeDeliveryStream (ProcessingConfiguration)");
    }
    // The distribution's log files sit under this stream's prefix in this bucket: the stream carries its logs.
    if (nodes.has(ids.bucket(bucket))) for (const dist of [...nodes.values()].filter((n) => n.type === "distribution"))
      if ((objectsOf[bucket] || []).some((o) => o.key.startsWith(s3d.Prefix || "") && o.key.includes("/" + dist.label + "-")))
        edge(dist.id, "logs_to", d.DeliveryStreamARN, "naming", "log files named after " + dist.label + " sit under the stream's prefix " + (s3d.Prefix || "(none)"));
  }
}

// Lambda dependency zips: the central directory names the package; METADATA names it; config.json its region
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22; while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = {};
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = text(buf.subarray(p + 46, p + 46 + nlen));
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), data = buf.subarray(start, start + csize);
    out[name] = text(method === 8 ? inflateRawSync(data) : data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
for (const o of objectsOf[B.deps].filter((o) => o.key.endsWith(".zip"))) {
  const buf = await get(B.deps, o.key);
  const files = unzip(buf);
  Object.assign(nodes.get(ids.object(B.deps, o.key)), { entries: Object.keys(files).length });
  // A function whose CodeSha256 is this zip's SHA-256 runs this code: AWS's own identity for a deployment package.
  const sha = createHash("sha256").update(buf).digest("base64");
  const f = functions.find((x) => x.CodeSha256 === sha);
  if (f) { edge(ids.object(B.deps, o.key), "packages", f.FunctionArn, "api", "Lambda CodeSha256 equals the zip's SHA-256"); continue; }
  const meta = Object.entries(files).find(([n]) => n.endsWith(".dist-info/METADATA"));
  const name = meta && /^Name:\s*(.+)$/m.exec(meta[1])[1].trim();
  const byName = name && functions.find((x) => x.FunctionName === name);
  if (byName) edge(ids.object(B.deps, o.key), "packages", byName.FunctionArn, "naming", "zip name and dist-info METADATA (Name: " + name + "); CodeSha256 differs");
}

// ---- stack and its template ----
const CFN = "https://cloudformation.eu-west-2.amazonaws.com/";
const stacks = tag(text((await call(CFN, { method: "POST", body: form({ Action: "DescribeStacks" }) })).bytes), "member").map((m) => ({ name: tag(m, "StackName")[0], status: tag(m, "StackStatus")[0] }));
const tmpl = unesc(tag(text((await call(CFN, { method: "POST", body: form({ Action: "GetTemplate" }) })).bytes), "TemplateBody")[0] || "");
const STACK = (n) => "arn:aws:cloudformation:eu-west-2:" + ACCOUNT + ":stack/" + n;
const GOOGLE = "twin:idp/accounts.google.com";
for (const s of stacks) {
  node(STACK(s.name), "stack", "A2", s.name, { cfn_type: "AWS::CloudFormation::Stack", status: s.status, note: "a real stack ARN ends in a stack id; the twin has none" });
  edge(STACK(s.name), "in", region("eu-west-2", "api", "CloudFormation DescribeStacks (endpoint region)"), "api", "CloudFormation DescribeStacks (endpoint region)");
  // Resources of type AWS::IAM::Role: RoleName, Federated principal, ManagedPolicyArns. A small reader for this template's shape.
  const res = tmpl.split(/\n(?=  [A-Za-z0-9]+:\n)/).filter((blk) => /\n    Type: AWS::IAM::Role/.test(blk));
  for (const blk of res) {
    const rn = /RoleName:\s*(\S+)/.exec(blk)?.[1]; if (!rn) continue;
    const rid = node(ids.role(rn), "role", "A4", rn, { cfn_type: "AWS::IAM::Role", logical_id: /^\s*([A-Za-z0-9]+):/.exec(blk)[1] });
    edge(rid, "made_by", STACK(s.name), "template", "the stack's template (GetTemplate), " + nodes.get(rid).logical_id);
    edge(rid, "in", ids.account, "template", "the stack's template (GetTemplate)");
    if (/Federated:\s*accounts\.google\.com/.test(blk)) {
      node(GOOGLE, "identity_provider", "A4", "accounts.google.com", { note: "web identity federation; no IAM resource" });
      edge(rid, "trusts", GOOGLE, "template", "the stack's template (Principal Federated accounts.google.com)");
    }
    const mp = /ManagedPolicyArns:\n((?:\s+- \S+\n?)+)/.exec(blk);
    (mp ? mp[1].match(/arn:aws:iam::aws:policy\/\S+/g) : []).forEach((arn) => {
      node(arn, "policy", "A2", arn.split("/").pop(), { cfn_type: "AWS::IAM::ManagedPolicy", aws_managed: true });
      edge(rid, "has_policy", arn, "template", "the stack's template (ManagedPolicyArns)");
    });
  }
}

// ---- CloudTrail: the files hold records; records name who acted and on what ----
const TRAIL = (n) => "twin:cloudtrail/trail/" + n;
const tm = /^aws-cloudtrail-logs-\d{12}-(.+)$/.exec(B.trail);
if (tm) {
  node(TRAIL(tm[1]), "trail", "A2", tm[1], { cfn_type: "AWS::CloudTrail::Trail", inferred: true, note: "no CloudTrail API in the twin; named by its bucket" });
  edge(TRAIL(tm[1]), "logs_to", ids.bucket(B.trail), "naming", "bucket name aws-cloudtrail-logs-<account>-" + tm[1]);
}
const roleNames = new Set([...nodes.values()].filter((n) => n.type === "role").map((n) => n.label));
const events = [];
for (const o of objectsOf[B.trail]) {
  const rr = /\/CloudTrail\/([a-z0-9-]+)\//.exec(o.key);
  if (rr) edge(ids.object(B.trail, o.key), "in", region(rr[1], "content", "CloudTrail key path"), "content", "CloudTrail key path (AWSLogs/<account>/CloudTrail/<region>/)");
  for (const r of JSON.parse(text(gunzipSync(await get(B.trail, o.key)))).Records) {
    const eid = "twin:event/cloudtrail/" + r.eventID;
    const target = r.requestParameters?.key ? r.requestParameters.key : r.requestParameters?.roleName || "";
    node(eid, "event", "A1", r.eventSource.split(".")[0] + " " + r.eventName + (target ? " " + target : ""), { ocsf_class: "API Activity", time: r.eventTime, src_ip: r.sourceIPAddress, read_only: r.readOnly });
    edge(ids.object(B.trail, o.key), "records", eid, "content", "CloudTrail Records");
    const issuer = r.userIdentity?.sessionContext?.sessionIssuer;
    if (issuer?.type === "Role") { roleNames.add(issuer.userName); edge(eid, "acted_as", ids.role(issuer.userName), "content", "CloudTrail userIdentity.sessionContext.sessionIssuer"); }
    const fed = r.userIdentity?.sessionContext?.webIdFederationData?.federatedProvider;
    if (fed === "accounts.google.com") edge(eid, "signed_in_via", GOOGLE, "content", "CloudTrail webIdFederationData.federatedProvider");
    const p = r.requestParameters || {};
    if (p.bucketName && p.key) edge(eid, "acted_on", ids.object(p.bucketName, p.key), "content", "CloudTrail requestParameters (bucketName, key)");
    if (p.roleName) { roleNames.add(p.roleName); edge(eid, "acted_on", ids.role(p.roleName), "content", "CloudTrail requestParameters.roleName"); }
    events.push(eid);
  }
}

// ---- IAM: every role named anywhere above, asked for by name (the twin has no ListRoles) ----
const IAM = "https://iam.amazonaws.com/";
const GH = "token.actions.githubusercontent.com";
for (const rn of [...roleNames].sort()) {
  const r = await call(IAM, { method: "POST", body: form({ Action: "GetRole", RoleName: rn }) });
  const rid = ids.role(rn);
  if (r.status === 404) {
    // Named somewhere but not in IAM: the platform roles live only in the template until the stack is applied.
    const by = runsAs.get(rn) || (nodes.get(rid)?.logical_id ? "the stack's template" : "the data");
    node(rid, "role", "A4", rn, { dangling: true, note: "named by " + by + "; IAM GetRole says NoSuchEntity" });
    continue;
  }
  node(rid, "role", "A4", rn, { cfn_type: "AWS::IAM::Role" });
  edge(rid, "in", ids.account, "api", "IAM GetRole");
  const doc = JSON.parse(decodeURIComponent(tag(text(r.bytes), "AssumeRolePolicyDocument")[0]));
  for (const st of doc.Statement) {
    const fed = st.Principal?.Federated;
    if (fed === "accounts.google.com") {
      node(GOOGLE, "identity_provider", "A4", "accounts.google.com", { note: "web identity federation; no IAM resource" });
      edge(rid, "trusts", GOOGLE, "api", "IAM GetRole (trust policy Principal Federated accounts.google.com)");
    }
    if (fed && fed.endsWith("oidc-provider/" + GH)) {
      node(fed, "identity_provider", "A4", GH, { cfn_type: "AWS::IAM::OIDCProvider" });
      edge(rid, "trusts", fed, "api", "IAM GetRole (trust policy Principal)");
      const subs = [].concat(st.Condition?.StringEquals?.[GH + ":sub"] || st.Condition?.StringLike?.[GH + ":sub"] || []);
      for (const sub of subs) {
        // repo:<owner>@<id>/<repo>@<id>:environment:<env>  (GitHub's immutable-id form)
        const m = /^repo:([^@/]+)(?:@\d+)?\/([^@:]+)(?:@\d+)?:(.+)$/.exec(sub);
        if (!m) continue;
        const pid = "twin:github/" + m[1] + "/" + m[2] + ":" + m[3];
        node(pid, "external_principal", "A4", m[2] + " (" + m[3].replace(":", " ") + ")", { subject: sub });
        edge(rid, "allows_subject", pid, "api", "IAM GetRole (trust policy condition " + GH + ":sub)");
      }
    }
  }
}

// ---- curated: what no file says on its own, asserted by the ontologist and marked so ----
const VRF = "twin:function/visitor-reads-vault-files";
node(VRF, "business_function", "A5", "A visitor reads a vault's files");
edge(VRF, "part_of", ids.site, "curated", "ontology rule: the demo site serves the vaults' files");
for (const n of [...nodes.values()].filter((n) => n.type === "vault")) edge(VRF, "refers_to", n.id, "curated", "ontology rule: the function is about each vault");
const streamsToLogs = [...edges.values()].filter((e) => e.rel === "writes_to" && e.to === ids.bucket(B.logs)).map((e) => e.from);
for (const id of [ids.bucket(B.site), ids.bucket(B.logs), ...streamsToLogs, ...[...nodes.values()].filter((n) => n.type === "distribution").map((n) => n.id)])
  if (nodes.has(id)) edge(id, "part_of", ids.site, "curated", "ontology rule: the demo site's serving and logging path");

// ---- write ----
const nodeList = [...nodes.values()].sort((a, b) => (a.type + a.id < b.type + b.id ? -1 : 1));
const edgeList = [...edges.values()].sort((a, b) => (a.from + a.rel + a.to < b.from + b.rel + b.to ? -1 : 1));
for (const e of edgeList) for (const end of [e.from, e.to]) if (!nodes.has(end)) {
  // An edge to something not seen: keep it, and say so on a stub node.
  node(end, "unknown", "A2", end, { dangling: true, note: "named by an edge; not found in the twin" }); nodeList.push(nodes.get(end));
}
const counts = { nodes: nodeList.length, edges: edgeList.length, by_evidence: {} };
edgeList.forEach((e) => { counts.by_evidence[e.evidence] = (counts.by_evidence[e.evidence] || 0) + 1; });
const graph = {
  about: "The twin's synthetic account " + ACCOUNT + " as a graph, demo pack '" + twin.pack() + "'. Generated by docs/ontology/build-twin-graph.mjs from site/twin.js and the stack's template as the twin serves it; do not edit by hand. All data synthetic. Schema and terms: 2026-11-23__01-resource-ontology.md.",
  evidence_levels: ["api", "template", "content", "naming", "comment", "curated"],
  counts, nodes: nodeList, edges: edgeList,
};
const out = JSON.stringify(graph, null, 1) + "\n";
if (args.has("--stdout")) process.stdout.write(out);
else if (args.has("--check")) {
  let cur = ""; try { cur = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (cur !== out) { console.error(OUT.slice(HERE.length + 1) + " is out of date with the twin: run node docs/ontology/build-twin-graph.mjs --all"); process.exit(1); }
  console.log(OUT.slice(HERE.length + 1) + " matches the twin (" + counts.nodes + " nodes, " + counts.edges + " edges)");
} else { writeFileSync(OUT, out); console.log("wrote " + OUT.slice(ROOT.length + 1) + ": " + counts.nodes + " nodes, " + counts.edges + " edges " + JSON.stringify(counts.by_evidence)); }
