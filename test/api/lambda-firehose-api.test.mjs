// LambdaApi and FirehoseApi (site/api/lambda-api.js, firehose-api.js) and ApiAll (site/api/all.js): over the twin
// through the real transport and SigV4, then paging and errors over a recording send, then their contracts
// (site/api/lambda.openapi.json, firehose.openapi.json): one operation per method, the same arguments, and each
// method's real request needs exactly its listed IAM actions. Node 22, no network.
// Run: node test/api/lambda-firehose-api.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array,
  setTimeout, crypto: globalThis.crypto, console, btoa,
  location: { search: "?twin", origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/lambda-api.js", "api/firehose-api.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { LambdaApi, FirehoseApi, ApiAll, AwsTwin } = ctx;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const rejects = async (p, test, m) => { try { await p; ok(false, m + ": did not reject"); } catch (e) { ok(test(e), m + ": " + e.message); } };
const A = AwsTwin.account, R = "eu-west-2";

const assume = async (role) => {
  const r = await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/" + role, RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() });
  const t = await r.text(), g = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1];
  return { accessKeyId: g("AccessKeyId"), secretAccessKey: g("SecretAccessKey"), sessionToken: g("SessionToken") };
};
const creds = await assume("sws-aws-platform-read"), seen = [];
const send = async (req) => { seen.push(req); return ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body }); };

// ---- Lambda over the twin ----
const lam = LambdaApi(send);
const page = await lam.functions(R);
ok(page.next === null && page.items.map((f) => f.name).join() === "demo-handler,demo-log-enricher,demo-nightly-report", "functions page " + JSON.stringify(page.items.map((f) => f.name)));
const h = page.items[0];
ok(h.arn === "arn:aws:lambda:" + R + ":" + A + ":function:demo-handler" && h.region === R && h.runtime === "python3.12" && h.role === "arn:aws:iam::" + A + ":role/demo-handler-role" && h.memory === 256 && /^[A-Za-z0-9+/]{43}=$/.test(h.codeSha256), "function shape " + JSON.stringify(h));
ok(JSON.stringify(await lam.function(R, "demo-handler")) === JSON.stringify(h), "function() equals the list item");
ok((await lam.function(R, h.arn)).name === "demo-handler", "function() by ARN");
ok(seen[seen.length - 1].url === "https://lambda." + R + ".amazonaws.com/2015-03-31/functions/" + encodeURIComponent(h.arn) + "/configuration", "ARN encoded in the path");
await rejects(lam.function(R, "nope"), (e) => e.code === "ResourceNotFoundException" && e.status === 404, "missing function");

// ---- Firehose over the twin ----
const fh = FirehoseApi(send, { account: A });
const sp = await fh.streams(R);
ok(sp.next === null && sp.items.length === 1 && sp.items[0].name === "demo-cloudfront-logs" && sp.items[0].arnDerived, "streams page " + JSON.stringify(sp));
const st = await fh.stream(R, "demo-cloudfront-logs"), d = st.destinations[0];
ok(st.arn === sp.items[0].arn && st.status === "ACTIVE" && st.type === "DirectPut" && /^2026-11-\d\dT/.test(st.created), "stream shape, derived ARN equals AWS's " + JSON.stringify(st));
ok(d.kind === "s3" && d.bucket === AwsTwin.buckets.logs && d.prefix === "cloudfront/" && d.compression === "GZIP" && d.bufferSeconds === 900 && d.roleArn === "arn:aws:iam::" + A + ":role/demo-cloudfront-logs-firehose", "destination " + JSON.stringify(d));
ok(d.processors.length === 1 && d.processors[0].type === "Lambda" && d.processors[0].lambdaArn === "arn:aws:lambda:" + R + ":" + A + ":function:demo-log-enricher:$LATEST", "processor " + JSON.stringify(d.processors));
ok((await FirehoseApi(send).streams(R)).items[0].arn === null, "no account: no derived ARN");
await rejects(fh.stream(R, "nope"), (e) => e.code === "ResourceNotFoundException" && e.status === 400, "missing stream");
const req = seen[seen.length - 1];
ok(req.service === "firehose" && req.headers["x-amz-target"] === "Firehose_20150804.DescribeDeliveryStream" && req.headers["content-type"] === "application/x-amz-json-1.1", "Firehose request shape");

// ---- paging and ApiAll, over a recording send that pages as AWS does ----
const fns = Array.from({ length: 7 }, (_, i) => ({ FunctionName: "f" + i, FunctionArn: "arn:aws:lambda:" + R + ":" + A + ":function:f" + i }));
const pagedSend = async (rq) => {
  const u = new URL(rq.url), from = +(u.searchParams.get("Marker") || 0), n = +(u.searchParams.get("MaxItems") || 3);
  return new Response(JSON.stringify({ Functions: fns.slice(from, from + n), NextMarker: from + n < fns.length ? String(from + n) : null }), { status: 200 });
};
const pl = LambdaApi(pagedSend);
const all = await ApiAll((next) => pl.functions(R, { next, max: 3 }));
ok(all.items.map((f) => f.name).join() === "f0,f1,f2,f3,f4,f5,f6" && !all.capped, "ApiAll drains every page");
const capped = await LambdaApi.all((next) => pl.functions(R, { next, max: 3 }), { maxPages: 2 });
ok(capped.items.length === 6 && capped.capped, "ApiAll stops at maxPages and says so");
const cappedItems = await ApiAll((next) => pl.functions(R, { next, max: 3 }), { maxItems: 4 });
ok(cappedItems.items.length === 4 && cappedItems.capped, "ApiAll stops at maxItems and says so");
const names = Array.from({ length: 5 }, (_, i) => "s" + i);
const fhPaged = FirehoseApi(async (rq) => {
  const q = JSON.parse(rq.body), from = q.ExclusiveStartDeliveryStreamName ? names.indexOf(q.ExclusiveStartDeliveryStreamName) + 1 : 0, list = names.slice(from, from + q.Limit);
  return new Response(JSON.stringify({ DeliveryStreamNames: list, HasMoreDeliveryStreams: from + q.Limit < names.length }), { status: 200 });
}, { account: A });
ok((await FirehoseApi.all((next) => fhPaged.streams(R, { next, max: 2 }))).items.map((s) => s.name).join() === "s0,s1,s2,s3,s4", "Firehose pages by the last name");
await rejects(LambdaApi(async () => new Response(JSON.stringify({ Type: "User", Message: "slow down" }), { status: 429, headers: { "x-amzn-errortype": "TooManyRequestsException:http://internal.amazon.com/coral/" } })).functions(R),
  (e) => e.code === "TooManyRequestsException" && e.status === 429 && e.message === "TooManyRequestsException: slow down", "Lambda error code from x-amzn-errortype");
await rejects(LambdaApi(async () => Promise.reject(new TypeError("Failed to fetch"))).functions(R), (e) => e instanceof TypeError, "a CORS refusal passes through");

// ---- contracts ----
const action = (rq) => {
  if (rq.service === "lambda") return /\/configuration$/.test(new URL(rq.url).pathname) ? "lambda:GetFunctionConfiguration" : "lambda:ListFunctions";
  return "firehose:" + rq.headers["x-amz-target"].split(".")[1];
};
const deny = async (rq) => { seen.push(rq); return new Response(JSON.stringify({ __type: "AccessDeniedException", message: "no" }), { status: 403, headers: { "x-amzn-errortype": "AccessDeniedException" } }); };
for (const [file, api, samples] of [
  ["lambda.openapi.json", LambdaApi(deny), { functions: [R, {}], function: [R, "demo-handler"] }],
  ["firehose.openapi.json", FirehoseApi(deny, { account: A }), { streams: [R, {}], stream: [R, "demo-cloudfront-logs"] }]
]) {
  const doc = JSON.parse(readFileSync(new URL("../../site/api/" + file, import.meta.url), "utf8"));
  const ops = Object.values(doc.paths).flatMap((p) => Object.values(p));
  ok(doc.openapi === "3.1.0" && doc.servers.length === 0, file + ": OpenAPI 3.1, no server");
  ok(JSON.stringify(ops.map((o) => o.operationId).sort()) === JSON.stringify(Object.keys(api).sort()), file + ": one operation per method");
  for (const o of ops) {
    const args = o["x-arguments"].slice(o["x-arguments"].indexOf("(") + 1, -1).replace(/\{[^}]*\}/g, "x").split(",").filter((x) => x.trim());
    ok(o["x-arguments"].startsWith(o.operationId + "(") && args.length === api[o.operationId].length, file + " " + o.operationId + ": arguments");
    ok(o["x-role"] === "read" && o["x-aws-actions"].length && o["x-aws-actions"].every((a) => /^[a-z0-9-]+:(List|Get|Describe)[A-Za-z]+$/.test(a)), file + " " + o.operationId + ": read actions only");
    seen.length = 0;
    await rejects(api[o.operationId](...samples[o.operationId]), (e) => e.code === "AccessDeniedException" && e.status === 403, file + " " + o.operationId + " denied");
    ok(seen.length === 1 && JSON.stringify(o["x-aws-actions"]) === JSON.stringify([action(seen[0])]), file + " " + o.operationId + ": request needs exactly " + o["x-aws-actions"]);
  }
  const walk = (v) => { if (Array.isArray(v)) return v.every(walk); if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => k === "$ref" ? !!x.replace(/^#\//, "").split("/").reduce((a, p) => a && a[p], doc) : walk(x)); return true; };
  ok(walk(doc), file + ": every $ref resolves");
}

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (lambda and firehose: " + passed + " checks; twin reads, shapes, errors, paging and ApiAll caps, contracts)");
