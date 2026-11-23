// The twin's IAM read answers (design 04, work/architect.aws.a 77d26be), over the real transport and SigV4, as the
// page would send them: ListRoles paged, GetRole with RoleLastUsed, attached and inline policies, GetRolePolicy,
// GetPolicy and GetPolicyVersion (a marked placeholder for AWS managed policies), ListOpenIDConnectProviders, and
// AWS-shaped errors. Then a drift check: the platform roles' policies in the twin are the ones
// site/cloudformation/bootstrap.yaml declares. Shapes checked by boto3.aws.a against AWS's IAM API reference (work/boto3.aws.a a83ea2f).
// Node 22, no network. Run: node test/twin/iam.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array,
  setTimeout, crypto: globalThis.crypto, console, btoa, atob, encodeURIComponent, decodeURIComponent,
  location: { search: "?twin", origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const A = ctx.AwsTwin.account;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const tag = (x, t) => [...x.matchAll(new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">", "g"))].map((m) => m[1]);
const one = (x, t) => tag(x, t)[0];

const assume = async (role) => {
  const r = await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/" + role, RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() });
  const t = await r.text(), g = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1];
  return { accessKeyId: g("AccessKeyId"), secretAccessKey: g("SecretAccessKey"), sessionToken: g("SessionToken") };
};
const creds = await assume("sws-aws-platform-read");
const iam = async (params, signed = true) => {
  const body = new URLSearchParams(Object.assign({ Version: "2010-05-08" }, params)).toString(), url = "https://iam.amazonaws.com/";
  const headers = { "content-type": "application/x-www-form-urlencoded; charset=utf-8" };
  const r = await ctx.AwsTransport.fetch(url, { method: "POST", headers: signed ? await ctx.SigV4.sign({ method: "POST", url, headers, body }, creds, "us-east-1", "iam") : headers, body });
  return { status: r.status, text: await r.text() };
};
const NS = 'xmlns="https://iam.amazonaws.com/doc/2010-05-08/"';

// ListRoles: every role, two a page, with an opaque Marker; no RoleLastUsed in a list.
const roles = []; let marker = null, pages = 0;
do {
  const r = await iam(Object.assign({ Action: "ListRoles" }, marker ? { Marker: marker } : {}));
  ok(r.status === 200 && r.text.includes("<ListRolesResponse " + NS + ">") && r.text.includes("<RequestId>"), "ListRoles envelope");
  const ms = tag(one(r.text, "Roles"), "member");
  ok(ms.length <= 2 && !r.text.includes("RoleLastUsed"), "ListRoles page of at most 2, no RoleLastUsed");
  roles.push(...ms); pages++;
  marker = one(r.text, "IsTruncated") === "true" ? one(r.text, "Marker") : null;
} while (marker && pages < 10);
const names = roles.map((m) => one(m, "RoleName"));
ok(JSON.stringify(names) === JSON.stringify(["demo-cloudfront-logs-firehose", "demo-handler-role", "demo-log-enricher-role", "demo-nightly-report-role", "sovereignwebsite-factory-dns", "sws-aws-platform-change", "sws-aws-platform-read"]) && pages === 4, "ListRoles names " + names + " in " + pages + " pages");
const m0 = roles.find((m) => one(m, "RoleName") === "demo-handler-role");
ok(one(m0, "Path") === "/" && /^AROA[A-Z0-9]{17}$/.test(one(m0, "RoleId")) && one(m0, "Arn") === "arn:aws:iam::" + A + ":role/demo-handler-role" && /^2026-11-\d\dT\d\d:\d\d:\d\dZ$/.test(one(m0, "CreateDate")) && one(m0, "MaxSessionDuration") === "3600", "role member fields");
const trust = JSON.parse(decodeURIComponent(one(m0, "AssumeRolePolicyDocument")));
ok(trust.Statement[0].Principal.Service === "lambda.amazonaws.com" && trust.Statement[0].Action === "sts:AssumeRole", "a demo role trusts the service that runs as it");

// GetRole: RoleLastUsed filled for a used role, empty for one never used.
let r = await iam({ Action: "GetRole", RoleName: "sws-aws-platform-read" });
ok(r.text.includes("<GetRoleResponse " + NS + ">") && one(r.text, "LastUsedDate") === "2026-11-22T10:01:02Z" && one(r.text, "Region") === "eu-west-2", "GetRole RoleLastUsed (used)");
ok(JSON.parse(decodeURIComponent(one(r.text, "AssumeRolePolicyDocument"))).Statement[0].Principal.Federated === "accounts.google.com", "GetRole trust");
r = await iam({ Action: "GetRole", RoleName: "sovereignwebsite-factory-dns" });
ok(r.text.includes("<RoleLastUsed></RoleLastUsed>"), "GetRole RoleLastUsed empty when never used");

// Attached and inline policies.
r = await iam({ Action: "ListAttachedRolePolicies", RoleName: "sws-aws-platform-read" });
ok(JSON.stringify(tag(r.text, "PolicyArn")) === JSON.stringify(["arn:aws:iam::aws:policy/job-function/ViewOnlyAccess", "arn:aws:iam::aws:policy/SecurityAudit"]) && JSON.stringify(tag(r.text, "PolicyName")) === JSON.stringify(["ViewOnlyAccess", "SecurityAudit"]) && one(r.text, "IsTruncated") === "false", "ListAttachedRolePolicies");
r = await iam({ Action: "ListAttachedRolePolicies", RoleName: "demo-handler-role" });
ok(r.text.includes("<AttachedPolicies></AttachedPolicies>"), "no attached policies");
r = await iam({ Action: "ListRolePolicies", RoleName: "sws-aws-platform-change" });
ok(JSON.stringify(tag(one(r.text, "PolicyNames"), "member")) === JSON.stringify(["dns-role-trust-only", "s3-cors", "self-update"]), "ListRolePolicies");
r = await iam({ Action: "GetRolePolicy", RoleName: "sws-aws-platform-change", PolicyName: "dns-role-trust-only" });
const pd = JSON.parse(decodeURIComponent(one(r.text, "PolicyDocument")));
ok(one(r.text, "PolicyName") === "dns-role-trust-only" && pd.Statement[0].Resource === "arn:aws:iam::" + A + ":role/sovereignwebsite-factory-dns", "GetRolePolicy document");

// AWS managed policies: GetPolicy, then GetPolicyVersion at the default version: a marked placeholder.
r = await iam({ Action: "GetPolicy", PolicyArn: "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess" });
ok(one(r.text, "PolicyName") === "ViewOnlyAccess" && one(r.text, "Path") === "/job-function/" && one(r.text, "DefaultVersionId") === "v1", "GetPolicy");
r = await iam({ Action: "GetPolicyVersion", PolicyArn: "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess", VersionId: "v1" });
const pv = JSON.parse(decodeURIComponent(one(r.text, "Document")));
ok(pv.Statement.length === 1 && pv.Statement[0].Sid === "TwinPlaceholder" && pv.Statement[0].Action.length === 0 && one(r.text, "IsDefaultVersion") === "true", "GetPolicyVersion placeholder grants nothing");

// OIDC providers.
r = await iam({ Action: "ListOpenIDConnectProviders" });
ok(JSON.stringify(tag(r.text, "Arn")) === JSON.stringify(["arn:aws:iam::" + A + ":oidc-provider/token.actions.githubusercontent.com"]), "ListOpenIDConnectProviders");

r = await iam({ Action: "GetOpenIDConnectProvider", OpenIDConnectProviderArn: "arn:aws:iam::" + A + ":oidc-provider/token.actions.githubusercontent.com" });
ok(r.text.includes("<GetOpenIDConnectProviderResponse " + NS + ">") && one(r.text, "Url") === "token.actions.githubusercontent.com" && JSON.stringify(tag(one(r.text, "ClientIDList"), "member")) === JSON.stringify(["sts.amazonaws.com"]), "GetOpenIDConnectProvider");
r = await iam({ Action: "GetRole", RoleName: "sws-aws-platform-read" });
ok(!r.text.includes("PermissionsBoundary"), "no boundaries until decision 6");

// Errors.
r = await iam({ Action: "GetRole", RoleName: "nope" });
ok(r.status === 404 && one(r.text, "Code") === "NoSuchEntity", "GetRole NoSuchEntity");
r = await iam({ Action: "GetRolePolicy", RoleName: "sws-aws-platform-read", PolicyName: "nope" });
ok(r.status === 404 && one(r.text, "Code") === "NoSuchEntity", "GetRolePolicy NoSuchEntity");
r = await iam({ Action: "GetPolicy", PolicyArn: "arn:aws:iam::aws:policy/Nope" });
ok(r.status === 404 && one(r.text, "Code") === "NoSuchEntity", "GetPolicy NoSuchEntity");
r = await iam({ Action: "ListRoles" }, false);
ok(r.status === 403, "unsigned is refused");

// Writes go through the journal (design 02): an UpdateAssumeRolePolicy is an iam.updateAssumeRolePolicy entry with
// the caller as actor, and a refold of the journal gives the same world, IAM details included.
const change = await assume("sws-aws-platform-change");
{
  const body = new URLSearchParams({ Action: "UpdateAssumeRolePolicy", Version: "2010-05-08", RoleName: "demo-handler-role", PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] }) }).toString();
  const url = "https://iam.amazonaws.com/", headers = { "content-type": "application/x-www-form-urlencoded; charset=utf-8" };
  const w = await ctx.AwsTransport.fetch(url, { method: "POST", headers: await ctx.SigV4.sign({ method: "POST", url, headers, body }, change, "us-east-1", "iam"), body });
  ok(w.status === 200 && (await w.text()).includes("<UpdateAssumeRolePolicyResponse " + NS + ">"), "UpdateAssumeRolePolicy answers");
  const j = ctx.AwsTwin.journal(), last = j[j.length - 1];
  ok(last.op === "iam.updateAssumeRolePolicy" && last.actor === "role:sws-aws-platform-change" && last.data.name === "demo-handler-role", "a journal entry with the caller as actor " + JSON.stringify({ op: last.op, actor: last.actor }));
  ok(j.filter((e) => e.op === "iam.createRole").length === 7 && j.filter((e) => e.op === "iam.createRole").every((e) => e.data.details && e.why === "pack.seed"), "seven roles seeded with their details");
  const r = await iam({ Action: "ListRolePolicies", RoleName: "demo-handler-role" });
  ok(JSON.stringify(tag(one(r.text, "PolicyNames"), "member")) === JSON.stringify(["logs-write"]), "details survive a trust update");
}

// Drift: the platform roles' policies are bootstrap.yaml's.
const yaml = readFileSync(new URL("../../site/cloudformation/bootstrap.yaml", import.meta.url), "utf8");
for (const [logical, role] of [["PlatformRead", "sws-aws-platform-read"], ["PlatformChange", "sws-aws-platform-change"]]) {
  const block = yaml.split(/\n  (?=[A-Za-z]+:\n    Type:)/).find((b) => b.startsWith(logical + ":"));
  const yNames = [...block.matchAll(/- PolicyName: (\S+)/g)].map((m) => m[1]).sort();
  const yArns = [...block.matchAll(/^\s+- (arn:aws:iam::aws:policy\/\S+)$/gm)].map((m) => m[1]);
  const tNames = tag(one((await iam({ Action: "ListRolePolicies", RoleName: role })).text, "PolicyNames"), "member");
  const tArns = tag((await iam({ Action: "ListAttachedRolePolicies", RoleName: role })).text, "PolicyArn");
  ok(JSON.stringify(tNames) === JSON.stringify(yNames), role + ": inline policy names as the template: " + tNames + " vs " + yNames);
  ok(JSON.stringify(tArns) === JSON.stringify(yArns), role + ": managed policies as the template: " + tArns + " vs " + yArns);
  for (const n of yNames) {
    const sids = [...(block.split("- PolicyName: " + n)[1].split("- PolicyName:")[0]).matchAll(/- Sid: (\S+)/g)].map((m) => m[1]);
    const doc = JSON.parse(decodeURIComponent(one((await iam({ Action: "GetRolePolicy", RoleName: role, PolicyName: n })).text, "PolicyDocument")));
    ok(JSON.stringify(doc.Statement.map((s) => s.Sid)) === JSON.stringify(sids), role + " " + n + ": statements as the template: " + sids);
  }
}

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (twin IAM: " + passed + " checks; ListRoles paged, GetRole with RoleLastUsed, attached and inline policies, managed policy placeholder, OIDC providers, errors, drift against bootstrap.yaml)");
