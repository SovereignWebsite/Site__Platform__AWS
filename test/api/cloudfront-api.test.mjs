// CloudFrontApi (site/api/cloudfront-api.js, architect.aws.a design 06 step 1) over answers in the XML shapes of
// botocore's cloudfront 2020-05-31 model (the twin does not answer CloudFront yet; dev.1.aws.a adds it): request shapes,
// paging (IsTruncated + NextMarker for distributions, NextMarker alone for functions), origin kinds and targets,
// function associations per behaviour, logging, errors, the planted custom-header value appearing nowhere (output, errors,
// error paths), hostile ids, and the contract. Node 22, no network. Run: node test/api/cloudfront-api.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { URLSearchParams, URL, Response, Headers, Promise, Error, TypeError, JSON, Object, Array, String, Number, RegExp, Math };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["api/all.js", "api/cloudfront-api.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { CloudFrontApi } = ctx, A = "111122223333", SECRET = "s3cr3t-Origin-Verify-9f8e7d6c";
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const rejects = async (p, test, m) => { try { await p; ok(false, m + ": did not reject"); } catch (e) { ok(test(e), m + ": " + e.message); } };
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- answers, in botocore's shapes (rest-xml, list members as their locationName) ----
const fa = (arn, ev) => "<FunctionAssociation><FunctionARN>" + arn + "</FunctionARN><EventType>" + ev + "</EventType></FunctionAssociation>";
const origin = (id, domain, extra) => "<Origin><Id>" + id + "</Id><DomainName>" + domain + "</DomainName><OriginPath></OriginPath>" + (extra || "") + "</Origin>";
const headers = "<CustomHeaders><Quantity>2</Quantity><Items><OriginCustomHeader><HeaderName>X-Origin-Verify</HeaderName><HeaderValue>" + SECRET + "</HeaderValue></OriginCustomHeader>" +
  "<OriginCustomHeader><HeaderName>X-Other</HeaderName><HeaderValue>" + SECRET + "-2</HeaderValue></OriginCustomHeader></Items></CustomHeaders>";
const HEALTH = "arn:aws:cloudfront::" + A + ":function/sws-vault-0a1b2c3d4e5f-health";
const cfgBody = (id) =>
  "<Aliases><Quantity>1</Quantity><Items><CNAME>www.example.com</CNAME></Items></Aliases>" +
  "<Origins><Quantity>4</Quantity><Items>" +
  origin("site", "111122223333--demo-site--eu-west-2.s3.eu-west-2.amazonaws.com", "<S3OriginConfig><OriginAccessIdentity></OriginAccessIdentity></S3OriginConfig><OriginAccessControlId>E2OACTWIN0001</OriginAccessControlId>") +
  origin("web", "my.dotted.bucket.s3-website-eu-west-2.amazonaws.com") +
  origin("vault", "abcdefghij0123456789klmnopqrstuv.lambda-url.eu-west-2.on.aws", headers) +
  origin("other", "api.example.com") +
  "</Items></Origins>" +
  "<DefaultCacheBehavior><TargetOriginId>site</TargetOriginId><FunctionAssociations><Quantity>0</Quantity></FunctionAssociations></DefaultCacheBehavior>" +
  "<CacheBehaviors><Quantity>1</Quantity><Items><CacheBehavior><PathPattern>/health</PathPattern><TargetOriginId>vault</TargetOriginId>" +
  "<FunctionAssociations><Quantity>1</Quantity><Items>" + fa(HEALTH, "viewer-request") + "</Items></FunctionAssociations></CacheBehavior></Items></CacheBehaviors>" +
  "<Comment>The demo &amp; its &lt;site&gt;</Comment><PriceClass>PriceClass_100</PriceClass><Enabled>true</Enabled>";
const summary = (id) => "<DistributionSummary><Id>" + id + "</Id><ARN>arn:aws:cloudfront::" + A + ":distribution/" + id + "</ARN><ETag>E1</ETag><Status>Deployed</Status>" +
  "<LastModifiedTime>2026-11-18T14:20:30Z</LastModifiedTime><DomainName>d111111abcdef8.cloudfront.net</DomainName>" + cfgBody(id) + "</DistributionSummary>";
const listD = (ids, next) => "<?xml version=\"1.0\" encoding=\"UTF-8\"?><DistributionList xmlns=\"http://cloudfront.amazonaws.com/doc/2020-05-31/\"><Marker></Marker>" +
  (next ? "<NextMarker>" + next + "</NextMarker>" : "") + "<MaxItems>100</MaxItems><IsTruncated>" + (next ? "true" : "false") + "</IsTruncated><Quantity>" + ids.length + "</Quantity>" +
  (ids.length ? "<Items>" + ids.map(summary).join("") + "</Items>" : "") + "</DistributionList>";
const getD = (id, logging) => "<?xml version=\"1.0\"?><Distribution xmlns=\"http://cloudfront.amazonaws.com/doc/2020-05-31/\"><Id>" + id + "</Id><ARN>arn:aws:cloudfront::" + A + ":distribution/" + id + "</ARN>" +
  "<Status>Deployed</Status><LastModifiedTime>2026-11-18T14:20:30Z</LastModifiedTime><InProgressInvalidationBatches>0</InProgressInvalidationBatches><DomainName>d111111abcdef8.cloudfront.net</DomainName>" +
  "<DistributionConfig><CallerReference>twin</CallerReference>" + cfgBody(id) + "<DefaultRootObject>index.html</DefaultRootObject>" +
  (logging ? "<Logging><Enabled>true</Enabled><IncludeCookies>false</IncludeCookies><Bucket>logs.s3.amazonaws.com</Bucket><Prefix>cf/</Prefix></Logging>" : "<Logging><Enabled>false</Enabled><IncludeCookies>false</IncludeCookies><Bucket></Bucket><Prefix></Prefix></Logging>") +
  "</DistributionConfig></Distribution>";
const fnSummary = (name, stage) => "<FunctionSummary><Name>" + name + "</Name><Status>UNASSOCIATED</Status><FunctionConfig><Comment>health</Comment><Runtime>cloudfront-js-2.0</Runtime></FunctionConfig>" +
  "<FunctionMetadata><FunctionARN>arn:aws:cloudfront::" + A + ":function/" + name + "</FunctionARN><Stage>" + stage + "</Stage><CreatedTime>2026-11-24T09:01:00Z</CreatedTime><LastModifiedTime>2026-11-24T09:02:00Z</LastModifiedTime></FunctionMetadata></FunctionSummary>";
const listF = (names, next) => "<FunctionList><NextMarker>" + (next || "") + "</NextMarker><MaxItems>100</MaxItems><Quantity>" + names.length + "</Quantity><Items>" + names.map((n) => fnSummary(n, "LIVE")).join("") + "</Items></FunctionList>";
const errXml = (code, msg) => "<?xml version=\"1.0\"?><ErrorResponse xmlns=\"http://cloudfront.amazonaws.com/doc/2020-05-31/\"><Error><Type>Sender</Type><Code>" + code + "</Code><Message>" + msg + "</Message></Error><RequestId>r</RequestId></ErrorResponse>";

const fake = (answer) => { const log = []; const send = async (req) => { log.push(req); const [status, body] = answer(req); return new Response(body, { status }); }; return { log, send }; };

// ---- distributions ----
{
  const f = fake((req) => [200, new URL(req.url).searchParams.get("Marker") ? listD(["EDEMOTWIN00002"]) : listD(["EDEMOTWIN00001"], "EDEMOTWIN00001")]);
  const api = CloudFrontApi(f.send, { account: A });
  const p1 = plain(await api.distributions({ max: 5 }));
  ok(f.log[0].service === "cloudfront" && f.log[0].region === "us-east-1" && f.log[0].method === "GET" && f.log[0].url === "https://cloudfront.amazonaws.com/2020-05-31/distribution?MaxItems=5" && !f.log[0].body, "request: GET /2020-05-31/distribution, signed cloudfront us-east-1 " + f.log[0].url);
  ok(p1.next === "EDEMOTWIN00001" && p1.items.length === 1, "IsTruncated true: next is NextMarker");
  const d = p1.items[0];
  ok(d.id === "EDEMOTWIN00001" && d.arn === "arn:aws:cloudfront::" + A + ":distribution/EDEMOTWIN00001" && d.domain === "d111111abcdef8.cloudfront.net" && d.status === "Deployed" && d.enabled === true && d.priceClass === "PriceClass_100", "the summary's id, AWS's ARN, domain, status");
  ok(JSON.stringify(d.aliases) === JSON.stringify(["www.example.com"]) && d.comment === "The demo & its <site>", "aliases; comment as text, entities read");
  ok(JSON.stringify(d.origins.map((o) => [o.id, o.kind, o.target])) === JSON.stringify([["site", "s3", "arn:aws:s3:::111122223333--demo-site--eu-west-2"], ["web", "s3-website", "arn:aws:s3:::my.dotted.bucket"], ["vault", "lambda-url", null], ["other", "custom", null]]), "origin kinds and targets: s3, s3-website (dotted bucket), lambda-url (no target), custom (no target)");
  ok(d.origins[0].oac === "E2OACTWIN0001" && d.origins[3].oac === null, "OAC id only");
  ok(JSON.stringify(d.origins[2].customHeaders) === JSON.stringify(["X-Origin-Verify", "X-Other"]), "custom header names only");
  ok(JSON.stringify(d.functions) === JSON.stringify([{ arn: HEALTH, event: "viewer-request", behaviour: "/health" }]), "function associations with their behaviour (an empty default contributes none)");
  const p2 = plain(await api.distributions({ next: p1.next }));
  ok(new URL(f.log[1].url).searchParams.get("Marker") === "EDEMOTWIN00001" && p2.next === null && p2.items[0].id === "EDEMOTWIN00002", "next goes back as Marker; IsTruncated false ends it");
  ok((await CloudFrontApi.all((next) => api.distributions({ next }))).items.length === 2, "CloudFrontApi.all drains two pages");
  const empty = CloudFrontApi(fake(() => [200, listD([])]).send);
  ok(JSON.stringify(plain(await empty.distributions())) === JSON.stringify({ items: [], next: null }), "no distributions: an empty page (no Items element)");
}
// ---- distribution ----
{
  const f = fake(() => [200, getD("EDEMOTWIN00001", true)]);
  const d = plain(await CloudFrontApi(f.send).distribution("EDEMOTWIN00001"));
  ok(f.log[0].url === "https://cloudfront.amazonaws.com/2020-05-31/distribution/EDEMOTWIN00001", "GET /2020-05-31/distribution/{Id}");
  ok(d.id === "EDEMOTWIN00001" && d.origins.length === 4 && d.functions.length === 1 && d.defaultRoot === "index.html", "distribution(): the config read like the summary, with defaultRoot");
  ok(JSON.stringify(d.logging) === JSON.stringify({ bucket: "logs.s3.amazonaws.com", prefix: "cf/" }), "legacy logging when on");
  ok(plain(await CloudFrontApi(fake(() => [200, getD("E1", false)]).send).distribution("E1")).logging === null, "logging off: null");
  await rejects(CloudFrontApi(fake(() => [404, errXml("NoSuchDistribution", "The specified distribution does not exist.")]).send).distribution("ENOPE"), (e) => e.code === "NoSuchDistribution" && e.status === 404 && e.message === "NoSuchDistribution: The specified distribution does not exist.", "NoSuchDistribution");
}
// ---- functions ----
{
  const f = fake((req) => [200, new URL(req.url).searchParams.get("Marker") ? listF(["b"]) : listF(["sws-vault-0a1b2c3d4e5f-health"], "m1")]);
  const api = CloudFrontApi(f.send);
  const p1 = plain(await api.functions({ stage: "LIVE" }));
  ok(f.log[0].url === "https://cloudfront.amazonaws.com/2020-05-31/function?Stage=LIVE", "GET /2020-05-31/function with Stage");
  ok(JSON.stringify(p1.items[0]) === JSON.stringify({ name: "sws-vault-0a1b2c3d4e5f-health", arn: HEALTH, runtime: "cloudfront-js-2.0", stage: "LIVE", status: "UNASSOCIATED", lastModified: "2026-11-24T09:02:00Z" }) && p1.next === "m1", "functions(): metadata only; NextMarker alone pages (no IsTruncated)");
  ok(plain(await api.functions({ next: "m1" })).next === null, "an empty NextMarker ends it");
  await rejects(api.functions({ stage: "PROD" }), (e) => e instanceof TypeError, "stage is DEVELOPMENT or LIVE");
}
// ---- the planted header value appears nowhere: output, errors, error paths ----
{
  const outputs = [];
  const api = CloudFrontApi(fake(() => [200, listD(["EDEMOTWIN00001"])]).send);
  outputs.push(JSON.stringify(plain(await api.distributions())));
  outputs.push(JSON.stringify(plain(await CloudFrontApi(fake(() => [200, getD("E1", true)]).send).distribution("E1"))));
  // Error answers that carry the value (a confused or hostile endpoint), cut-off bodies, a value in an unclosed element.
  for (const body of [errXml("AccessDenied", "no") + headers, "<Error><Code>X</Code><Message>m</Message>" + headers, getD("E1", true).slice(0, getD("E1", true).indexOf(SECRET) + 5),
    "<Distribution><DistributionConfig><Origins><Items><Origin><CustomHeaders><Items><OriginCustomHeader><HeaderName>H</HeaderName><HeaderValue>" + SECRET + "</HeaderValu></OriginCustomHeader></Items></CustomHeaders></Origin></Items></Origins></DistributionConfig></Distribution>"]) {
    for (const status of [200, 403]) {
      try { outputs.push(JSON.stringify(plain(await CloudFrontApi(fake(() => [status, body]).send).distribution("E1")))); }
      catch (e) { outputs.push(String(e && e.message) + " " + String(e && e.code) + " " + JSON.stringify(Object.assign({}, e))); }
    }
  }
  ok(outputs.length === 10 && outputs.every((o) => !o.includes(SECRET) && !o.includes("Origin-Verify-9f8e")), "the custom header value appears in no output or error (" + outputs.length + " cases)");
  const src = readFileSync(new URL("../../site/api/cloudfront-api.js", import.meta.url), "utf8");
  ok(/DROP = \{ HeaderValue: true \}/.test(src) && !/HeaderValue"\)/.test(src), "the reader drops HeaderValue and never reads it");
}
// ---- hostile input, refusals ----
{
  let sent = 0; const api = CloudFrontApi(async () => { sent++; return new Response(listD([])); });
  for (const id of ["", "e1", "E1/../../function", "E1?Marker=x", "E 1", "E1%2F", { toString: () => "E1/x" }, "E".repeat(65)]) await rejects(api.distribution(id), (e) => e instanceof TypeError, "distribution(" + JSON.stringify(String(id)).slice(0, 30) + ") refused");
  ok(sent === 0, "nothing sent for a bad id");
  const f = fake(() => [200, listD([])]);
  await CloudFrontApi(f.send).distributions({ next: "a&MaxItems=9999#x", max: 99999 });
  const q = new URL(f.log[0].url).searchParams;
  ok(q.getAll("Marker").length === 1 && q.get("Marker") === "a&MaxItems=9999#x" && q.getAll("MaxItems").join() === "1000", "a hostile next stays one Marker; MaxItems capped at 1000");
  await rejects(CloudFrontApi(() => Promise.reject(new TypeError("Failed to fetch"))).distributions(), (e) => e instanceof TypeError && e.message === "Failed to fetch", "a CORS TypeError passes through");
  await rejects(CloudFrontApi(fake(() => [503, "busy"]).send).distributions(), (e) => e.code === "HTTP 503" && e.status === 503, "a non-XML failure keeps its status");
  await rejects(CloudFrontApi(fake(() => [200, "<X>" + "a".repeat(4 * 1024 * 1024) + "</X>"]).send).distributions(), (e) => e.code === "TooLarge", "over 4 MB refused");
  let read = false;
  const declared = CloudFrontApi(async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": String(5 * 1024 * 1024) }), text: async () => { read = true; return ""; } }));
  await rejects(declared.distributions(), (e) => e.code === "TooLarge", "a declared length over 4 MB is refused");
  ok(!read, "...before the body is read");
  ok(CloudFrontApi.originKind("abc.s3.cn-north-1.amazonaws.com", "aws-cn").target === "arn:aws-cn:s3:::abc" && CloudFrontApi.originKind("abc.s3.amazonaws.com", "evil:x").target === "arn:aws:s3:::abc", "the bucket's ARN takes the distribution's partition; anything odd falls back to aws");
  const t0 = Date.now(); try { await CloudFrontApi(fake(() => [200, "<DistributionList><Items>" + "<DistributionSummary><Origins>".repeat(20000)]).send).distributions(); } catch (e) { /* fine */ }
  ok(Date.now() - t0 < 500, "deep unclosed nesting parsed in " + (Date.now() - t0) + " ms");
  let thrown = null; try { CloudFrontApi(); } catch (e) { thrown = e; } ok(thrown instanceof TypeError, "CloudFrontApi needs a send");
  ok(!/\beval\(|new Function|innerHTML|DOMParser|DescribeFunction|GetFunction\b/.test(readFileSync(new URL("../../site/api/cloudfront-api.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "")), "no eval, HTML, DOMParser or function-code calls in the code");
}
// ---- origin kinds directly ----
for (const [d, k, t] of [["bkt.s3.amazonaws.com", "s3", "arn:aws:s3:::bkt"], ["b.s3.amazonaws.com", "custom", null], ["abc.s3.us-east-1.amazonaws.com", "s3", "arn:aws:s3:::abc"], ["abc.s3-website.eu-west-2.amazonaws.com", "s3-website", "arn:aws:s3:::abc"],
  ["abc.s3.eu-west-2.amazonaws.com.evil.example", "custom", null], ["old-bucket.s3-eu-west-1.amazonaws.com", "s3", "arn:aws:s3:::old-bucket"], ["abc.s3-website-eu-west-1.amazonaws.com", "s3-website", "arn:aws:s3:::abc"],
  ["abc.s3.dualstack.eu-west-1.amazonaws.com", "custom", null], ["abc.s3-external-1.amazonaws.com", "custom", null], ["s3.amazonaws.com", "custom", null], ["ABC.S3.AMAZONAWS.COM", "s3", "arn:aws:s3:::abc"], ["x.lambda-url.eu-west-2.on.aws.evil", "custom", null]]) {
  const r = CloudFrontApi.originKind(d);
  ok(r.kind === k && r.target === t, "originKind(" + d + ") -> " + k + " " + t + " (got " + r.kind + " " + r.target + ")");
}

// ---- contract ----
{
  const doc = JSON.parse(readFileSync(new URL("../../site/api/cloudfront.openapi.json", import.meta.url), "utf8"));
  const ops = Object.values(doc.paths).flatMap((p) => Object.values(p));
  const api = CloudFrontApi(async () => new Response(listD([])));
  ok(doc.openapi === "3.1.0" && doc.info.version === "0.1.0" && doc["x-browser-global"] === "CloudFrontApi" && JSON.stringify(ops.map((o) => o.operationId).sort()) === JSON.stringify(Object.keys(api).sort()), "one operation per method, 0.1.0");
  const ACTION = { "/2020-05-31/distribution": "cloudfront:ListDistributions", "/2020-05-31/function": "cloudfront:ListFunctions" };
  const rec = []; const r = CloudFrontApi(async (req) => { const p = new URL(req.url).pathname; rec.push(ACTION[p] || (/^\/2020-05-31\/distribution\/[A-Z0-9]+$/.test(p) ? "cloudfront:GetDistribution" : "?" + p)); return new Response(/function/.test(p) ? listF([]) : /distribution\//.test(p) ? getD("E1") : listD([])); });
  const samples = { distributions: [{}], distribution: ["E1"], functions: [{}] };
  for (const o of ops) {
    rec.length = 0; await r[o.operationId](...samples[o.operationId]);
    ok(o["x-role"] === "read" && JSON.stringify(rec) === JSON.stringify(o["x-aws-actions"]), o.operationId + ": requests need exactly " + o["x-aws-actions"]);
  }
  const all = [...new Set(ops.flatMap((o) => o["x-aws-actions"]))].sort().join();
  ok(all === "cloudfront:GetDistribution,cloudfront:ListDistributions,cloudfront:ListFunctions", "three read actions: " + all);
  const walk = (v) => { if (Array.isArray(v)) return v.every(walk); if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => k === "$ref" ? !!x.replace(/^#\//, "").split("/").reduce((a, p) => a && a[p], doc) : walk(x)); return true; };
  ok(walk(doc), "every $ref resolves");
}

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (cloudfront-api: " + passed + " checks; requests, paging, origins, functions, logging, errors, planted header value, hostile ids, contract)");
