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

// Least-privilege mode: the -access stack first.
ok((await create("sws-vault-" + ID + "-access", { VaultId: ID })).status === 200, "access stack created in the console");
let acc = await api.stack(R, "sws-vault-" + ID + "-access");
ok(acc.status === "CREATE_IN_PROGRESS" && acc.outputs.length === 0 && acc.arn.startsWith("arn:aws:cloudformation:" + R + ":" + ACCT + ":stack/sws-vault-" + ID + "-access/"), "stack(): in progress, no outputs yet, the customer's account");
twin.clock.tick(30 * 1000);
acc = await api.stack(R, acc.arn);
const role = (acc.outputs.find((o) => o.key === "DeployRoleArn") || {}).value;
ok(acc.status === "CREATE_COMPLETE" && role === "arn:aws:iam::" + ACCT + ":role/sws-vault-" + ID + "-deploy", "access stack complete; DeployRoleArn from its outputs");

// The Vault stack with that role; the page polls events() and stack().
ok((await create("sws-vault-" + ID, { VaultId: ID }, { RoleARN: role })).status === 200, "Vault stack created in the console");
const name = "sws-vault-" + ID;
const seen = [];
let last = 0, polls = 0, status = "";
for (let i = 0; i < 40 && status !== "CREATE_COMPLETE"; i++) {
  const ev = (await ctx.CfnApi.all((next) => api.events(R, name, { next }))).items;
  ok(ev.length >= last, "poll " + i + ": events only grow (" + last + " -> " + ev.length + ")");
  ok(ev.every((e, j) => j === 0 || e.time <= ev[j - 1].time), "poll " + i + ": newest first");
  seen.push(...ev.slice(0, ev.length - last).reverse());
  last = ev.length; polls++;
  status = (await api.stack(R, name)).status;
  twin.clock.tick(30 * 1000);
}
ok(status === "CREATE_COMPLETE" && polls > 5, "the stack completes after " + polls + " polls of 30 s");
ok(seen.length === last && new Set(seen.map((e) => e.id)).size === seen.length, "each event seen once across polls, with a unique id");
ok(seen[0].status === "CREATE_IN_PROGRESS" && seen[0].logicalId === name && seen[0].reason === "User Initiated", "first: the stack's own CREATE_IN_PROGRESS, User Initiated");
ok(seen[seen.length - 1].logicalId === name && seen[seen.length - 1].status === "CREATE_COMPLETE", "last: the stack's own CREATE_COMPLETE");
ok(seen.every((e) => e.stackArn === seen[0].stackArn && e.stackArn.startsWith("arn:aws:cloudformation:" + R + ":" + ACCT + ":stack/" + name + "/")), "every event carries the stack's ARN");
const dist = seen.filter((e) => e.logicalId === "VaultDistribution");
ok(dist.length >= 2 && dist[dist.length - 1].status === "CREATE_COMPLETE" && Date.parse(dist[dist.length - 1].time) - Date.parse(dist[0].time) >= 200 * 1000, "the distribution is the slow part (minutes)");

// On completion: the outputs the page and the next steps need.
const st = await api.stack(R, name), out = Object.fromEntries(st.outputs.map((o) => [o.key, o.value]));
ok(/^https:\/\/d[a-z0-9]{13}\.cloudfront\.net$/.test(out.Endpoint) && out.DeployCheck === out.Endpoint + "/health" && out.VaultId === ID && out.AccountId === ACCT && out.Region === R, "outputs: Endpoint, DeployCheck, VaultId, AccountId, Region");
ok(/^E[A-Z0-9]{13}$/.test(out.DistributionId) && /:secret:sws-vault-0a1b2c3d4e5f-token-/.test(out.TokenSecretArn), "outputs: DistributionId and the token's secret ARN (never the token)");
// resources(): the customer account in the twin does not answer ListStackResources yet (asked of dev.1.aws.a); the
// derived ARNs for these types are tested over the platform account in cfn-api.test.mjs.

// CfnApi only read.
ok(sent.every((a) => /^(List|Describe)/.test(a)), "CfnApi sent only reads: " + [...new Set(sent)].join(", "));

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (cfn deploy progress: " + passed + " checks; " + polls + " polls, " + seen.length + " events and the outputs of a twin Vault deploy through CfnApi)");
