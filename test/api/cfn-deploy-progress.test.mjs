// CfnApi over a Vault deploy in the twin's customer account (dev.1.aws.a 5ae7c07, plan step 4): what the deploy page's
// progress view reads (plan step 5, design 06 when a read role exists; viz.aws.a's stage). The customer creates the two
// stacks in their own console (the test does it on the twin directly); CfnApi only reads: events grow newest first as
// the twin clock moves, the stack's status follows, and the outputs appear on completion. Node 22, no network.
// Run: node test/api/cfn-deploy-progress.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadTwin } from "../twin/golden.mjs";

const START = "2026-11-24T09:00:00.000Z", ID = "0a1b2c3d4e5f", R = "eu-west-2", ACCT = "444455556666";
const CUST = "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/" + R + "/cloudformation/aws4_request, SignedHeaders=host, Signature=twin";
const twin = loadTwin("baseline");
twin.clock.pause(); twin.clock.at(START);

const ctx = { URLSearchParams, URL, Response, Promise, Error, TypeError, JSON, Object, Array, String, Number, RegExp, Math };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["api/all.js", "api/cfn-api.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const sent = [];
// The customer's own signed requests, as the page would send them with a read role in that account (V8 b); here the
// twin's customer credential stands in for the signature.
const send = (req) => { sent.push(new URLSearchParams(req.body).get("Action")); return twin.handle(req.url, { method: req.method, headers: Object.assign({}, req.headers, { authorization: CUST }), body: req.body }); };
const api = ctx.CfnApi(send, { account: ACCT });
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };

// The customer's console does the creates (not CfnApi, which only reads).
const create = (name, params, extra) => {
  const b = { Action: "CreateStack", Version: "2010-05-15", StackName: name, TemplateURL: "https://example.invalid/vault.yaml", "Capabilities.member.1": "CAPABILITY_NAMED_IAM", ...extra };
  Object.entries(params).forEach(([k, v], i) => { b["Parameters.member." + (i + 1) + ".ParameterKey"] = k; b["Parameters.member." + (i + 1) + ".ParameterValue"] = v; });
  return twin.handle("https://cloudformation." + R + ".amazonaws.com/", { method: "POST", headers: { authorization: CUST }, body: new URLSearchParams(b).toString() });
};

// One deploy, followed as the page would: create in the console (the test), then poll events() and stack() every 30 s
// of twin clock until the stack completes, then read its outputs and resources.
async function follow(id, mode) {
  const name = "sws-vault-" + id, params = { VaultId: id, DeployMode: mode };
  let role;
  if (mode === "access-stack") {
    // Least-privilege mode (screen 2-alt): the -access stack first, its DeployRoleArn the Vault stack's role.
    ok((await create(name + "-access", { VaultId: id })).status === 200, mode + ": access stack created in the console");
    let acc = await api.stack(R, name + "-access");
    ok(acc.status === "CREATE_IN_PROGRESS" && acc.outputs.length === 0 && acc.arn.startsWith("arn:aws:cloudformation:" + R + ":" + ACCT + ":stack/" + name + "-access/"), mode + ": stack() in progress, no outputs yet, the customer's account");
    twin.clock.tick(30 * 1000);
    acc = await api.stack(R, acc.arn);
    role = (acc.outputs.find((o) => o.key === "DeployRoleArn") || {}).value;
    ok(acc.status === "CREATE_COMPLETE" && role === "arn:aws:iam::" + ACCT + ":role/" + name + "-deploy", mode + ": access stack complete; DeployRoleArn from its outputs");
  }
  ok((await create(name, params, role ? { RoleARN: role } : {})).status === 200, mode + ": Vault stack created in the console");
  const seen = [];
  let last = 0, polls = 0, status = "";
  for (let i = 0; i < 40 && !/_COMPLETE$|_FAILED$/.test(status); i++) {
    const ev = (await ctx.CfnApi.all((next) => api.events(R, name, { next }))).items;
    ok(ev.length >= last && ev.every((e, j) => j === 0 || e.time <= ev[j - 1].time), mode + " poll " + i + ": events only grow, newest first (" + last + " -> " + ev.length + ")");
    seen.push(...ev.slice(0, ev.length - last).reverse());
    last = ev.length; polls++;
    status = (await api.stack(R, name)).status;
    twin.clock.tick(30 * 1000);
  }
  ok(status === "CREATE_COMPLETE" && polls > 5, mode + ": the stack completes after " + polls + " polls of 30 s (" + status + ")");
  ok(seen.length === last && new Set(seen.map((e) => e.id)).size === seen.length, mode + ": each event seen once across polls, with a unique id");
  ok(seen[0].status === "CREATE_IN_PROGRESS" && seen[0].logicalId === name && seen[0].reason === "User Initiated", mode + ": first, the stack's own CREATE_IN_PROGRESS, User Initiated");
  ok(seen[seen.length - 1].logicalId === name && seen[seen.length - 1].status === "CREATE_COMPLETE", mode + ": last, the stack's own CREATE_COMPLETE");
  ok(seen.every((e) => e.stackArn === seen[0].stackArn && e.stackArn.startsWith("arn:aws:cloudformation:" + R + ":" + ACCT + ":stack/" + name + "/")), mode + ": every event carries the stack's ARN");
  const dist = seen.filter((e) => e.logicalId === "VaultDistribution");
  ok(dist.length >= 2 && dist[dist.length - 1].status === "CREATE_COMPLETE" && Date.parse(dist[dist.length - 1].time) - Date.parse(dist[0].time) >= 200 * 1000, mode + ": the distribution is the slow part (minutes)");
  // On completion: the outputs the page and the next steps need.
  const st = await api.stack(R, name), out = Object.fromEntries(st.outputs.map((o) => [o.key, o.value]));
  ok(/^https:\/\/d[a-z0-9]{13}\.cloudfront\.net$/.test(out.Endpoint) && out.DeployCheck === out.Endpoint + "/health" && out.VaultId === id && out.AccountId === ACCT && out.Region === R && out.DeployMode === mode, mode + ": outputs Endpoint, DeployCheck, VaultId, AccountId, Region, DeployMode");
  ok(/^E[A-Z0-9]{13}$/.test(out.DistributionId) && new RegExp(":secret:" + name + "-token-").test(out.TokenSecretArn), mode + ": outputs DistributionId and the token's secret ARN (never the token)");
  // What was made, with ids to join on (ListStackResources in the customer account, dev.1.aws.a f128c69).
  const res = (await ctx.CfnApi.all((next) => api.resources(R, st.arn, { next }))).items;
  const bucket = res.find((r) => r.type === "AWS::S3::Bucket"), fn = res.find((r) => r.type === "AWS::Lambda::Function"), cf = res.find((r) => r.type === "AWS::CloudFront::Distribution");
  ok(bucket && bucket.arn === "arn:aws:s3:::" + bucket.physicalId && bucket.arnDerived && bucket.physicalId === out.BucketName, mode + ": the bucket, its derived ARN and the BucketName output agree");
  ok(fn && fn.arn === (fn.physicalId.startsWith("arn:") ? fn.physicalId : "arn:aws:lambda:" + R + ":" + ACCT + ":function:" + fn.physicalId), mode + ": the function's ARN in the customer's account");
  ok(cf && cf.physicalId === out.DistributionId && cf.arn === "arn:aws:cloudfront::" + ACCT + ":distribution/" + out.DistributionId, mode + ": the distribution matches the DistributionId output");
  ok(res.every((r) => r.status === "CREATE_COMPLETE" && r.arn), mode + ": every resource complete, each with an id to join on");
  const boundary = res.filter((r) => r.logicalId === "VaultBoundary");
  ok(mode === "one-stack" ? boundary.length === 1 : boundary.length === 0, mode + ": the boundary is " + (mode === "one-stack" ? "made by this stack" : "the access stack's"));
  return { polls, events: seen.length };
}

const lp = await follow(ID, "access-stack");
const one = await follow("0f1e2d3c4b5a", "one-stack");
// A failed deploy: an image the twin has not published makes VaultFunction fail; the stack rolls back with no outputs.
{
  const id = "1a2b3c4d5e6f", name = "sws-vault-" + id;
  ok((await create(name, { VaultId: id, DeployMode: "one-stack", ImageUri: "123456789012.dkr.ecr.eu-west-2.amazonaws.com/other@sha256:" + "0".repeat(64) })).status === 200, "failed deploy: created in the console");
  let status = "", i = 0;
  for (; i < 40 && !/_COMPLETE$|_FAILED$/.test(status); i++) { status = (await api.stack(R, name)).status; twin.clock.tick(30 * 1000); }
  const st = await api.stack(R, name), ev = (await ctx.CfnApi.all((next) => api.events(R, name, { next }))).items;
  const failed = ev.find((e) => e.status === "CREATE_FAILED");
  ok(st.status === "ROLLBACK_COMPLETE" && st.outputs.length === 0, "failed deploy: ROLLBACK_COMPLETE, no outputs (" + st.status + ")");
  ok(failed && failed.logicalId === "VaultFunction" && failed.reason && failed.stackArn === st.arn, "failed deploy: the first failure is VaultFunction, with its reason: " + (failed && failed.reason));
  ok(ev[0].logicalId === name && ev[0].status === "ROLLBACK_COMPLETE", "failed deploy: the newest event is the stack's ROLLBACK_COMPLETE");
  const rolled = (await ctx.CfnApi.all((next) => api.resources(R, st.arn, { next }))).items;
  // Every resource made before the failure is deleted: the bucket, its policy and the log group are RetainExceptOnCreate
  // in vault.yaml 0.4.7 (deleted when the creating operation rolls back: AWS's DeletionPolicy page, boto3.aws.a note 13).
  ok(rolled.length > 0 && rolled.every((r) => r.status === "DELETE_COMPLETE"), "failed deploy: every resource deleted by the rollback, the Retain-except-on-create bucket included: " + [...new Set(rolled.map((r) => r.status))].join(", "));
}

// The page finds a customer's Vault stacks with stacks() (ListStacks, newest first in the twin).
const listed = (await ctx.CfnApi.all((next) => api.stacks(R, { next }))).items;
ok(JSON.stringify(listed.map((x) => x.name).sort()) === JSON.stringify(["sws-vault-0a1b2c3d4e5f", "sws-vault-0a1b2c3d4e5f-access", "sws-vault-0f1e2d3c4b5a", "sws-vault-1a2b3c4d5e6f"]), "stacks(): the customer's four stacks " + listed.map((x) => x.name));
ok(listed.every((x) => x.arn.startsWith("arn:aws:cloudformation:" + R + ":" + ACCT + ":stack/" + x.name + "/") && x.created && x.status), "stacks(): each with its ARN, created and status");
ok(listed.find((x) => x.name === "sws-vault-1a2b3c4d5e6f").status === "ROLLBACK_COMPLETE", "stacks(): the failed one shows ROLLBACK_COMPLETE");

// Teardown (the page's "Remove this Vault" points the customer to DeleteStack in their console; dev.1.aws.a c5357c2).
// CfnApi follows it: events newest first until DELETE_COMPLETE, the retained data kept (DELETE_SKIPPED), and the
// stack then gone from stacks() unless deleted is asked for, while stack(arn) still answers DELETE_COMPLETE.
{
  const name = "sws-vault-0f1e2d3c4b5a", arn = (await api.stack(R, name)).arn;
  const del = await twin.handle("https://cloudformation." + R + ".amazonaws.com/", { method: "POST", headers: { authorization: CUST }, body: new URLSearchParams({ Action: "DeleteStack", Version: "2010-05-15", StackName: name }).toString() });
  ok(del.status === 200, "teardown: DeleteStack in the console");
  let status = "", i = 0;
  for (; i < 40 && status !== "DELETE_COMPLETE"; i++) { status = (await api.stack(R, arn)).status; twin.clock.tick(30 * 1000); }
  ok(status === "DELETE_COMPLETE", "teardown: stack(arn) follows it to DELETE_COMPLETE after " + i + " polls");
  const ev = (await ctx.CfnApi.all((next) => api.events(R, arn, { next }))).items;
  ok(ev[0].logicalId === name && ev[0].status === "DELETE_COMPLETE", "teardown: newest event is the stack's DELETE_COMPLETE");
  const skipped = ev.filter((e) => e.status === "DELETE_SKIPPED").map((e) => e.logicalId).sort();
  ok(JSON.stringify(skipped) === JSON.stringify(["VaultBucket", "VaultBucketPolicy", "VaultLogs"]), "teardown: the data, its policy and the logs stay with the customer (DELETE_SKIPPED): " + skipped);
  let gone = null; try { await api.stack(R, name); } catch (e) { gone = e; }
  ok(gone && gone.code === "ValidationError" && /does not exist/.test(gone.message), "teardown: by name the stack no longer exists");
  const live = (await ctx.CfnApi.all((next) => api.stacks(R, { next }))).items.map((x) => x.name);
  const all = (await ctx.CfnApi.all((next) => api.stacks(R, { next, deleted: true }))).items;
  ok(!live.includes(name) && all.some((x) => x.name === name && x.status === "DELETE_COMPLETE"), "teardown: stacks() leaves it out; stacks({ deleted: true }) shows it DELETE_COMPLETE");
}

// CfnApi only read.
ok(sent.every((a) => /^(List|Describe)/.test(a)), "CfnApi sent only reads: " + [...new Set(sent)].join(", "));

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (cfn deploy progress: " + passed + " checks; least-privilege " + lp.polls + " polls and " + lp.events + " events, one-stack " + one.polls + " polls and " + one.events + " events; outputs and resources of twin Vault deploys through CfnApi)");
