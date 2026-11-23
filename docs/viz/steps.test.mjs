// Run: node --test docs/viz/steps.test.mjs
// Builds the steps from a real line of the twin's CloudFront logs (site/twin.js, unchanged, in a sandbox). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";
import { stepsFor, asText, parseLine, edgeCity, s3Href } from "./steps.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadTwin() {
  const win = {};
  const ctx = vm.createContext({ window: win, crypto, btoa, TextEncoder, TextDecoder, Response, Blob, CompressionStream, URL, URLSearchParams, setTimeout, Promise, JSON, Math, Date, String, Object, Array, Uint8Array, Uint32Array, DataView, ArrayBuffer, TypeError, encodeURIComponent, decodeURIComponent, document: { baseURI: "https://twin.invalid/" } });
  vm.runInContext(readFileSync(join(root, "site", "twin.js"), "utf8"), ctx, { filename: "site/twin.js" });
  return win.AwsTwin;
}
const READ = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261123/eu-west-2/s3/aws4_request" };
const CHANGE = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCHANGE/20261123/eu-west-2/cloudcontrolapi/aws4_request" };

async function twinPacket(path = "/data/vaults.json") {
  const twin = loadTwin(), B = twin.buckets;
  for (const b of [B.site, B.logs]) await twin.handle("https://cloudcontrolapi.eu-west-2.amazonaws.com/", { method: "POST", headers: { ...CHANGE, "x-amz-target": "CloudApiService.UpdateResource" },
    body: JSON.stringify({ TypeName: "AWS::S3::Bucket", Identifier: b, PatchDocument: JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [] } }]) }) });
  const s3 = (b, q) => "https://" + b + ".s3.eu-west-2.amazonaws.com/" + q;
  const list = await (await twin.handle(s3(B.logs, "?list-type=2&prefix=cloudfront/"), { headers: READ })).text();
  let logKey, line;
  for (const [, k] of list.matchAll(/<Key>([^<]+)<\/Key>/g)) {
    const gz = new Uint8Array(await (await twin.handle(s3(B.logs, k), { headers: READ })).arrayBuffer());
    line = gunzipSync(gz).toString("utf8").trim().split("\n").find((x) => JSON.parse(x).cs_uri_stem === path);
    if (line) { logKey = k; break; }
  }
  const obj = await twin.handle(s3(B.site, "data/vaults.json"), { headers: READ });
  const body = new Uint8Array(await obj.arrayBuffer());
  const fh = await twin.handle("https://firehose.eu-west-2.amazonaws.com/", { method: "POST", headers: { ...READ, "x-amz-target": "Firehose_20150804.DescribeDeliveryStream", "content-type": "application/x-amz-json-1.1" }, body: JSON.stringify({ DeliveryStreamName: "demo-cloudfront-logs" }) });
  const stream = (await fh.json()).DeliveryStreamDescription;
  return { line, ctx: { site: B.site, logs: B.logs, logKey, object: { size: body.length, type: obj.headers.get("content-type") }, stream } };
}

test("a twin log line for /data/vaults.json becomes six steps, in storyboard order", async () => {
  const { line, ctx } = await twinPacket();
  assert.ok(line, "the twin's CloudFront logs hold a /data/vaults.json request");
  const steps = stepsFor(line, ctx);
  assert.deepEqual(steps.map((s) => s.title), ["Ask", "Edge", "Origin", "Answer", "Log", "Batch"]);
  assert.deepEqual(steps.map((s) => s.from + ">" + s.to), ["visitor>edge", "edge>edge", "edge>keeper", "keeper>visitor", "edge>scribe", "scribe>archivist"]);
  const l = JSON.parse(line);
  assert.equal(steps[0].fields.path, "/data/vaults.json");
  assert.equal(steps[2].fields.bucket, "111122223333--demo-site--eu-west-2");
  assert.ok(steps[2].fields.size > 0);
  assert.equal(steps[3].fields.bytes, l.sc_bytes);
  assert.match(steps[5].fields.key, /^cloudfront\/2026\/11\/2\d\/\d\d\/demo-distribution-1-.*\.gz$/);
});

test("the timeline is true to the line's time_taken and only moves forward", async () => {
  const { line, ctx } = await twinPacket();
  const steps = stepsFor(line, ctx), tt = JSON.parse(line).time_taken;
  assert.equal(steps[0].t, 0);
  assert.ok(Math.abs(steps[3].t - tt * 0.75) < 1e-3);
  for (let n = 1; n < steps.length; n++) assert.ok(steps[n].t >= steps[n - 1].t);
});

test("what the twin lacks is marked as a gap, not filled in", async () => {
  const { line, ctx } = await twinPacket();
  const gaps = stepsFor(line, ctx).filter((s) => s.gap).map((s) => s.gap);
  assert.deepEqual(gaps, ["cache hit or miss", "origin access setting"]);
  const noStream = stepsFor(line, { ...ctx, stream: null });
  assert.equal(noStream[4].gap, "Firehose stream");
  const noObj = stepsFor(line, { ...ctx, object: null });
  assert.equal(noObj[2].gap, "object not in the twin");
  assert.ok(asText(noObj).every((t) => typeof t === "string" && t.length > 0));
  assert.match(asText(noObj)[1], /not yet in the twin/);
});

test("the twin's Firehose stream fills the log steps: name, enricher, buffer, bucket", async () => {
  const { line, ctx } = await twinPacket();
  const [, , , , log, batch] = stepsFor(line, ctx);
  assert.equal(log.fields.stream, "demo-cloudfront-logs");
  assert.match(log.fields.processor, /:function:demo-log-enricher:\$LATEST$/);
  assert.match(log.text, /enriched by demo-log-enricher$/);
  assert.equal(batch.fields.buffer_seconds, 900);
  assert.equal(batch.fields.compression, "GZIP");
  assert.equal(batch.gap, undefined);
  const other = { ...ctx.stream, Destinations: [{ ExtendedS3DestinationDescription: { ...ctx.stream.Destinations[0].ExtendedS3DestinationDescription, BucketARN: "arn:aws:s3:::elsewhere" } }] };
  assert.equal(stepsFor(line, { ...ctx, stream: other })[5].gap, "stream writes to another bucket");
});

test("panel values link to the S3 browser's address for what they name", async () => {
  const { line, ctx } = await twinPacket();
  const steps = stepsFor(line, ctx);
  assert.equal(steps[2].fields.href, "#/s3/111122223333--demo-site--eu-west-2/data/vaults.json");
  assert.match(steps[5].fields.href, /^#\/s3\/111122223333--demo-cloudfront-logs--eu-west-2\/cloudfront\/2026\/11\//);
  assert.equal(s3Href("b", "a b/c#d"), "#/s3/b/a%20b/c%23d");
});

test("the enricher's fields: country on every line, and a Vault step only when the line names a vault", async () => {
  const site = await twinPacket();
  const plain = stepsFor(site.line, site.ctx);
  assert.equal(plain.length, 6);
  assert.match(plain[4].fields.country, /^(GB|IE|NL)$/);
  assert.equal(plain[4].fields.vault, null);
  const v = await twinPacket("/vault/vault-demo-001/files");
  const steps = stepsFor(v.line, v.ctx);
  assert.deepEqual(steps.map((s) => s.title), ["Ask", "Edge", "Origin", "Answer", "Log", "Batch", "Vault"]);
  assert.equal(steps[6].fields.vault, "vault-demo-001");
  assert.ok(steps[6].t >= steps[5].t);
});

test("lines that are not CloudFront lines are refused; unknown edges say so", () => {
  assert.throws(() => parseLine("{\"cs_uri_stem\":\"/\"}"), /no timestamp/);
  assert.equal(edgeCity("LHR50-C1"), "London");
  assert.equal(edgeCity("XYZ1"), "unknown edge");
});
