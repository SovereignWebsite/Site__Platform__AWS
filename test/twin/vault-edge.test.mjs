// Deploy plan step 4, the -edge stack (vault-edge.yaml): sws-vault-<id>-edge in us-east-1 only, the certificate when
// the Vault has its own domain, the WAF web ACL when the rate limit is on, their ARNs as outputs for the Vault stack.
// With the domain's zone in the account the certificate completes; with DNS elsewhere it waits, showing the validation
// record in its events (the twin cannot see the customer's DNS). Its refusals, and its delete.
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";
import { edgeCertificate } from "./edge.mjs";

const START = "2026-11-24T09:00:00.000Z", ID = "0a1b2c3d4e5f", ACCT = "444455556666", E = "sws-vault-" + ID + "-edge";
const H = (r) => ({ authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/" + r + "/cloudformation/aws4_request, SignedHeaders=host, Signature=twin" });
const cfn = async (twin, body, r = "us-east-1") => { const x = await twin.handle("https://cloudformation." + r + ".amazonaws.com/", { method: "POST", headers: H(r), body: new URLSearchParams(body).toString() }); return { status: x.status, text: await x.text() }; };
const create = (twin, name, params, r = "us-east-1", extra = {}) => {
  const b = { Action: "CreateStack", StackName: name, TemplateURL: "https://example.invalid/vault-edge.yaml", ...extra };
  Object.entries(params).forEach(([k, v], i) => { b["Parameters.member." + (i + 1) + ".ParameterKey"] = k; b["Parameters.member." + (i + 1) + ".ParameterValue"] = v; });
  return cfn(twin, b, r);
};
const tag = (t, name) => [...t.matchAll(new RegExp("<" + name + ">([^<]*)</" + name + ">", "g"))].map((m) => m[1]);
const outputs = (t) => { const k = tag(t, "OutputKey"), v = tag(t, "OutputValue"); return Object.fromEntries(k.map((x, i) => [x, v[i]])); };
const fresh = () => { const t = loadTwin("baseline"); t.clock.pause(); t.clock.at(START); return t; };
let checks = 0;

// 1. Domain with its zone in the account, rate limit on: both resources, both outputs, no IAM capability needed.
{
  const t = fresh();
  assert.equal((await create(t, E, { VaultId: ID, DomainName: "vault.example.com", HostedZoneId: "Z0000000000EXAMPLE", EnableRateLimit: "true" })).status, 200, "created without CAPABILITY_NAMED_IAM");
  t.clock.tick(10 * 60 * 1000);
  const d = (await cfn(t, { Action: "DescribeStacks", StackName: E })).text, o = outputs(d);
  assert.equal(tag(d, "StackStatus")[0], "CREATE_COMPLETE");
  assert.match(o.CertificateArn, /^arn:aws:acm:us-east-1:444455556666:certificate\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "the certificate's ARN, in us-east-1");
  assert.match(o.WebAclArn, new RegExp("^arn:aws:wafv2:us-east-1:444455556666:global/webacl/sws-vault-" + ID + "-waf/[0-9a-f-]{36}$"), "the web ACL's ARN, global scope");
  assert.match(tag(d, "StackId")[0], /^arn:aws:cloudformation:us-east-1:444455556666:stack\//, "a us-east-1 stack");
  const res = (await cfn(t, { Action: "ListStackResources", StackName: E })).text;
  assert.deepEqual(tag(res, "LogicalResourceId").sort(), ["VaultCertificate", "VaultWebAcl"]);
  // The Vault stack in eu-west-2 does not see it by name: stacks are per region, as in AWS.
  assert.match((await cfn(t, { Action: "DescribeStacks", StackName: E }, "eu-west-2")).text, /does not exist/, "not in eu-west-2");
  // Teardown: both resources deleted, the stack DELETE_COMPLETE.
  assert.equal((await cfn(t, { Action: "DeleteStack", StackName: E })).status, 200);
  t.clock.tick(10 * 60 * 1000);
  assert.equal(tag((await cfn(t, { Action: "DescribeStacks", StackName: tag(d, "StackId")[0] })).text, "StackStatus")[0], "DELETE_COMPLETE", "deleted");
  checks += 9;
}

// 2. Domain with DNS elsewhere: the certificate waits for its validation record, shown in the events; the stack stays in progress.
{
  const t = fresh();
  await create(t, E, { VaultId: ID, DomainName: "vault.example.org" });
  t.clock.tick(60 * 60 * 1000);
  assert.equal(tag((await cfn(t, { Action: "DescribeStacks", StackName: E })).text, "StackStatus")[0], "CREATE_IN_PROGRESS", "still in progress an hour on");
  const ev = (await cfn(t, { Action: "DescribeStackEvents", StackName: E })).text;
  assert.ok(tag(ev, "ResourceStatusReason").some((r) => /^Content of DNS Record is: \{Name: _[0-9a-f]{32}\.vault\.example\.org\.,Type: CNAME,Value: _[0-9a-f]{32}\.[a-z]{10}\.acm-validations\.aws\.\}$/.test(r)), "the validation record, in the events");
  assert.ok(!tag(ev, "ResourceStatus").includes("CREATE_COMPLETE"), "nothing completes");
  // It can be deleted while it waits, so it does not hold one of the account's slots for good (security.aws.a's note).
  const id = tag((await cfn(t, { Action: "DescribeStacks", StackName: E })).text, "StackId")[0];
  assert.equal((await cfn(t, { Action: "DeleteStack", StackName: E })).status, 200, "a waiting -edge stack can be deleted");
  t.clock.tick(5 * 60 * 1000);
  const after = (await cfn(t, { Action: "DescribeStackEvents", StackName: id })).text;
  assert.equal(tag((await cfn(t, { Action: "DescribeStacks", StackName: id })).text, "StackStatus")[0], "DELETE_COMPLETE", "and is deleted");
  assert.ok(/<LogicalResourceId>VaultCertificate<\/LogicalResourceId>(?:(?!<\/member>).)*<ResourceStatus>DELETE_COMPLETE</s.test(after), "with its waiting certificate");
  // A Vault stack still being created is still refused (the twin's rule for every other case).
  await cfn(t, { Action: "CreateStack", StackName: "sws-vault-" + ID, TemplateURL: "x", "Capabilities.member.1": "CAPABILITY_NAMED_IAM", "Parameters.member.1.ParameterKey": "VaultId", "Parameters.member.1.ParameterValue": ID }, "eu-west-2");
  assert.equal((await cfn(t, { Action: "DeleteStack", StackName: "sws-vault-" + ID }, "eu-west-2")).status, 400, "a Vault stack being created still refuses the delete");
  checks += 7;
}

// 3. Rate limit only (no domain): the web ACL alone, its output alone.
{
  const t = fresh();
  await create(t, E, { VaultId: ID, EnableRateLimit: "true", RateLimit: "500", RateWindowSec: "60" });
  t.clock.tick(5 * 60 * 1000);
  const o = outputs((await cfn(t, { Action: "DescribeStacks", StackName: E })).text);
  assert.deepEqual(Object.keys(o), ["WebAclArn"], "no CertificateArn without a domain");
  checks += 1;
}

// 4. Refusals: another region, nothing to make, out-of-range values, a VaultId that is not the stack's.
{
  const t = fresh(), code = async (p, r, n = E) => tag((await create(t, n, p, r)).text, "Message")[0] || "";
  assert.match(await code({ VaultId: ID, DomainName: "vault.example.com" }, "eu-west-2"), /us-east-1 only/, "the -edge stack only in us-east-1");
  assert.match(await code({ VaultId: ID, DomainName: "vault.example.com" }, "us-east-1", "sws-vault-" + ID), /eu-west-2 only/, "a Vault stack never in us-east-1");
  assert.equal(await code({ VaultId: ID }), "Nothing to create. Give a DomainName (for a certificate) or set EnableRateLimit to true.", "no domain and no rate limit: the rule SomethingToMake");
  assert.match(await code({ VaultId: ID, EnableRateLimit: "yes" }), /EnableRateLimit/);
  assert.match(await code({ VaultId: ID, EnableRateLimit: "true", RateWindowSec: "90" }), /RateWindowSec/);
  assert.match(await code({ VaultId: ID, EnableRateLimit: "true", RateLimit: "9" }), /RateLimit/);
  assert.match(await code({ VaultId: ID, DomainName: "Not A Domain" }), /DomainName/);
  assert.match(await code({ VaultId: ID, DomainName: "vault.example.com", HostedZoneId: "nope" }), /HostedZoneId/);
  assert.match(await code({ VaultId: "ffffffffffff", DomainName: "vault.example.com" }), /VaultId/);
  assert.equal(t.journal().filter((e) => e.op === "cloudformation.createStack").length, 0, "no refusal writes anything");
  checks += 10;
}

// 5. The Vault stack takes the -edge stack's outputs (vault.yaml's rule DomainNeedsCertificate, WebAclArn's pattern), and
// CloudFront refuses a distribution whose certificate or web ACL the account's -edge stacks did not make.
{
  const VR = "eu-west-2", V = "sws-vault-" + ID, vault = (t, p) => create(t, V, { VaultId: ID, ...p }, VR, { "Capabilities.member.1": "CAPABILITY_NAMED_IAM" });
  const status = async (t) => tag((await cfn(t, { Action: "DescribeStacks", StackName: V }, VR)).text, "StackStatus")[0];
  const reasons = async (t) => tag((await cfn(t, { Action: "DescribeStackEvents", StackName: V }, VR)).text, "ResourceStatusReason").join(" | ");
  let t = fresh();
  assert.equal(tag((await vault(t, { DomainName: "vault.example.com" })).text, "Message")[0], "With DomainName, CertificateArn (from vault-edge.yaml in us-east-1) is needed.", "a domain needs a certificate");
  assert.match(tag((await vault(t, { WebAclArn: "arn:aws:wafv2:eu-west-2:444455556666:regional/webacl/x/y" })).text, "Message")[0], /WebAclArn/, "a web ACL ARN outside the pattern is refused");
  // A made-up certificate ARN: the create starts, the distribution fails, the stack rolls back.
  await vault(t, { DomainName: "vault.example.com", CertificateArn: "arn:aws:acm:us-east-1:444455556666:certificate/00000000-0000-4000-8000-000000000000" });
  t.clock.tick(20 * 60 * 1000);
  assert.equal(await status(t), "ROLLBACK_COMPLETE", "an unknown certificate rolls the Vault back");
  assert.match(await reasons(t), /InvalidViewerCertificate/, "with CloudFront's reason");
  { // RetainExceptOnCreate (bucket, policy, log group) and no plain Retain: after the rollback no resource is retained,
    // every resource the create made ends DELETE_COMPLETE (cloudformation.aws.a).
    const ev = [...(await cfn(t, { Action: "DescribeStackEvents", StackName: V }, VR)).text.matchAll(/<member>(.*?)<\/member>/gs)].map((m) => m[1]);
    const lid = (x) => (/<LogicalResourceId>([^<]*)</.exec(x) || [])[1], st = (x) => (/<ResourceStatus>([^<]*)</.exec(x) || [])[1];
    const made = [...new Set(ev.filter((x) => lid(x) !== V && /^CREATE_/.test(st(x))).map(lid))];
    ["VaultBucket", "VaultBucketPolicy", "VaultLogs"].forEach((l) => assert.ok(made.includes(l), l + " was made before the failure"));
    assert.ok(!ev.some((x) => st(x) === "DELETE_SKIPPED"), "after the rollback no resource is retained");
    made.forEach((l) => assert.equal(st(ev.find((x) => lid(x) === l)), "DELETE_COMPLETE", l + " deleted in the rollback"));
  }
  // A certificate for another domain.
  t = fresh();
  const other = await edgeCertificate(t, ID, "other.example.com");
  await vault(t, { DomainName: "vault.example.com", CertificateArn: other });
  t.clock.tick(20 * 60 * 1000);
  assert.equal(await status(t), "ROLLBACK_COMPLETE"); assert.match(await reasons(t), /must attach a trusted certificate that validates your authorization/, "a certificate for another name");
  // A web ACL ARN of the right form that no -edge stack made.
  t = fresh();
  await vault(t, { WebAclArn: "arn:aws:wafv2:us-east-1:444455556666:global/webacl/sws-vault-" + ID + "-waf/00000000-0000-4000-8000-000000000000" });
  t.clock.tick(20 * 60 * 1000);
  assert.equal(await status(t), "ROLLBACK_COMPLETE"); assert.match(await reasons(t), /InvalidWebACLId/, "an unknown web ACL");
  // The -edge stack's own outputs: the Vault completes, and its distribution carries the web ACL.
  t = fresh();
  await create(t, E, { VaultId: ID, DomainName: "vault.example.com", HostedZoneId: "Z0000000000EXAMPLE", EnableRateLimit: "true" });
  t.clock.tick(5 * 60 * 1000);
  const eo = outputs((await cfn(t, { Action: "DescribeStacks", StackName: E })).text);
  await vault(t, { DomainName: "vault.example.com", HostedZoneId: "Z0000000000EXAMPLE", CertificateArn: eo.CertificateArn, WebAclArn: eo.WebAclArn });
  t.clock.tick(20 * 60 * 1000);
  assert.equal(await status(t), "CREATE_COMPLETE", "with the -edge stack's outputs the Vault completes");
  const dist = await (await t.handle("https://cloudfront.amazonaws.com/2020-05-31/distribution", { headers: H("us-east-1") })).text();
  assert.deepEqual(tag(dist, "WebACLId"), [eo.WebAclArn], "and its distribution carries the web ACL");
  checks += 15;
}

console.log("OK (twin vault -edge stack: " + checks + " checks; us-east-1 only, certificate and web ACL by condition, their ARNs as outputs, DNS elsewhere waits with the validation record, refusals write nothing, teardown; the Vault takes its certificate and web ACL, and CloudFront refuses any other)");
