// The twin's Lambda (REST JSON, 2015-03-31) and Firehose (JSON 1.1) read calls: ListFunctions and
// GetFunctionConfiguration, ListDeliveryStreams and DescribeDeliveryStream, as AWS documents their shapes;
// demo-handler's CodeSize and CodeSha256 are those of the zip in the deps bucket; the stream's S3 destination
// is the logs bucket that holds the twin's hourly files; unsigned calls are refused. Node 22; no network.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
globalThis.window = globalThis;
globalThis.location = { origin: "http://localhost", search: "" };
new Function(readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8"))();
const T = globalThis.AwsTwin, auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
const L = "https://lambda.eu-west-2.amazonaws.com", F = "https://firehose.eu-west-2.amazonaws.com/";
const get = (url, h) => T.handle(url, { method: "GET", headers: h === undefined ? auth : h });
const fh = (action, body, h) => T.handle(F, { method: "POST", headers: Object.assign({ "x-amz-target": "Firehose_20150804." + action, "content-type": "application/x-amz-json-1.1" }, h === undefined ? auth : h), body: JSON.stringify(body || {}) });

// ListFunctions
let r = await get(L + "/2015-03-31/functions/");
if (r.status !== 200 || !/application\/json/.test(r.headers.get("content-type"))) fail("ListFunctions status " + r.status);
const list = await r.json();
const names = list.Functions.map((f) => f.FunctionName);
if (names.join() !== "demo-handler,demo-log-enricher,demo-nightly-report") fail("functions " + names);
if (!("NextMarker" in list)) fail("no NextMarker");
for (const f of list.Functions) {
  for (const k of ["FunctionArn", "Runtime", "Role", "Handler", "CodeSize", "Timeout", "MemorySize", "LastModified", "CodeSha256", "Version", "State", "PackageType"]) if (f[k] === undefined) fail(f.FunctionName + " lacks " + k);
  if (!/^arn:aws:lambda:eu-west-2:111122223333:function:/.test(f.FunctionArn)) fail("arn " + f.FunctionArn);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+0000$/.test(f.LastModified)) fail("LastModified format " + f.LastModified);
  if (Buffer.from(f.CodeSha256, "base64").length !== 32) fail("CodeSha256 is not 32 bytes: " + f.FunctionName);
}

// demo-handler is the zip in the deps bucket (the deps bucket has the page's CORS rule already)
const zip = new Uint8Array(await (await get("https://" + T.buckets.deps + ".s3.eu-west-2.amazonaws.com/lambdas-dependencies/demo-handler==v1.0.0.zip")).arrayBuffer());
const dh = list.Functions[0];
if (dh.CodeSize !== zip.length) fail("CodeSize " + dh.CodeSize + " vs zip " + zip.length);
if (dh.CodeSha256 !== createHash("sha256").update(zip).digest("base64")) fail("CodeSha256 is not the zip's");
if (dh.Timeout !== 30 || dh.MemorySize !== 256) fail("demo-handler settings differ from its config.json");

// GetFunctionConfiguration by name and by ARN; unknown name
r = await get(L + "/2015-03-31/functions/demo-log-enricher/configuration");
if ((await r.json()).Handler !== "enricher.handler") fail("GetFunctionConfiguration by name");
r = await get(L + "/2015-03-31/functions/" + encodeURIComponent("arn:aws:lambda:eu-west-2:111122223333:function:demo-handler") + "/configuration");
if ((await r.json()).FunctionName !== "demo-handler") fail("GetFunctionConfiguration by ARN");
r = await get(L + "/2015-03-31/functions/nope/configuration");
if (r.status !== 404 || r.headers.get("x-amzn-errortype") !== "ResourceNotFoundException") fail("unknown function: " + r.status);

// Firehose
r = await fh("ListDeliveryStreams");
if (!/application\/x-amz-json-1\.1/.test(r.headers.get("content-type"))) fail("Firehose content-type");
const ls = await r.json();
if (ls.DeliveryStreamNames.join() !== "demo-cloudfront-logs" || ls.HasMoreDeliveryStreams !== false) fail("ListDeliveryStreams");
const d = (await (await fh("DescribeDeliveryStream", { DeliveryStreamName: "demo-cloudfront-logs" })).json()).DeliveryStreamDescription;
if (d.DeliveryStreamStatus !== "ACTIVE" || typeof d.CreateTimestamp !== "number") fail("stream status or timestamp");
const s3d = d.Destinations[0].ExtendedS3DestinationDescription;
if (s3d.BucketARN !== "arn:aws:s3:::" + T.buckets.logs || s3d.Prefix !== "cloudfront/") fail("destination " + s3d.BucketARN + " " + s3d.Prefix);
const lst = await (await get("https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/?list-type=2&prefix=" + encodeURIComponent(s3d.Prefix))).text();
if (!/<KeyCount>[1-9]/.test(lst)) fail("no files under the stream's prefix");
const lam = s3d.ProcessingConfiguration.Processors[0].Parameters[0].ParameterValue;
if (!names.some((n) => lam.indexOf(":function:" + n + ":") > 0)) fail("processor is not a twin function: " + lam);
r = await fh("DescribeDeliveryStream", { DeliveryStreamName: "nope" });
if (r.status !== 400 || (await r.json()).__type !== "ResourceNotFoundException") fail("unknown stream");

// unsigned calls are refused; writes are not in the twin
if ((await get(L + "/2015-03-31/functions/", {})).status !== 403) fail("unsigned Lambda call answered");
if ((await fh("ListDeliveryStreams", {}, {})).status !== 403) fail("unsigned Firehose call answered");
if ((await T.handle(L + "/2015-03-31/functions/demo-handler/invocations", { method: "POST", headers: auth })).status !== 400) fail("Invoke answered");
console.log("ok lambda-firehose");
