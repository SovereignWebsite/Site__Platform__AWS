// The S3Api contract (site/api/s3.openapi.json) against S3Api itself (site/api/s3-api.js): one operation per
// method, same arguments, and each operation's x-aws-actions name the service the method really calls.
// Every $ref resolves. No network: S3Api runs over a recording send. Run: node test/api/openapi.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("../../", import.meta.url);
const doc = JSON.parse(readFileSync(new URL("site/api/s3.openapi.json", root), "utf8"));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const ops = [];
for (const [path, item] of Object.entries(doc.paths))
  for (const [method, op] of Object.entries(item)) ops.push({ path, method, ...op });

const ctx = { Response, Headers, Uint8Array, TextEncoder, TextDecoder, JSON, Promise, Error, TypeError, RegExp, String, Number, Object, Array, encodeURIComponent };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("site/api/s3-api.js", root), "utf8"), ctx, { filename: "s3-api.js" });
const calls = [];
const api = ctx.S3Api((req) => {
  calls.push(req);
  const body = req.service === "s3" ? "<Error><Code>AccessDenied</Code><Message>no</Message></Error>"
    : JSON.stringify({ __type: "com.amazon.coral.service#AccessDeniedException", message: "no" });
  return Promise.resolve(new Response(body, { status: 403 }));
});
const methods = Object.keys(api).sort();
const byId = Object.fromEntries(ops.map(o => [o.operationId, o]));

test("OpenAPI 3.1 with no server", () => {
  assert.equal(doc.openapi, "3.1.0");
  assert.deepEqual(doc.servers, []);
});

test("one operation per S3Api method, nothing more", () => {
  assert.deepEqual(ops.map(o => o.operationId).sort(), methods);
});

test("x-arguments name the method with as many arguments as it takes", () => {
  for (const m of methods) {
    const a = byId[m]["x-arguments"];
    if (!a) { assert.equal(api[m].length, byId[m].parameters ? byId[m].parameters.length : 0, m); continue; }
    const args = a.slice(a.indexOf("(") + 1, a.lastIndexOf(")")).replace(/\{[^}]*\}|\[[^\]]*\]/g, "x").split(",").filter(x => x.trim());
    assert.ok(a.startsWith(m + "("), m); assert.equal(args.length, api[m].length, m);
  }
});

test("every operation lists x-aws-actions as service:Action strings", () => {
  for (const o of ops) {
    assert.ok(Array.isArray(o["x-aws-actions"]) && o["x-aws-actions"].length, o.operationId);
    for (const a of o["x-aws-actions"]) assert.match(a, /^[a-z0-9-]+:[A-Z][A-Za-z0-9]+$/, o.operationId + " " + a);
  }
});

test("S3Api only reads: every operation has role read and no write action", () => {
  for (const o of ops) {
    assert.equal(o["x-role"], "read", o.operationId);
    assert.ok(!o["x-aws-actions"].some(a => /:(Update|Put|Delete|Create)/.test(a)), o.operationId);
  }
  assert.ok(doc["x-not-in-s3api"].planCors && doc["x-not-in-s3api"].applyPlan);
});

const service = { cloudcontrolapi: "cloudformation", s3: "s3" };
const target = { ListResources: "cloudformation:ListResources", GetResource: "cloudformation:GetResource" };
const s3op = (req) => req.headers.range !== undefined || !/list-type=2/.test(req.url) ? "s3:GetObject" : "s3:ListBucket";
const sample = { listBuckets: [], getBucket: ["example-site-logs"], listObjects: ["example-site-logs", "eu-west-1", {}],
  getObject: ["example-site-logs", "eu-west-1", "a/b.txt", [0, 9]] };
const checkCalls = async () => {
  for (const [m, args] of Object.entries(sample)) {
    calls.length = 0;
    await api[m](...args).then(() => assert.fail(m + " should reject on 403"), (e) => { assert.match(e.code, /^AccessDenied(Exception)?$/); assert.equal(e.status, 403); });
    assert.equal(calls.length, 1, m);
    const req = calls[0];
    const need = req.service === "s3" ? s3op(req) : target[req.headers["x-amz-target"].split(".").pop()];
    assert.ok(need.startsWith(service[req.service] + ":"), m);
    assert.deepEqual(byId[m]["x-aws-actions"], [need], m);
  }
};

test("Cloud Control operations say their handler permissions are pending", () => {
  for (const o of ops) if (o["x-aws-actions"].some(a => a.startsWith("cloudformation:")))
    assert.ok(o["x-aws-actions-pending"], o.operationId);
});

test("least-privilege union for S3Api", () => {
  const union = [...new Set(ops.flatMap(o => o["x-aws-actions"]))].sort();
  assert.deepEqual(union, ["cloudformation:GetResource", "cloudformation:ListResources", "s3:GetObject", "s3:ListBucket"]);
});

test("getObject documents 206 for a range and 416 InvalidRange past the end", () => {
  assert.ok(byId.getObject.responses["206"] && byId.getObject.responses["416"]);
  assert.ok(doc.components.schemas.AwsError.properties.code.examples.includes("InvalidRange"));
});

test("every $ref resolves", () => {
  const walk = v => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (k === "$ref") {
        const t = x.replace(/^#\//, "").split("/").reduce((o, p) => o && o[p], doc);
        assert.ok(t, "unresolved " + x);
      } else walk(x);
    }
  };
  walk(doc);
});

await checkCalls(); passed++; console.log("ok - each method's request needs exactly its listed actions, and errors carry code and status");
console.log(passed + " passed");
