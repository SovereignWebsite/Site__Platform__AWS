// Deploy plan step 4, teardown: DeleteStack in the customer's account. Resources go in reverse creation order (the DNS
// records before the distribution; nothing while something that refers to it remains), the bucket, its policy and the
// log group are kept (DELETE_SKIPPED: RetainExceptOnCreate on a later delete), the stack ends DELETE_COMPLETE and is
// then found by id only. A missing stack deletes quietly, a stack still being made refuses (the twin's rule), and in
// access-stack mode a Vault stack whose deploy role went first fails to delete.
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";

const START = "2026-11-24T09:00:00.000Z", ID = "0a1b2c3d4e5f", R = "eu-west-2", ACCT = "444455556666";
const CUST = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/" + R + "/cloudformation/aws4_request, SignedHeaders=host, Signature=twin" };
const cfn = async (twin, body) => { const r = await twin.handle("https://cloudformation." + R + ".amazonaws.com/", { method: "POST", headers: CUST, body: new URLSearchParams(body).toString() }); return { status: r.status, text: await r.text() }; };
const create = (twin, name, params, extra = {}) => {
  const b = { Action: "CreateStack", StackName: name, TemplateURL: "https://example.invalid/vault.yaml", "Capabilities.member.1": "CAPABILITY_NAMED_IAM", ...extra };
  Object.entries(params).forEach(([k, v], i) => { b["Parameters.member." + (i + 1) + ".ParameterKey"] = k; b["Parameters.member." + (i + 1) + ".ParameterValue"] = v; });
  return cfn(twin, b);
};
const tag = (t, name) => [...t.matchAll(new RegExp("<" + name + ">([^<]*)</" + name + ">", "g"))].map((m) => m[1]);
const events = async (twin, name) => { const t = (await cfn(twin, { Action: "DescribeStackEvents", StackName: name })).text;
  return [...t.matchAll(/<member>(.*?)<\/member>/gs)].map((m) => ({ logical: tag(m[1], "LogicalResourceId")[0], status: tag(m[1], "ResourceStatus")[0], t: tag(m[1], "Timestamp")[0] })).reverse(); };
const fresh = () => { const t = loadTwin("baseline"); t.clock.pause(); t.clock.at(START); return t; };
const V = "sws-vault-" + ID;
let checks = 0;

// 1. A Vault with a domain in this account's zone, made and then deleted.
const twin = fresh();
await create(twin, V, { VaultId: ID, DomainName: "vault.example.com", HostedZoneId: "Z0000000000EXAMPLE" });
twin.clock.tick(10 * 60 * 1000);
const stackId = tag((await cfn(twin, { Action: "DescribeStacks", StackName: V })).text, "StackId")[0];
assert.equal((await cfn(twin, { Action: "DeleteStack", StackName: V })).status, 200, "DeleteStack accepted");
assert.equal(tag((await cfn(twin, { Action: "DescribeStacks", StackName: V })).text, "StackStatus")[0], "DELETE_IN_PROGRESS");
assert.equal((await cfn(twin, { Action: "DeleteStack", StackName: V })).status, 200, "a second DeleteStack while deleting is a quiet success");
twin.clock.tick(15 * 60 * 1000);
const all = await events(twin, stackId), del = all.slice(all.findIndex((e) => e.logical === V && e.status === "DELETE_IN_PROGRESS"));
const doneAt = (l) => del.findIndex((e) => e.logical === l && /^DELETE_(COMPLETE|SKIPPED)$/.test(e.status));
["VaultRecordA", "VaultRecordAAAA"].forEach((r) => assert.ok(doneAt(r) >= 0 && doneAt(r) < doneAt("VaultDistribution"), r + " goes before the distribution"));
const REFS = { VaultBucketPolicy: ["VaultBucket"], VaultFunctionRole: ["VaultBucket", "AccessToken", "VaultLogs", "VaultBoundary"], VaultFunction: ["VaultFunctionRole", "AccessToken", "VaultLogs"],
  VaultFunctionUrl: ["VaultFunction"], VaultFunctionUrlPermission: ["VaultFunction"], VaultFunctionInvokePermission: ["VaultFunction"], VaultDistribution: ["VaultFunctionUrl", "HealthFunction"],
  VaultRecordA: ["VaultDistribution"], VaultRecordAAAA: ["VaultDistribution"] };
Object.entries(REFS).forEach(([from, tos]) => tos.forEach((to) => assert.ok(doneAt(from) < doneAt(to), from + " goes before " + to + ", which it refers to")));
const last = (l) => del.filter((e) => e.logical === l).pop().status;
["VaultBucket", "VaultBucketPolicy", "VaultLogs"].forEach((l) => assert.equal(last(l), "DELETE_SKIPPED", l + " is kept (RetainExceptOnCreate, on a later delete)"));
["VaultFunction", "VaultDistribution", "AccessToken", "VaultBoundary"].forEach((l) => assert.equal(last(l), "DELETE_COMPLETE", l + " is deleted"));
assert.equal(del[del.length - 1].logical, V); assert.equal(del[del.length - 1].status, "DELETE_COMPLETE", "the stack's own DELETE_COMPLETE is last");
const d0 = del.filter((e) => e.logical === "VaultDistribution");
assert.ok((Date.parse(d0[d0.length - 1].t) - Date.parse(d0[0].t)) / 1000 >= 200, "the distribution takes minutes to delete");
checks += 30; // 3 delete calls, 2 records, 15 references, 3 kept, 4 deleted, 2 for the stack, 1 for the distribution

// 2. After the delete: by name the stack is gone; by id it is DELETE_COMPLETE; ListStacks shows it; the name is free.
assert.match((await cfn(twin, { Action: "DescribeStacks", StackName: V })).text, /does not exist/, "by name, gone");
assert.equal(tag((await cfn(twin, { Action: "DescribeStacks", StackName: stackId })).text, "StackStatus")[0], "DELETE_COMPLETE", "by id, DELETE_COMPLETE");
assert.ok(!/sws-vault-/.test((await cfn(twin, { Action: "DescribeStacks" })).text), "DescribeStacks with no name leaves deleted stacks out");
assert.deepEqual(tag((await cfn(twin, { Action: "ListStacks", "StackStatusFilter.member.1": "DELETE_COMPLETE" })).text, "StackName"), [V], "ListStacks keeps it, filtered");
const kept = (await cfn(twin, { Action: "ListStackResources", StackName: stackId })).text;
assert.deepEqual(tag(kept, "ResourceStatus").filter((x) => x === "DELETE_SKIPPED").length, 3, "the three kept resources say so");
assert.equal((await create(twin, V, { VaultId: ID })).status, 200, "the name can be used again");
assert.notEqual(tag((await cfn(twin, { Action: "DescribeStacks", StackName: V })).text, "StackId")[0], stackId, "with a new stack id");
assert.equal((await cfn(twin, { Action: "DeleteStack", StackName: V })).status, 400, "a stack still being created refuses the delete (the twin's rule)");
assert.equal((await cfn(twin, { Action: "DeleteStack", StackName: "sws-vault-ffffffffffff" })).status, 200, "a missing stack deletes quietly, as AWS answers");
checks += 9;

// 3. A rolled-back stack deletes at once: nothing was left to delete.
{
  const t = fresh();
  await create(t, V, { VaultId: ID, ImageUri: "999999999999.dkr.ecr.eu-west-2.amazonaws.com/sws-vault@sha256:" + "f".repeat(64) });
  t.clock.tick(10 * 60 * 1000);
  await cfn(t, { Action: "DeleteStack", StackName: V }); t.clock.tick(10 * 1000);
  const e = await events(t, tag((await cfn(t, { Action: "ListStacks" })).text, "StackId")[0]);
  const after = e.slice(e.findIndex((x) => x.status === "DELETE_IN_PROGRESS" && x.logical === V));
  assert.deepEqual(after.map((x) => x.status), ["DELETE_IN_PROGRESS", "DELETE_COMPLETE"], "only the stack's own two steps");
  checks++;
}

// 4. Access-stack mode, the -access stack deleted first: the Vault stack's delete cannot assume its role.
{
  const t = fresh();
  const ROLE = "arn:aws:iam::" + ACCT + ":role/" + V + "-deploy";
  await create(t, V + "-access", { VaultId: ID }); t.clock.tick(30 * 1000);
  await create(t, V, { VaultId: ID, DeployMode: "access-stack" }, { RoleARN: ROLE }); t.clock.tick(10 * 60 * 1000);
  await cfn(t, { Action: "DeleteStack", StackName: V + "-access" }); t.clock.tick(2 * 60 * 1000);
  await cfn(t, { Action: "DeleteStack", StackName: V }); t.clock.tick(60 * 1000);
  const st = (await cfn(t, { Action: "DescribeStacks", StackName: V })).text;
  assert.equal(tag(st, "StackStatus")[0], "DELETE_FAILED", "the role went with the -access stack");
  assert.match((await cfn(t, { Action: "DescribeStackEvents", StackName: V })).text, /is invalid or cannot be assumed/);
  checks += 2;
}

// 5. The journal: the same whether the delete settles by one tick or by reads at random points.
{
  const run = async (reads) => {
    const t = fresh();
    await create(t, V, { VaultId: ID }); t.clock.tick(10 * 60 * 1000); await cfn(t, { Action: "DeleteStack", StackName: V });
    if (!reads) t.clock.tick(15 * 60 * 1000);
    else { let seed = 9; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let ms = 0; ms < 15 * 60 * 1000;) { const s = Math.min(Math.floor(rnd() * 50000) + 1, 15 * 60 * 1000 - ms); ms += s; t.clock.tick(s); if (rnd() < 0.5) await cfn(t, { Action: "ListStacks" }); } }
    return t.journal();
  };
  assert.deepEqual(await run(true), await run(false), "one tick and many ticks with reads give the same journal"); checks++;
}
console.log("OK (twin vault teardown: " + checks + " checks; reverse creation order, records before the distribution, nothing before what refers to it, bucket, policy and logs kept, found by id only after, rolled-back stack, the role gone first, one tick = many ticks with reads)");
