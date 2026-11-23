// S3Api against the twin, in Node, with no network: the real transport (twin mode), the real SigV4 signing,
// the real twin (site/twin.js). Design 01, docs/architecture/: contract tests run S3Api over the twin so the
// parsing, ranges and error paths run for real. Run: node test/api/s3-api.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array,
  setTimeout, crypto: globalThis.crypto, console,
  location: { search: "?twin", origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); } // twin mode must never call the network
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/s3-api.js"]) {
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
}
const { SigV4, AwsTransport, AwsTwin, S3Api } = ctx;

let failures = 0, passed = 0;
const fail = (m) => { failures++; console.error("FAIL", m); };
const ok = (cond, m) => { if (cond) passed++; else fail(m); };
const dec = (u) => new TextDecoder().decode(u);

if (!AwsTransport.isTwin()) { console.error("FAIL transport is not in twin mode"); process.exit(1); }

// What the page does above the seam: assume a role on STS (the twin's), sign, send through the transport.
async function assume(role) {
  const body = new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15",
    RoleArn: "arn:aws:iam::" + AwsTwin.account + ":role/" + role, RoleSessionName: "test", WebIdentityToken: "twin" }).toString();
  const t = await (await AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body })).text();
  const v = (tag) => new RegExp("<" + tag + ">([^<]*)</" + tag + ">").exec(t)[1];
  return { accessKeyId: v("AccessKeyId"), secretAccessKey: v("SecretAccessKey"), sessionToken: v("SessionToken") };
}
const sender = (creds, seen) => async (req) => {
  if (seen) seen.push(req);
  const h = await SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service);
  return AwsTransport.fetch(req.url, { method: req.method, headers: h, body: req.body });
};
const readCreds = await assume("sws-aws-platform-read");
const seen = [];
const api = S3Api(sender(readCreds, seen));
const B = AwsTwin.buckets;

// Buckets: every bucket in the twin, sorted, through Cloud Control from us-east-1.
const names = await api.listBuckets();
ok(JSON.stringify(names) === JSON.stringify(Object.values(B).sort()), "listBuckets " + JSON.stringify(names));
ok(seen[0].service === "cloudcontrolapi" && seen[0].region === "us-east-1" && seen[0].headers["x-amz-target"] === "CloudApiService.ListResources", "ListResources request shape");

// A bucket: region from RegionalDomainName; no CORS yet.
const site = await api.getBucket(B.site);
ok(site.name === B.site && site.region === "eu-west-2" && site.cors === null, "getBucket " + JSON.stringify(site));

// No CORS rule: the browser's failure passes through unchanged, so the page can offer the CORS plan.
try { await api.listObjects(B.site, site.region); fail("listObjects without CORS should fail"); }
catch (e) { ok(e instanceof TypeError && /Failed to fetch/.test(e.message), "CORS failure passes through: " + e); }

const sortKeys = (v) => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);
// A bucket seeded with the site's full rule: S3's XML (ID, ExposeHeader, MaxAgeSeconds) reads back as Cloud Control's shape.
const logsRegion = (await api.getBucket(B.logs)).region;
const seededCors = await api.getBucketCors(B.logs, logsRegion);
ok(sortKeys(seededCors) === sortKeys((await api.getBucket(B.logs)).cors) && seededCors.CorsRules[0].Id === "sws-aws-platform" && seededCors.CorsRules[0].MaxAge === 3000,
  "getBucketCors full seeded rule " + JSON.stringify(seededCors));

// Give the twin's buckets a CORS rule (what Approve does on the plan), with the change role, outside S3Api.
const change = sender(await assume("sws-aws-platform-change"));
for (const b of Object.values(B)) {
  const patch = JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [{ AllowedMethods: ["GET", "HEAD"], AllowedOrigins: ["https://example.test"] }] } }]);
  const r = await change({ service: "cloudcontrolapi", region: "eu-west-2", method: "POST", url: "https://cloudcontrolapi.eu-west-2.amazonaws.com/",
    headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": "CloudApiService.UpdateResource" },
    body: JSON.stringify({ TypeName: "AWS::S3::Bucket", Identifier: b, PatchDocument: patch }) });
  ok(r.ok, "CORS set on " + b);
}
ok((await api.getBucket(B.site)).cors.CorsRules[0].AllowedMethods.join() === "GET,HEAD", "getBucket shows CORS");

// getBucketCors: S3 GetBucketCors, for a bucket already reachable; the same rules getBucket shows.
const corsS3 = await api.getBucketCors(B.site, "eu-west-2");
ok(sortKeys(corsS3) === sortKeys((await api.getBucket(B.site)).cors), "getBucketCors matches getBucket " + JSON.stringify(corsS3));
const creq = seen[seen.length - 2];
ok(creq.service === "s3" && creq.method === "GET" && /^https:\/\/[^/]+\.s3\.eu-west-2\.amazonaws\.com\/\?cors$/.test(creq.url), "GetBucketCors url " + creq.url);
const creqTail = seen[seen.length - 1];
ok(creqTail.headers["x-amz-target"] === "CloudApiService.GetResource", "getBucket came after GetBucketCors");

// Folders and files at the root and under a prefix.
const root = await api.listObjects(B.site, "eu-west-2");
ok(JSON.stringify(root.folders) === JSON.stringify(["archive/", "assets/", "config/", "data/"]), "root folders " + JSON.stringify(root.folders));
ok(root.files.length === 1 && root.files[0].key === "index.html" && root.files[0].size > 100 && root.files[0].modified === "2026-11-20T09:00:00.000Z", "root files " + JSON.stringify(root.files));
ok(root.next === null, "no next page");
const req = seen[seen.length - 1];
ok(req.service === "s3" && req.region === "eu-west-2" && req.method === "GET" && /list-type=2&delimiter=%2F&max-keys=1000$/.test(req.url), "ListObjectsV2 url " + req.url);
const logs = await api.listObjects(B.logs, "eu-west-2", { prefix: "cloudfront/2026/11/" });
ok(JSON.stringify(logs.folders) === JSON.stringify(["cloudfront/2026/11/20/", "cloudfront/2026/11/21/", "cloudfront/2026/11/22/"]), "prefix folders " + JSON.stringify(logs.folders));
const flat = await api.listObjects(B.logs, "eu-west-2", { prefix: "cloudfront/", delimiter: "" });
ok(flat.folders.length === 0 && flat.files.length === 9 && flat.files.every((f) => f.key.endsWith(".gz")), "no delimiter lists every key: " + flat.files.length);

// Whole objects and byte ranges.
const html = await api.getObject(B.site, "eu-west-2", "index.html");
ok(html.status === 200 && html.contentType === "text/html" && dec(html.bytes).includes("<h1>Demo site</h1>"), "getObject index.html");
const part = await api.getObject(B.site, "eu-west-2", "index.html", [0, 14]);
ok(part.status === 206 && dec(part.bytes) === "<!doctype html>", "getObject range: " + JSON.stringify(dec(part.bytes)));
const zipKey = "lambdas-dependencies/demo-handler==v1.0.0.zip";
const zip = await api.getObject(B.deps, "eu-west-2", zipKey);
const tail = await api.getObject(B.deps, "eu-west-2", zipKey, [zip.bytes.length - 22, zip.bytes.length - 1]);
ok(new DataView(tail.bytes.buffer).getUint32(0, true) === 0x06054b50, "zip end record by range (key with '=' and '/')");
const gz = await api.getObject(B.logs, "eu-west-2", flat.files[0].key);
const lines = (await new Response(new Blob([gz.bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()).trim().split("\n");
ok(lines.length === 25 && JSON.parse(lines[0]).cs_method === "GET", "gzip log body");

// Errors look like AWS's and keep code and status.
try { await api.getObject(B.site, "eu-west-2", "missing.txt"); fail("NoSuchKey expected"); }
catch (e) { ok(e.code === "NoSuchKey" && e.status === 404 && e.message === "NoSuchKey: The specified key does not exist.", "NoSuchKey " + e.message); }
try { await api.listObjects("no-such-bucket-example", "eu-west-2"); fail("NoSuchBucket expected"); }
catch (e) { ok(e.code === "NoSuchBucket" && e.status === 404, "NoSuchBucket " + e.message); }
const unsigned = S3Api((req) => AwsTransport.fetch(req.url, { method: req.method, headers: req.headers, body: req.body }));
try { await unsigned.listBuckets(); fail("unsigned Cloud Control call accepted"); }
catch (e) { ok(e.code === "AccessDeniedException" && e.status === 403, "unsigned Cloud Control " + e.message); }
try { await unsigned.getObject(B.site, "eu-west-2", "index.html"); fail("unsigned S3 call accepted"); }
catch (e) { ok(e.code === "AccessDenied" && e.status === 403, "unsigned S3 " + e.message); }

// A key with characters encodeURIComponent leaves alone (! ' ( ) *) and spaces: the path sent must equal
// SigV4's canonical path (decode, then re-encode each segment), and must decode back to the key.
const oddKey = "folder (2)/a (1)!*'.txt";
const oddSeen = [];
const odd = S3Api(sender(readCreds, oddSeen));
try { await odd.getObject(B.site, "eu-west-2", oddKey); fail("odd key: NoSuchKey expected"); }
catch (e) { ok(e.code === "NoSuchKey", "odd key reaches the twin: " + e.message); }
const sentPath = new URL(oddSeen[0].url).pathname;
const canon = sentPath.split("/").map((s) => encodeURIComponent(decodeURIComponent(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("/");
ok(sentPath === "/folder%20%282%29/a%20%281%29%21%2A%27.txt" && sentPath === canon, "odd key path equals SigV4 canonical path: " + sentPath);
ok(decodeURIComponent(sentPath.slice(1)) === oddKey, "odd key path decodes back to the key");

// Pure parts: URLs (path form for dotted names) and XML paging fields, against a fixed answer shaped like
// the ListObjectsV2 example in AWS's S3 API reference.
ok(S3Api.bucketUrl("a.b", "eu-west-1", "x y/z(1)", "") === "https://s3.eu-west-1.amazonaws.com/a.b/x%20y/z%281%29", "dotted bucket path form");
ok(S3Api.bucketUrl("ab", "eu-west-1", "", "?list-type=2") === "https://ab.s3.eu-west-1.amazonaws.com/?list-type=2", "virtual-host form");
const paged = S3Api(async () => new Response(
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Name>bucket</Name><Prefix/><KeyCount>2</KeyCount>" +
  "<MaxKeys>2</MaxKeys><IsTruncated>true</IsTruncated><NextContinuationToken>1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</NextContinuationToken>" +
  "<Contents><Key>happy&amp;face.jpg</Key><LastModified>2014-11-21T19:40:05.000Z</LastModified><ETag>&quot;70ee1738b6b21e2c8a43f3a5ab0eee71&quot;</ETag><Size>11</Size><StorageClass>STANDARD</StorageClass></Contents>" +
  "<Contents><Key>caf&#xE9;.txt</Key><LastModified>2014-05-02T04:51:50.000Z</LastModified><Size>1111</Size></Contents></ListBucketResult>",
  { status: 200, headers: { "content-type": "application/xml" } }));
const pg = await paged.listObjects("bucket", "us-east-1", { maxKeys: 2 });
ok(pg.next === "1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=", "NextContinuationToken " + pg.next);
ok(pg.files.map((f) => f.key).join("|") === "happy&face.jpg|café.txt" && pg.files[1].size === 1111, "entities decoded " + JSON.stringify(pg.files));

// GetBucketCors parsing: entities, several rules, optional fields; NoSuchCORSConfiguration reads as null.
const corsXml = S3Api(async () => new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CORSConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">" +
  "<CORSRule><ID>one</ID><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedOrigin>https://a.example?x=1&amp;y=2</AllowedOrigin><MaxAgeSeconds>60</MaxAgeSeconds></CORSRule>" +
  "<CORSRule><AllowedMethod>PUT</AllowedMethod><AllowedOrigin>*</AllowedOrigin><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>", { status: 200 }));
const cx = await corsXml.getBucketCors("bucket", "us-east-1");
ok(JSON.stringify(cx) === JSON.stringify({ CorsRules: [{ Id: "one", AllowedOrigins: ["https://a.example?x=1&y=2"], AllowedMethods: ["GET", "HEAD"], MaxAge: 60 },
  { AllowedOrigins: ["*"], AllowedMethods: ["PUT"], AllowedHeaders: ["*"], ExposedHeaders: ["ETag"] }] }), "GetBucketCors parsed " + JSON.stringify(cx));
const noCors = S3Api(async () => new Response("<Error><Code>NoSuchCORSConfiguration</Code><Message>The CORS configuration does not exist</Message></Error>", { status: 404 }));
ok((await noCors.getBucketCors("bucket", "us-east-1")) === null, "NoSuchCORSConfiguration is null");
const noBucket = S3Api(async () => new Response("<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>", { status: 404 }));
try { await noBucket.getBucketCors("bucket", "us-east-1"); fail("NoSuchBucket should reject"); } catch (e) { ok(e.code === "NoSuchBucket" && e.status === 404, "NoSuchBucket rejects " + e.message); }

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (s3-api: " + passed + " checks over the twin; buckets, CORS failure, folders, ranges, zip tail, gzip, errors, odd keys, paging fields)");
