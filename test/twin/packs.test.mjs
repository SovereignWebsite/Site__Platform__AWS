// Design 02 step 2: the twin loads its pack as checked data (architect.aws.a's conditions on 74c254d). Packs given
// before twin.js runs are used, field for field; a pack with an unknown generator or field, a value out of range,
// a wrong id or too many log lines is refused; a refused or missing pack makes every AWS request an AWS-shaped
// 503, never a request to the network; hosts that are not AWS are still not answered.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { ROOT } from "./golden.mjs";
import { packsFromDisk } from "./packs.mjs";

function load(pack, given) {
  const sent = [];
  const win = { location: { search: "?pack=" + pack, origin: "http://localhost" }, URLSearchParams, URL, TextEncoder, TextDecoder, Response, Blob,
    CompressionStream, DecompressionStream, Promise, setTimeout: (f) => setImmediate(f), Uint8Array, Uint32Array, ArrayBuffer, DataView, Math, JSON, Date,
    Object, Array, String, Number, RegExp, Error, TypeError, fetch: (u) => { sent.push(u); throw new Error("a request left the page"); } };
  if (given !== undefined) win.AwsTwinPacks = given;
  win.window = win;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "site/twin.js"), "utf8"), vm.createContext(win), { filename: "site/twin.js" });
  return { twin: win.AwsTwin, sent };
}
const AUTH = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261122/eu-west-2/s3/aws4_request, SignedHeaders=host, Signature=twin" };
const listBuckets = (twin) => twin.handle("https://cloudcontrolapi.eu-west-2.amazonaws.com/", { method: "POST", headers: Object.assign({ "x-amz-target": "CloudApiService.ListResources" }, AUTH), body: JSON.stringify({ TypeName: "AWS::S3::Bucket" }) });
let checks = 0;

// 1. Given packs are used: the same journal as the in-code packs, for each pack.
const disk = packsFromDisk();
for (const id of Object.keys(disk)) {
  const a = load(id, disk), b = load(id);
  await a.twin.ready();
  assert.equal(a.twin.loadError(), null, id + ": given pack loads");
  assert.deepEqual(a.twin.journal(), b.twin.journal(), id + ": given pack, same journal as the in-code pack");
  assert.equal(a.sent.length, 0, id + ": nothing fetched"); checks += 3;
}
// A changed parameter changes the world: the given pack is really the one run.
{
  const more = JSON.parse(JSON.stringify(disk)); more.baseline.generate.find((g) => g.gen === "site.archive").pages = 3;
  const { twin } = load("baseline", more); await twin.ready();
  const n = twin.journal().filter((e) => e.op === "s3.putObject" && /archive\/2026\//.test(e.data.key)).length;
  assert.equal(n, 3, "site.archive pages 3 gives 3 archive objects"); checks++;
}

// 2. Refused packs: each gives a reason, and every AWS request is a 503 with it; nothing leaves the page.
const bad = {
  "unknown generator": (p) => p.generate.push({ gen: "s3.everything" }),
  "unknown field": (p) => { p.generate.find((g) => g.gen === "cloudfront.traffic").evil = 1; },
  "unknown top-level field": (p) => { p.script = "alert(1)"; },
  "perHour out of range": (p) => { p.generate.find((g) => g.gen === "cloudfront.traffic").perHour = 1e9; },
  "hours not integers": (p) => { p.generate.find((g) => g.gen === "cloudfront.traffic").hours = ["9"]; },
  "wrong id": (p) => { p.id = "attack"; },
  "too many log lines": (p) => { Object.assign(p.generate.find((g) => g.gen === "cloudfront.traffic"), { days: Array.from({ length: 28 }, (_, i) => i + 1), hours: Array.from({ length: 24 }, (_, i) => i), perHour: 1000 }); },
  "see climbs out": (p) => { p.see = { label: "x", bucket: "logs", prefix: "../../" }; },
  "see names no bucket": (p) => { p.see = { label: "x", bucket: "__proto__", prefix: "a/" }; },
  "hot without hotShare": (p) => { p.generate.find((g) => g.gen === "cloudfront.traffic").hot = "/x"; },
  "not an object": () => null
};
for (const [why, spoil] of Object.entries(bad)) {
  const given = JSON.parse(JSON.stringify(disk)); const r = spoil(given.baseline); if (r === null) given.baseline = null;
  const { twin, sent } = load("baseline", given); await twin.ready();
  assert.ok(twin.loadError(), why + ": refused"); 
  const res = await listBuckets(twin);
  assert.equal(res.status, 503, why + ": AWS requests are 503");
  assert.match(await res.text(), /<Code>ServiceUnavailable<\/Code>.*did not load/, why + ": the 503 says why");
  assert.equal(sent.length, 0, why + ": nothing fetched"); checks += 4;
}
// A pack missing from the given set is refused too.
{
  const { twin } = load("surge", { baseline: disk.baseline }); await twin.ready();
  assert.match(twin.loadError(), /not among the packs given/); assert.equal((await listBuckets(twin)).status, 503); checks += 2;
}
// 3. Hosts that are not AWS are not answered (the transport says so); AWS hosts the twin lacks are a 501.
{
  const { twin } = load("baseline", disk);
  assert.equal(twin.handle("https://example.com/", {}), null, "not AWS: no answer");
  assert.equal((await twin.handle("https://sqs.eu-west-2.amazonaws.com/", { method: "POST", body: "" })).status, 501, "an AWS service the twin lacks: 501"); checks += 2;
}
console.log("OK (twin packs: " + checks + " checks; given packs run field for field, 11 kinds of bad pack refused with a 503 and no request, non-AWS hosts unanswered)");
