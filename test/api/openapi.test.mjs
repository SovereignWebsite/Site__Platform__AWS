// The S3Api contract (site/api/s3.openapi.json): operation IDs match design 01's method names,
// every operation states its IAM actions, change operations need Approve, every $ref resolves.
// If site/api/s3-api.js is present, its methods and the contract must match one for one.
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const root = new URL("../../", import.meta.url);
const doc = JSON.parse(readFileSync(new URL("site/api/s3.openapi.json", root), "utf8"));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const ops = [];
for (const [path, item] of Object.entries(doc.paths))
  for (const [method, op] of Object.entries(item)) ops.push({ path, method, ...op });

const designMethods = ["listBuckets", "getBucket", "listObjects", "getObject", "planCors", "applyPlan"];

test("OpenAPI 3.1 with no server", () => {
  assert.equal(doc.openapi, "3.1.0");
  assert.deepEqual(doc.servers, []);
});

test("operation IDs are exactly design 01's S3Api methods", () => {
  assert.deepEqual(ops.map(o => o.operationId).sort(), [...designMethods].sort());
});

test("every operation lists x-aws-actions as service:Action strings", () => {
  for (const o of ops) {
    assert.ok(Array.isArray(o["x-aws-actions"]), o.operationId);
    for (const a of o["x-aws-actions"]) assert.match(a, /^[a-z0-9-]+:[A-Z][A-Za-z0-9]+$/, o.operationId + " " + a);
  }
});

test("object operations need exactly s3:ListBucket and s3:GetObject", () => {
  const by = Object.fromEntries(ops.map(o => [o.operationId, o]));
  assert.deepEqual(by.listObjects["x-aws-actions"], ["s3:ListBucket"]);
  assert.deepEqual(by.getObject["x-aws-actions"], ["s3:GetObject"]);
});

test("getObject documents 206 for a range and 416 InvalidRange past the end", () => {
  const g = ops.find(o => o.operationId === "getObject");
  assert.ok(g.responses["206"] && g.responses["416"]);
  assert.ok(doc.components.schemas.AwsError.properties.code.examples.includes("InvalidRange"));
});

test("only applyPlan changes anything, and it needs Approve", () => {
  for (const o of ops) {
    assert.ok(["read", "change"].includes(o["x-role"]), o.operationId);
    if (o["x-role"] === "change") { assert.equal(o.operationId, "applyPlan"); assert.equal(o["x-needs-approve"], true); }
    else assert.ok(!o["x-aws-actions"].some(a => /:(Update|Put|Delete|Create)/.test(a)), o.operationId);
  }
});

test("Cloud Control operations say their handler permissions are pending", () => {
  for (const o of ops) if (o["x-aws-actions"].some(a => a.startsWith("cloudformation:")))
    assert.ok(o["x-aws-actions-pending"], o.operationId);
});

test("least-privilege union is sorted and unique", () => {
  const union = [...new Set(ops.flatMap(o => o["x-aws-actions"]))].sort();
  assert.deepEqual(union, ["cloudformation:GetResource", "cloudformation:GetResourceRequestStatus",
    "cloudformation:ListResources", "cloudformation:UpdateResource", "s3:GetObject", "s3:ListBucket"]);
});

test("every $ref resolves", () => {
  const walk = v => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (k === "$ref") {
        const target = x.replace(/^#\//, "").split("/").reduce((o, p) => o && o[p], doc);
        assert.ok(target, "unresolved " + x);
      } else walk(x);
    }
  };
  walk(doc);
});

const api = new URL("site/api/s3-api.js", root);
test("S3Api methods match the contract (when s3-api.js is present)", () => {
  if (!existsSync(api)) return console.log("  (skipped: site/api/s3-api.js not on this branch yet)");
  const src = readFileSync(api, "utf8");
  for (const m of designMethods) assert.match(src, new RegExp("\\b" + m + "\\s*[:(=]"), "S3Api lacks " + m);
});

console.log(passed + " passed");
