// CloudFrontApi and Graph.add.cloudfront over the twin's CloudFront reads (dev.1.aws.a 114ecf0; architect.aws.a design 06,
// sections 3 and 4), in both accounts: the platform account's demo distribution in front of the site bucket, and each
// Vault's distribution in the customer's account from when its stack's create settles until its delete settles. Plain
// objects, ApiAll paging over MaxItems and NextMarker (distributions on IsTruncated, functions on NextMarker alone), errors,
// isolation, and one graph node per distribution with CfnApi's derived node. Node 22, no network.
// Run: node test/api/cloudfront-twin.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadTwin } from "../twin/golden.mjs";

const START = "2026-11-24T09:00:00.000Z", R = "eu-west-2", ACCT = "444455556666", PLATFORM = "111122223333";
const CRED = (svc, region) => "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/" + region + "/" + svc + "/aws4_request, SignedHeaders=host, Signature=twin";
const twin = loadTwin("baseline");
twin.clock.pause(); twin.clock.at(START);

const ctx = { URLSearchParams, URL, Response, Headers, Promise, Error, TypeError, JSON, Object, Array, String, Number, RegExp, Math, Date, Map, Set,
  TextEncoder, TextDecoder, Uint8Array, console, encodeURIComponent, decodeURIComponent };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["api/all.js", "api/cfn-api.js", "api/cloudfront-api.js", "api/graph.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { CloudFrontApi, CfnApi, Graph, ApiAll } = ctx;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const plain = (v) => JSON.parse(JSON.stringify(v));

// The page's signed requests; the twin's customer credential stands in for the customer's signature, and no credential
// means the platform account's read role (as in test/twin/cloudfront.test.mjs).
const sender = (customer) => (req) => twin.handle(req.url, { method: req.method, headers: Object.assign({}, req.headers, customer ? { authorization: CRED(req.service, req.region) } : {}), body: req.body });
const plat = CloudFrontApi(sender(false), { account: PLATFORM }), cust = CloudFrontApi(sender(true), { account: ACCT });
const cfn = CfnApi(sender(true), { account: ACCT });
const create = (id, params = {}) => {
  const b = { Action: "CreateStack", Version: "2010-05-15", StackName: "sws-vault-" + id, TemplateURL: "https://example.invalid/vault.yaml", "Capabilities.member.1": "CAPABILITY_NAMED_IAM" };
  Object.entries({ VaultId: id, ...params }).forEach(([k, v], i) => { b["Parameters.member." + (i + 1) + ".ParameterKey"] = k; b["Parameters.member." + (i + 1) + ".ParameterValue"] = v; });
  return twin.handle("https://cloudformation." + R + ".amazonaws.com/", { method: "POST", headers: { authorization: CRED("cloudformation", R) }, body: new URLSearchParams(b).toString() });
};
const outputs = async (id) => Object.fromEntries((await cfn.stack(R, "sws-vault-" + id)).outputs.map((o) => [o.key, o.value]));
const rejects = async (p, test, m) => { try { await p; ok(false, m + ": did not reject"); } catch (e) { ok(test(e), m + ": " + e.message); } };
const j0 = twin.journal().length;

// 1. The platform account: one distribution, an S3 REST origin whose target is the site bucket, no functions.
let page = plain(await plat.distributions());
ok(page.next === null && page.items.length === 1, "one page, one distribution");
let d = page.items[0];
ok(d.id === "EDEMOTWIN00001" && d.arn === "arn:aws:cloudfront::" + PLATFORM + ":distribution/EDEMOTWIN00001" && d.domain === "d111111abcdef8.cloudfront.net", "its id, ARN (no region) and domain");
ok(JSON.stringify(d.aliases) === '["www.example.com"]' && d.enabled === true && d.status === "Deployed", "its alias, enabled, deployed");
ok(d.origins.length === 1 && d.origins[0].kind === "s3" && d.origins[0].target === "arn:aws:s3:::" + twin.buckets.site && d.origins[0].domain === twin.buckets.site + ".s3." + R + ".amazonaws.com", "its origin: the site bucket's REST endpoint, target the bucket's ARN");
ok(d.functions.length === 0, "no function associations");
const full = plain(await plat.distribution("EDEMOTWIN00001"));
ok(full.defaultRoot === "index.html" && full.logging === null && full.id === d.id && JSON.stringify(full.origins) === JSON.stringify(d.origins), "GetDistribution: index.html, legacy logging off, the same origins as the summary");
ok((await plat.functions()).items.length === 0 && (await plat.functions()).next === null, "no functions in the platform account");
await rejects(plat.distribution("ENOSUCHDIST001"), (e) => e.code === "NoSuchDistribution" && e.status === 404, "an unknown id is NoSuchDistribution, 404");
await rejects(plat.distribution("../function"), (e) => e instanceof TypeError, "a hostile id is refused before any request");

// 2. The customer account: nothing before a Vault; the -health function once wave 1 settles; the distribution once the create does.
ok((await cust.distributions()).items.length === 0, "no distributions before a Vault");
const A = "0a1b2c3d4e5f", HEALTH = "arn:aws:cloudfront::" + ACCT + ":function/sws-vault-" + A + "-health";
ok((await create(A, { DomainName: "vault.example.com", HostedZoneId: "Z0000000000EXAMPLE" })).status === 200, "the customer's console creates the Vault stack");
twin.clock.tick(60 * 1000);
let fns = plain((await cust.functions()).items);
ok(fns.length === 2 && fns.every((f) => f.name === "sws-vault-" + A + "-health" && f.arn === HEALTH && f.runtime === "cloudfront-js-2.0" && f.status === "UNASSOCIATED") && fns.map((f) => f.stage).join() === "DEVELOPMENT,LIVE", "the -health function at both stages, not yet associated");
ok((await cust.distributions()).items.length === 0, "the distribution is not listed while it is being made");
twin.clock.tick(10 * 60 * 1000);
const out = await outputs(A);
d = plain((await cust.distributions()).items)[0];
ok(d && d.id === out.DistributionId && d.arn === "arn:aws:cloudfront::" + ACCT + ":distribution/" + out.DistributionId, "listed once made, with the stack's DistributionId, in the customer's account");
ok("https://" + d.domain + "/health" === out.DeployCheck && JSON.stringify(d.aliases) === '["vault.example.com"]', "its domain is the DeployCheck's host; its alias the Vault's domain");
ok(d.origins.length === 1 && d.origins[0].kind === "lambda-url" && d.origins[0].target === null && d.origins[0].customHeaders.length === 0, "its origin is the Function URL: kind lambda-url, no target (never a guess), no custom headers");
ok(JSON.stringify(d.functions) === JSON.stringify([{ arn: HEALTH, event: "viewer-request", behaviour: "/health" }]), "the -health function on viewer-request for /health");
ok(plain((await cust.functions({ stage: "LIVE" })).items).map((f) => f.status).join() === "DEPLOYED", "LIVE is deployed once the distribution is");
await rejects(cust.functions({ stage: "PROD" }), (e) => e instanceof TypeError, "a stage other than DEVELOPMENT or LIVE is refused before any request");

// 3. Each account its own.
ok(plain((await plat.distributions()).items).map((x) => x.id).join() === "EDEMOTWIN00001", "the platform account does not see the Vault's distribution");
await rejects(plat.distribution(out.DistributionId), (e) => e.status === 404, "nor get it by id");
await rejects(cust.distribution("EDEMOTWIN00001"), (e) => e.status === 404, "the customer does not get the demo distribution");

// 4. Paging through ApiAll: distributions one at a time, functions two at a time; the opaque next is the twin's marker.
const B = "1b2c3d4e5f60", C = "2c3d4e5f6071";
await create(B); await create(C);
twin.clock.tick(10 * 60 * 1000);
const want = [out.DistributionId, (await outputs(B)).DistributionId, (await outputs(C)).DistributionId];
let pages = 0;
let all = await CloudFrontApi.all((next) => { pages++; return cust.distributions({ next, max: 1 }); });
ok(pages === 3 && !all.capped && plain(all.items).map((x) => x.id).join() === want.join(), "distributions: three pages of one, every one once, in order");
pages = 0;
all = await ApiAll((next) => { pages++; return cust.functions({ next, max: 2, stage: "DEVELOPMENT" }); });
ok(pages === 2 && plain(all.items).map((f) => f.name).join() === [A, B, C].map((x) => "sws-vault-" + x + "-health").join(), "functions: two pages on NextMarker alone");
all = await CloudFrontApi.all((next) => cust.distributions({ next, max: 1 }), { maxPages: 2 });
ok(all.capped && all.items.length === 2, "the page cap stops early and says so");

// 5. The graph: one node per distribution, merged with CfnApi's derived node for the stack's distribution.
const stacks = (await cfn.stacks(R)).items.filter((s) => s.name === "sws-vault-" + A);
for (const s of stacks) s.resources = (await cfn.resources(R, s.arn)).items;
const dist = await cust.distribution(out.DistributionId), functions = (await ApiAll((next) => cust.functions({ next }))).items;
const build = (order) => {
  const g = Graph({ account: ACCT, backend: "twin" });
  for (const step of order) { if (step === "cf") g.add.cloudfront({ distributions: [dist], functions }); if (step === "cfn") g.add.cfn({ stacks }); }
  return plain(g.toJSON());
};
const j = build(["cf", "cfn"]), DA = d.arn;
const node = (id) => j.nodes.find((n) => n.id === id), has = (f, rel, to) => j.edges.find((e) => e.from === f && e.rel === rel && e.to === to);
ok(stacks.length === 1 && stacks[0].resources.some((r) => r.type === "AWS::CloudFront::Distribution" && r.physicalId === out.DistributionId), "the Vault stack holds the distribution by its id");
ok(j.nodes.filter((n) => n.type === "distribution").length === 1 && node(DA) && node(DA).trust === "verified" && node(DA).distribution_id === out.DistributionId, "one distribution node, by its ARN, verified (the stack's resource and the API agree)");
ok(node(DA).label === d.domain && JSON.stringify(node(DA).origin_domains) === JSON.stringify([d.origins[0].domain]), "labelled by its domain; the Function URL kept as an attribute");
ok(!j.edges.some((e) => e.from === DA && e.rel === "serves_from"), "no serves_from for a Function URL origin");
const inv = has(DA, "invokes", HEALTH);
ok(inv && inv.evidence === "api" && node(HEALTH) && node(HEALTH).runtime === "cloudfront-js-2.0", "invokes the -health function, from the API");
ok(JSON.stringify(build(["cfn", "cf"]).nodes.map((n) => n.id).sort()) === JSON.stringify(j.nodes.map((n) => n.id).sort()), "the same nodes whichever adapter runs first");
const gp = Graph({ account: PLATFORM, backend: "twin" });
gp.add.cloudfront({ distributions: [full], functions: [] });
const jp = plain(gp.toJSON()), sf = jp.edges.find((e) => e.from === full.arn && e.rel === "serves_from" && e.to === "arn:aws:s3:::" + twin.buckets.site);
ok(sf && sf.evidence === "api" && sf.trust === "verified", "the platform's distribution serves_from the site bucket, api and verified");

// 6. Teardown: disabled and in progress while the stack deletes, gone once the delete settles.
await twin.handle("https://cloudformation." + R + ".amazonaws.com/", { method: "POST", headers: { authorization: CRED("cloudformation", R) }, body: new URLSearchParams({ Action: "DeleteStack", Version: "2010-05-15", StackName: "sws-vault-" + B }).toString() });
twin.clock.tick(30 * 1000);
const going = plain(await cust.distribution(want[1]));
ok(going.status === "InProgress" && going.enabled === false, "while its stack deletes: in progress and disabled");
twin.clock.tick(15 * 60 * 1000);
await rejects(cust.distribution(want[1]), (e) => e.code === "NoSuchDistribution", "gone once the delete settles");
ok(plain((await CloudFrontApi.all((next) => cust.distributions({ next }))).items).map((x) => x.id).join() === [want[0], want[2]].join(), "the list has the other two");

// 7. Reads write nothing.
ok(twin.journal().slice(j0).every((e) => /^cloudformation\./.test(e.op)), "no journal entry from a CloudFront or CloudFormation read");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (CloudFrontApi and Graph.add.cloudfront over the twin: " + passed + " checks; both accounts, paging, errors, isolation, one node per distribution, teardown)");
