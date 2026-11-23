// Design 06 section 4: the twin's CloudFront reads (ListDistributions, GetDistribution, ListFunctions), each from the
// caller's account's world. The platform account has the demo site's distribution; the customer account has each Vault
// stack's from when its create settles until its delete settles, with the Function URL origin and the -health function
// on viewer-request for /health. Reads write nothing to the journal, and one account never sees another's.
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";

const START = "2026-11-24T09:00:00.000Z", R = "eu-west-2", ACCT = "444455556666", PLATFORM = "111122223333";
const CUST = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/us-east-1/cloudfront/aws4_request, SignedHeaders=host, Signature=twin" };
const CUST_CFN = { authorization: CUST.authorization.replace("us-east-1/cloudfront", R + "/cloudformation") };
const CF = "https://cloudfront.amazonaws.com/2020-05-31/";
const cf = async (twin, path, headers = {}, method = "GET") => { const r = await twin.handle(CF + path, { method, headers }); return { status: r.status, etag: r.headers.get("etag"), text: await r.text() }; };
const cfn = async (twin, body) => { const r = await twin.handle("https://cloudformation." + R + ".amazonaws.com/", { method: "POST", headers: CUST_CFN, body: new URLSearchParams(body).toString() }); return { status: r.status, text: await r.text() }; };
const create = (twin, id, params = {}) => {
  const b = { Action: "CreateStack", StackName: "sws-vault-" + id, TemplateURL: "https://example.invalid/vault.yaml", "Capabilities.member.1": "CAPABILITY_NAMED_IAM" };
  Object.entries({ VaultId: id, ...params }).forEach(([k, v], i) => { b["Parameters.member." + (i + 1) + ".ParameterKey"] = k; b["Parameters.member." + (i + 1) + ".ParameterValue"] = v; });
  return cfn(twin, b);
};
const tag = (t, name) => [...t.matchAll(new RegExp("<" + name + ">([^<]*)</" + name + ">", "g"))].map((m) => m[1]);
const dids = (t) => [...t.matchAll(/<DistributionSummary><Id>([^<]*)<\/Id>/g)].map((m) => m[1]);
const outputs = async (twin, id) => { const t = (await cfn(twin, { Action: "DescribeStacks", StackName: "sws-vault-" + id })).text;
  const k = tag(t, "OutputKey"), v = tag(t, "OutputValue"); return Object.fromEntries(k.map((x, i) => [x, v[i]])); };
const fresh = () => { const t = loadTwin("baseline"); t.clock.pause(); t.clock.at(START); return t; };
let checks = 0;

// 1. The platform account: the demo site's distribution, in front of the site bucket's REST endpoint; no functions.
const twin = fresh(), j0 = twin.journal().length;
let r = await cf(twin, "distribution");
assert.equal(r.status, 200);
assert.deepEqual(dids(r.text), ["EDEMOTWIN00001"], "one distribution: the demo site's");
assert.deepEqual(tag(r.text, "ARN"), ["arn:aws:cloudfront::" + PLATFORM + ":distribution/EDEMOTWIN00001"], "its ARN, no region");
assert.deepEqual(tag(r.text, "CNAME"), ["www.example.com"], "the www alias from demo-dns");
assert.deepEqual(tag(r.text, "DomainName"), ["d111111abcdef8.cloudfront.net", twin.buckets.site + ".s3." + R + ".amazonaws.com"], "its domain, then its origin's");
assert.equal(tag(r.text, "IsTruncated")[0], "false"); assert.equal(tag(r.text, "NextMarker").length, 0, "no NextMarker on the last page");
r = await cf(twin, "distribution/EDEMOTWIN00001");
assert.equal(r.status, 200); assert.ok(r.etag, "GetDistribution gives an ETag");
assert.equal(tag(r.text, "DefaultRootObject")[0], "index.html");
assert.match(r.text, /<Logging><Enabled>false<\/Enabled>/, "legacy logging off (its logs go through Firehose)");
assert.equal(tag(r.text, "FunctionARN").length, 0, "no functions on the demo distribution");
r = await cf(twin, "distribution/ENOSUCHDIST001");
assert.equal(r.status, 404); assert.equal(tag(r.text, "Code")[0], "NoSuchDistribution");
r = await cf(twin, "function");
assert.equal(r.status, 200); assert.equal(tag(r.text, "Quantity")[0], "0", "no functions in the platform account"); assert.ok(!/IsTruncated/.test(r.text), "FunctionList has no IsTruncated");
checks += 17;

// 2. The customer account: nothing before a Vault; its function once wave 1 settles; its distribution once its create does.
assert.equal(tag((await cf(twin, "distribution", CUST)).text, "Quantity")[0], "0", "no distributions before a Vault");
const A = "0a1b2c3d4e5f";
await create(twin, A, { DomainName: "vault.example.com", HostedZoneId: "Z0000000000EXAMPLE" });
twin.clock.tick(60 * 1000);
r = await cf(twin, "function", CUST);
assert.deepEqual(tag(r.text, "Name"), ["sws-vault-" + A + "-health", "sws-vault-" + A + "-health"], "the -health function, at both stages (published)");
assert.deepEqual(tag(r.text, "Stage"), ["DEVELOPMENT", "LIVE"]); assert.deepEqual(tag(r.text, "Runtime"), ["cloudfront-js-2.0", "cloudfront-js-2.0"]);
assert.deepEqual(tag(r.text, "Status"), ["UNASSOCIATED", "UNASSOCIATED"], "not yet on a distribution");
assert.equal(tag((await cf(twin, "distribution", CUST)).text, "Quantity")[0], "0", "the distribution is not listed while it is being made");
twin.clock.tick(10 * 60 * 1000);
const out = await outputs(twin, A);
r = await cf(twin, "distribution", CUST);
assert.deepEqual(dids(r.text), [out.DistributionId], "listed once made, with the stack's DistributionId");
assert.deepEqual(tag(r.text, "ARN"), ["arn:aws:cloudfront::" + ACCT + ":distribution/" + out.DistributionId]);
assert.equal(tag(r.text, "Status")[0], "Deployed"); assert.equal(tag(r.text, "Enabled")[0], "true");
assert.deepEqual(tag(r.text, "CNAME"), ["vault.example.com"], "its alias is the Vault's domain");
const doms = tag(r.text, "DomainName");
assert.equal("https://" + doms[0] + "/health", out.DeployCheck, "its domain is the DeployCheck's host");
assert.match(doms[1], /^[a-z0-9]{32}\.lambda-url\.eu-west-2\.on\.aws$/, "its origin is the Function URL");
assert.deepEqual(tag(r.text, "PathPattern"), ["/health"]);
assert.deepEqual(tag(r.text, "FunctionARN"), ["arn:aws:cloudfront::" + ACCT + ":function/sws-vault-" + A + "-health"], "the -health function on /health");
assert.deepEqual(tag(r.text, "EventType"), ["viewer-request"]);
assert.match(r.text, /<CustomHeaders><Quantity>0<\/Quantity><\/CustomHeaders>/, "no origin custom headers");
assert.deepEqual(tag((await cf(twin, "function?Stage=LIVE", CUST)).text, "Status"), ["DEPLOYED"], "LIVE is deployed once the distribution is");
checks += 18;

// 3. Each account its own: neither sees the other's distribution or functions.
assert.deepEqual(dids((await cf(twin, "distribution")).text), ["EDEMOTWIN00001"], "the platform account does not see the Vault's");
assert.equal(tag((await cf(twin, "function")).text, "Quantity")[0], "0", "nor its function");
assert.equal((await cf(twin, "distribution/" + out.DistributionId)).status, 404, "nor get it by id");
assert.equal((await cf(twin, "distribution/EDEMOTWIN00001", CUST)).status, 404, "the customer does not get the demo distribution");
checks += 4;

// 4. Paging: MaxItems and NextMarker; FunctionList pages on NextMarker alone; bad MaxItems, Stage or Marker refused.
const B2 = "1b2c3d4e5f60", C3 = "2c3d4e5f6071";
await create(twin, B2); await create(twin, C3);
twin.clock.tick(10 * 60 * 1000);
let ids = [], marker = "", pages = 0;
do { r = await cf(twin, "distribution?MaxItems=1" + (marker ? "&Marker=" + marker : ""), CUST); ids = ids.concat(dids(r.text)); marker = tag(r.text, "NextMarker")[0]; pages++;
  assert.equal(tag(r.text, "IsTruncated")[0], marker ? "true" : "false", "IsTruncated agrees with NextMarker"); } while (marker);
assert.equal(pages, 3); assert.deepEqual(ids, [out.DistributionId, (await outputs(twin, B2)).DistributionId, (await outputs(twin, C3)).DistributionId], "every distribution once, in order");
let names = []; marker = ""; pages = 0;
do { r = await cf(twin, "function?Stage=DEVELOPMENT&MaxItems=2" + (marker ? "&Marker=" + encodeURIComponent(marker) : ""), CUST); names = names.concat(tag(r.text, "Name")); marker = tag(r.text, "NextMarker")[0]; pages++; } while (marker);
assert.equal(pages, 2); assert.deepEqual(names, [A, B2, C3].map((x) => "sws-vault-" + x + "-health"), "functions page on NextMarker");
for (const q of ["distribution?MaxItems=0", "distribution?MaxItems=1001", "distribution?MaxItems=x", "distribution?Marker=ENOPE", "function?Stage=PROD"]) {
  r = await cf(twin, q, CUST); assert.equal(r.status, 400, q); assert.equal(tag(r.text, "Code")[0], "InvalidArgument", q);
}
checks += 2 + 3 + 2 + 10;

// 5. Teardown: the distribution is disabled and in progress while the stack deletes, and gone once the delete settles.
await cfn(twin, { Action: "DeleteStack", StackName: "sws-vault-" + B2 });
twin.clock.tick(30 * 1000);
r = await cf(twin, "distribution/" + (await outputs(twin, A)).DistributionId, CUST);
assert.equal(r.status, 200, "the others are untouched");
const bId = ids[1];
r = await cf(twin, "distribution/" + bId, CUST);
assert.equal(r.status, 200, "still there while its stack deletes"); assert.equal(tag(r.text, "Status")[0], "InProgress"); assert.match(r.text, /<\/PriceClass><Enabled>false<\/Enabled>/, "and disabled");
twin.clock.tick(15 * 60 * 1000);
assert.equal((await cf(twin, "distribution/" + bId, CUST)).status, 404, "gone once the delete settles");
assert.deepEqual(dids((await cf(twin, "distribution", CUST)).text), [ids[0], ids[2]], "the list has the other two");
assert.ok(!tag((await cf(twin, "function", CUST)).text, "Name").includes("sws-vault-" + B2 + "-health"), "its function is gone too");
checks += 7;

// 6. Only the three reads: other methods and paths are a 501; the customer's other services still refuse.
assert.equal((await cf(twin, "distribution", CUST, "POST")).status, 501, "no writes");
assert.equal((await cf(twin, "distribution/" + ids[0] + "/config", CUST)).status, 501, "GetDistributionConfig is not in the twin");
assert.equal((await cf(twin, "function/sws-vault-" + A + "-health", CUST)).status, 501, "DescribeFunction (and its code) is not in the twin");
assert.equal((await cf(twin, "cache-policy", CUST)).status, 501);
assert.equal((await twin.handle("https://s3." + R + ".amazonaws.com/", { headers: CUST })).status, 403, "S3 still refuses the customer credential");
checks += 5;

// 7. Reads write nothing: the journal holds only the creates, the delete and what the clock settled.
const j = twin.journal().slice(j0);
assert.ok(j.every((e) => /^cloudformation\./.test(e.op)), "no entry from a CloudFront read: " + [...new Set(j.map((e) => e.op))].join());
checks += 1;

console.log("OK (twin CloudFront reads: " + checks + " checks; demo distribution in the platform account, each Vault's in the customer's from its create to its delete, -health on /health, paging, isolation, reads only)");
