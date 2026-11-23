// Deploy plan step 4, first slice: the customer's account in the twin. The -access stack (iam.aws.a's vault-access
// 0.1.1) makes the deploy role; sws-vault-<id> (cloudformation.aws.a's Vault stack 0.3.3) is created with it; its
// resources appear wave by wave on the twin clock, the distribution slowest, and the stack completes last with its
// outputs. CreateStack refuses what CloudFormation refuses; the journal is the same whichever reads happen.
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";

const START = "2026-11-24T09:00:00.000Z", ID = "0a1b2c3d4e5f", R = "eu-west-2", ACCT = "444455556666";
const CUST = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/" + R + "/cloudformation/aws4_request, SignedHeaders=host, Signature=twin" };
const READ = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/" + R + "/cloudformation/aws4_request, SignedHeaders=host, Signature=twin" };
const cfn = async (twin, body, h = CUST) => { const r = await twin.handle("https://cloudformation." + R + ".amazonaws.com/", { method: "POST", headers: h, body: new URLSearchParams(body).toString() }); return { status: r.status, text: await r.text() }; };
const create = (twin, name, params, extra = {}) => {
  const b = { Action: "CreateStack", StackName: name, TemplateURL: "https://example.invalid/vault.yaml", "Capabilities.member.1": "CAPABILITY_NAMED_IAM", ...extra };
  Object.entries(params).forEach(([k, v], i) => { b["Parameters.member." + (i + 1) + ".ParameterKey"] = k; b["Parameters.member." + (i + 1) + ".ParameterValue"] = v; });
  return cfn(twin, b);
};
const tag = (t, name) => [...t.matchAll(new RegExp("<" + name + ">([^<]*)</" + name + ">", "g"))].map((m) => m[1]);
const events = async (twin, name) => { const t = (await cfn(twin, { Action: "DescribeStackEvents", StackName: name })).text;
  return [...t.matchAll(/<member>(.*?)<\/member>/gs)].map((m) => ({ logical: tag(m[1], "LogicalResourceId")[0], status: tag(m[1], "ResourceStatus")[0], t: tag(m[1], "Timestamp")[0] })).reverse(); };
const outputs = async (twin, name) => { const t = (await cfn(twin, { Action: "DescribeStacks", StackName: name })).text;
  const k = tag(t, "OutputKey"), v = tag(t, "OutputValue"); return { status: tag(t, "StackStatus")[0], out: Object.fromEntries(k.map((x, i) => [x, v[i]])) }; };
const fresh = () => { const t = loadTwin("baseline"); t.clock.pause(); t.clock.at(START); return t; };
const ROLE = "arn:aws:iam::" + ACCT + ":role/sws-vault-" + ID + "-deploy";
let checks = 0;

// 1. Refusals: the Vault stack needs the access stack's deploy role; IAM needs the capability; names are Vault names.
{
  const twin = fresh();
  let r = await create(twin, "sws-vault-" + ID, { VaultId: ID }, { RoleARN: ROLE });
  assert.equal(r.status, 400); assert.match(r.text, /<Code>ValidationError<\/Code>.*is invalid or cannot be assumed/s, "no access stack yet: the role cannot be assumed");
  r = await cfn(twin, { Action: "CreateStack", StackName: "sws-vault-" + ID + "-access", TemplateURL: "x", "Parameters.member.1.ParameterKey": "VaultId", "Parameters.member.1.ParameterValue": ID });
  assert.match(r.text, /InsufficientCapabilitiesException.*CAPABILITY_NAMED_IAM/s, "named IAM needs the capability");
  r = await create(twin, "my-stack", { VaultId: ID }); assert.match(r.text, /ValidationError/, "only Vault stacks in the customer's twin account");
  r = await create(twin, "sws-vault-" + ID + "-access", { VaultId: "ffffffffffff" }); assert.match(r.text, /Parameter 'VaultId' must be/, "VaultId matches the name");
  checks += 5;
}

// 2. The access stack, then the Vault stack with its role: waves in order, the distribution slowest, the stack last.
const twin = fresh();
let r = await create(twin, "sws-vault-" + ID + "-access", { VaultId: ID });
assert.equal(r.status, 200); assert.match(r.text, /<StackId>arn:aws:cloudformation:eu-west-2:444455556666:stack\/sws-vault-0a1b2c3d4e5f-access\//);
assert.deepEqual((await events(twin, "sws-vault-" + ID + "-access")).map((e) => e.status), ["CREATE_IN_PROGRESS"], "only User Initiated until the clock moves");
assert.equal((await outputs(twin, "sws-vault-" + ID + "-access")).status, "CREATE_IN_PROGRESS");
r = await create(twin, "sws-vault-" + ID, { VaultId: ID }, { RoleARN: ROLE });
assert.match(r.text, /cannot be assumed/, "the access stack must be complete first");
twin.clock.tick(30 * 1000);
const acc = await outputs(twin, "sws-vault-" + ID + "-access");
assert.equal(acc.status, "CREATE_COMPLETE"); assert.equal(acc.out.DeployRoleArn, ROLE); assert.match(acc.out.BoundaryArn, /:policy\/sws-vault-0a1b2c3d4e5f-boundary$/);
checks += 7;

r = await create(twin, "sws-vault-" + ID, { VaultId: ID, DomainName: "vault.example.com", HostedZoneId: "Z0000000000EXAMPLE" }, { RoleARN: ROLE });
assert.equal(r.status, 200, "created with the deploy role");
assert.match((await create(twin, "sws-vault-" + ID, { VaultId: ID }, { RoleARN: ROLE })).text, /AlreadyExistsException/, "a second create is refused");
twin.clock.tick(60 * 1000);
let ev = await events(twin, "sws-vault-" + ID);
assert.ok(ev.some((e) => e.logical === "VaultFunctionUrl" && e.status === "CREATE_COMPLETE"), "a minute in, the function URL is made");
assert.ok(!ev.some((e) => e.logical === "VaultDistribution" && e.status === "CREATE_COMPLETE"), "the distribution is still being made");
assert.equal((await outputs(twin, "sws-vault-" + ID)).status, "CREATE_IN_PROGRESS");
twin.clock.tick(10 * 60 * 1000);
ev = await events(twin, "sws-vault-" + ID);
const done = (l) => ev.findIndex((e) => e.logical === l && e.status === "CREATE_COMPLETE");
const order = ["VaultBucket", "VaultBucketPolicy", "VaultFunctionRole", "VaultFunction", "VaultFunctionUrl", "VaultFunctionInvokePermission", "VaultDistribution", "VaultRecordA", "sws-vault-" + ID];
order.forEach((l) => assert.ok(done(l) >= 0, l + " completes"));
order.slice(1).forEach((l, i) => { if (!/Policy|InvokePermission/.test(l)) assert.ok(done(l) > done(order[i]), l + " after " + order[i]); });
assert.equal(ev[ev.length - 1].logical, "sws-vault-" + ID, "the stack's own CREATE_COMPLETE is last");
const dist = ev.filter((e) => e.logical === "VaultDistribution"), took = (Date.parse(dist[dist.length - 1].t) - Date.parse(dist[0].t)) / 1000;
assert.ok(took >= 200, "the distribution takes minutes (" + took + " s)");
assert.ok(ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t), "events in time order");
const v = await outputs(twin, "sws-vault-" + ID);
assert.equal(v.status, "CREATE_COMPLETE");
assert.deepEqual(Object.keys(v.out).sort(), ["AccountId", "BucketName", "DeployCheck", "DistributionId", "Endpoint", "HealthCheck", "Region", "TemplateVersion", "TokenSecretArn", "VaultId"], "the ten outputs (no DnsRecords: the zone is in this account)");
assert.equal(v.out.Endpoint, "https://vault.example.com"); assert.match(v.out.DeployCheck, /^https:\/\/d[a-z0-9]{13}\.cloudfront\.net\/health$/);
assert.equal(v.out.BucketName, "sws-vault-0a1b2c3d4e5f-data-444455556666-eu-west-2"); assert.equal(v.out.TemplateVersion, "0.3.3");
assert.match(v.out.DistributionId, /^E[A-Z0-9]{13}$/); assert.match(v.out.TokenSecretArn, /:secret:sws-vault-0a1b2c3d4e5f-token-[A-Za-z]{6}$/);
checks += 22;

// 3. DNS elsewhere: no records made, a DnsRecords output; no domain: no records, the CloudFront address is the endpoint.
{
  const t2 = fresh();
  await create(t2, "sws-vault-" + ID + "-access", { VaultId: ID }); t2.clock.tick(30 * 1000);
  await create(t2, "sws-vault-" + ID, { VaultId: ID, DomainName: "vault.example.org" }, { RoleARN: ROLE }); t2.clock.tick(10 * 60 * 1000);
  const o = await outputs(t2, "sws-vault-" + ID), e2 = await events(t2, "sws-vault-" + ID);
  assert.match(o.out.DnsRecords, /^vault\.example\.org CNAME d[a-z0-9]{13}\.cloudfront\.net$/, "DnsRecords gives the CNAME to make");
  assert.ok(!e2.some((e) => /^VaultRecord/.test(e.logical)), "no record sets without a zone");
  checks += 2;
}

// 4. The platform's credentials see the platform's stack, not the customer's.
{
  const t = (await cfn(twin, { Action: "DescribeStacks" }, READ)).text;
  assert.ok(!/sws-vault-/.test(t), "the customer's stacks are not in the platform account"); checks++;
}

// 5. The journal: the live world is the refold; one tick and reads at random points give the same journal.
{
  const strip = (w) => JSON.parse(JSON.stringify(w.accounts));
  const j = twin.journal();
  assert.deepEqual(strip(twin.fold(j)), strip(twin.fold(twin.journal())), "refold is stable");
  const a = fresh(), b = fresh();
  for (const t of [a, b]) { await create(t, "sws-vault-" + ID + "-access", { VaultId: ID }); t.clock.tick(30 * 1000); await create(t, "sws-vault-" + ID, { VaultId: ID }, { RoleARN: ROLE }); }
  a.clock.tick(10 * 60 * 1000);
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let ms = 0; ms < 10 * 60 * 1000;) { const s = Math.floor(rnd() * 40000) + 1; ms += s; b.clock.tick(Math.min(s, 10 * 60 * 1000 - ms + s)); if (rnd() < 0.5) await events(b, "sws-vault-" + ID); }
  assert.deepEqual(b.journal(), a.journal(), "one tick and many ticks with reads give the same journal");
  assert.ok(a.journal().filter((e) => e.op === "cloudformation.stackEvent").every((e) => e.actor === "aws:cloudformation" && e.settles), "the stack's steps are CloudFormation's, settled by the clock");
  checks += 3;
}
console.log("OK (twin vault deploy: " + checks + " checks; access stack then the Vault stack with its role, waves in order on the clock, the distribution slowest, outputs on completion, refusals, DNS elsewhere, accounts apart, one tick = many ticks with reads)");
