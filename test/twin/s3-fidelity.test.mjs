// The twin's S3 answers against the wire format AWS documents for ListObjectsV2 and ranged GetObject:
// paging (max-keys, IsTruncated, NextContinuationToken, KeyCount, xmlns), the three Range forms with
// Content-Range, 416 for a range past the end, a dotted bucket by the path form, and data that does not
// depend on call order. Runs in Node 22 (Response, CompressionStream); no network.
import { readFileSync } from "node:fs";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
globalThis.window = globalThis;
globalThis.location = { origin: "http://localhost", search: "" };
new Function(readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8"))();
const T = globalThis.AwsTwin, auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
const get = (url, h) => T.handle(url, { method: "GET", headers: Object.assign({}, auth, h || {}) });
const site = (q) => "https://" + T.buckets.site + ".s3.eu-west-2.amazonaws.com/" + q;
const tag = (x, n) => { const m = new RegExp("<" + n + ">([^<]*)</" + n + ">").exec(x); return m ? m[1] : null; };
const count = (x, n) => (x.match(new RegExp("<" + n + ">", "g")) || []).length;

// the demo site is the one bucket without the page's CORS rule (the plan to show): add it as the page would
const cors = () => T.handle("https://cloudcontrolapi.eu-west-2.amazonaws.com/", { method: "POST", headers: Object.assign({ "x-amz-target": "CloudApiService.UpdateResource" }, auth),
  body: JSON.stringify({ TypeName: "AWS::S3::Bucket", Identifier: T.buckets.site, PatchDocument: JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [{ Id: "sws-aws-platform", AllowedOrigins: ["http://localhost"] }] } }]) }) });
try { await get(site("index.html")); fail("the demo site answered before its CORS rule"); } catch (e) { if (!(e instanceof TypeError)) throw e; }
await cors();

// data first, before any other call: the same bytes as after many calls (latency has its own generator)
const logKey = "cloudfront/2026/11/21/10/demo-distribution-1-2026-11-21-10-00-00.gz";
const first = new Uint8Array(await (await get("https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/" + logKey)).arrayBuffer());
T.reset(); await cors();
for (let i = 0; i < 5; i++) await get(site("?list-type=2&delimiter=%2F"));
const again = new Uint8Array(await (await get("https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/" + logKey)).arrayBuffer());
if (first.length !== again.length || first.some((b, i) => b !== again[i])) fail("log data depends on call order");

// paging
let x = await (await get(site("?list-type=2&prefix=archive%2F2026%2F"))).text();
if (!x.includes('xmlns="http://s3.amazonaws.com/doc/2006-03-01/"')) fail("no xmlns");
if (tag(x, "IsTruncated") !== "true" || tag(x, "KeyCount") !== "1000" || count(x, "Contents") !== 1000) fail("first page: " + tag(x, "KeyCount"));
const token = tag(x, "NextContinuationToken"); if (!token) fail("no NextContinuationToken");
x = await (await get(site("?list-type=2&prefix=archive%2F2026%2F&continuation-token=" + encodeURIComponent(token)))).text();
if (tag(x, "IsTruncated") !== "false" || tag(x, "KeyCount") !== "203" || tag(x, "NextContinuationToken")) fail("second page");
if (tag(x, "ContinuationToken") !== token) fail("ContinuationToken not echoed");
x = await (await get(site("?list-type=2&delimiter=%2F&max-keys=2"))).text();
if (tag(x, "KeyCount") !== "2" || tag(x, "IsTruncated") !== "true" || tag(x, "MaxKeys") !== "2") fail("max-keys with delimiter");
x = await (await get(site("?list-type=2&delimiter=%2F"))).text();
if (!x.includes("<Prefix>archive/</Prefix>") || x.includes("page-0001")) fail("archive/ not folded under the delimiter");
if (!/<ETag>&quot;[0-9a-f]{32}&quot;<\/ETag>/.test(x)) fail("ETag shape");

// ranges
const whole = new Uint8Array(await (await get(site("index.html"))).arrayBuffer()), n = whole.length;
const check = async (range, from, to) => {
  const r = await get(site("index.html"), { range });
  if (r.status !== 206) fail(range + " status " + r.status);
  if (r.headers.get("content-range") !== `bytes ${from}-${to}/${n}`) fail(range + " content-range " + r.headers.get("content-range"));
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length !== to - from + 1 || b[0] !== whole[from]) fail(range + " body");
};
await check("bytes=0-9", 0, 9);
await check("bytes=10-", 10, n - 1);
await check("bytes=-22", n - 22, n - 1);
await check("bytes=5-" + (n + 100), 5, n - 1);
const bad = await get(site("index.html"), { range: "bytes=" + (n + 5) + "-" });
if (bad.status !== 416 || !(await bad.text()).includes("InvalidRange")) fail("range past the end");
const plain = await get(site("index.html"));
if (plain.status !== 200 || !plain.headers.get("etag") || !plain.headers.get("last-modified")) fail("200 headers");

// dotted bucket, path form
const d = await get("https://s3.eu-west-2.amazonaws.com/" + T.buckets.dotted + "/index.html");
if (d.status !== 200 || !(await d.text()).includes("Dotted bucket")) fail("dotted bucket by path");

// CloudTrail: the IAM event is in the us-east-1 file and names a role the twin has
x = await (await get("https://" + T.buckets.trail + ".s3.eu-west-2.amazonaws.com/?list-type=2&prefix=AWSLogs%2F")).text();
const keys = [...x.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]);
const iamFile = keys.find((k) => k.includes("/us-east-1/"));
if (!iamFile || !keys.some((k) => k.includes("/eu-west-2/"))) fail("trail files per region: " + keys.join(" "));
const gz = new Uint8Array(await (await get("https://" + T.buckets.trail + ".s3.eu-west-2.amazonaws.com/" + iamFile)).arrayBuffer());
const rec = JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text()).Records[0];
if (rec.requestParameters.roleName !== "sovereignwebsite-factory-dns" || rec.awsRegion !== "us-east-1" || !rec.eventID || rec.readOnly !== false) fail("trail record");

console.log("OK (twin S3: paging 1000 + 203, ranges a-b, a-, -n and 416, ETag, dotted bucket, trail per region, data independent of call order)");
