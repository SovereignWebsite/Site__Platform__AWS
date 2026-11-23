// IamApi (site/api/iam-api.js) over the twin's IAM answers through the real transport and SigV4, then trust parsing,
// paging and errors over a recording send, then its contract (site/api/iam.openapi.json): one operation per method,
// the same arguments, and each method's real requests need exactly its listed IAM actions. Node 22, no network.
// Run: node test/api/iam-api.test.mjs
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
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/iam-api.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { IamApi, AwsTwin } = ctx, A = AwsTwin.account;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const rejects = async (p, test, m) => { try { await p; ok(false, m + ": did not reject"); } catch (e) { ok(test(e), m + ": " + e.message); } };
const plain = (v) => JSON.parse(JSON.stringify(v));

const assume = async (role) => {
  const r = await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/" + role, RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() });
  const t = await r.text(), g = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1];
  return { accessKeyId: g("AccessKeyId"), secretAccessKey: g("SecretAccessKey"), sessionToken: g("SessionToken") };
};
const creds = await assume("sws-aws-platform-read"), seen = [];
const send = async (req) => { seen.push(req); return ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body }); };
const api = IamApi(send);

// ---- over the twin ----
const first = await api.roles();
ok(first.items.length === 2 && typeof first.next === "string", "roles: one page of two, with next");
ok(seen[0].service === "iam" && seen[0].region === "us-east-1" && seen[0].url === "https://iam.amazonaws.com/" && /Action=ListRoles&Version=2010-05-08/.test(seen[0].body), "IAM request shape " + seen[0].body);
const all = await IamApi.all((next) => api.roles({ next }));
ok(all.items.length === 7 && !all.capped && all.items.every((r) => /^arn:aws:iam::\d{12}:role\//.test(r.arn) && r.path === "/" && r.maxSession === 3600), "roles: all seven through ApiAll");
const read = await api.role("sws-aws-platform-read");
ok(read.arn === "arn:aws:iam::" + A + ":role/sws-aws-platform-read" && read.description.startsWith("Read-only view") && JSON.stringify(read.lastUsed) === JSON.stringify({ when: "2026-11-22T10:01:02Z", region: "eu-west-2" }), "role(read) " + JSON.stringify(read.lastUsed));
ok(JSON.stringify(plain(read.trust)) === JSON.stringify({ statements: [{ effect: "Allow", actions: ["sts:AssumeRoleWithWebIdentity"], notActions: [], principals: [{ kind: "federated", id: "accounts.google.com" }], notPrincipals: [],
  conditions: [{ op: "StringEquals", key: "accounts.google.com:aud", values: ["twin-client-id.apps.googleusercontent.com"] }, { op: "StringEquals", key: "accounts.google.com:sub", values: ["000000000000000000001"] }] }] }), "trust read into statements " + JSON.stringify(read.trust));
const dns = await api.role("sovereignwebsite-factory-dns");
ok(dns.lastUsed === null && dns.trust.statements[0].principals[0].id === "arn:aws:iam::" + A + ":oidc-provider/token.actions.githubusercontent.com" && dns.trust.statements[0].conditions.find((c) => c.key.endsWith(":sub")).values.length === 2, "role(dns): never used, OIDC trust, two subjects");
ok((await api.role("demo-handler-role")).trust.statements[0].principals[0].kind === "service", "a service principal");
ok(JSON.stringify(plain((await api.attached("sws-aws-platform-read")).items)) === JSON.stringify([{ name: "ViewOnlyAccess", arn: "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess" }, { name: "SecurityAudit", arn: "arn:aws:iam::aws:policy/SecurityAudit" }]), "attached");
const inl = await api.inline("sws-aws-platform-change");
ok(JSON.stringify(plain(inl)) === JSON.stringify({ items: ["dns-role-trust-only", "s3-cors", "self-update"], next: null }), "inline");
const su = await api.inlineDocument("sws-aws-platform-change", "self-update");
ok(su.Statement.length === 4 && su.Statement[2].Condition["ForAnyValue:StringEquals"]["aws:CalledVia"] === "cloudformation.amazonaws.com", "inlineDocument as AWS wrote it");
const pd = await api.policyDocument("arn:aws:iam::aws:policy/SecurityAudit");
ok(pd.version === "v1" && pd.awsManaged === true && Array.isArray(pd.document.Statement), "policyDocument (AWS managed)");
ok(JSON.stringify(plain(await api.providers())) === JSON.stringify([{ arn: "arn:aws:iam::" + A + ":oidc-provider/token.actions.githubusercontent.com", url: "token.actions.githubusercontent.com" }]), "providers");
await rejects(api.role("nope"), (e) => e.code === "NoSuchEntity" && e.status === 404, "missing role");
await rejects(api.inlineDocument("sws-aws-platform-read", "nope"), (e) => e.code === "NoSuchEntity", "missing inline policy");

// ---- trust parsing at its edges ----
const T = IamApi.trust({ Statement: { Effect: "Deny", NotAction: "iam:*", Principal: "*", Condition: { Bool: { "aws:SecureTransport": "false" } } } });
ok(JSON.stringify(plain(T)) === JSON.stringify({ statements: [{ effect: "Deny", actions: [], notActions: ["iam:*"], principals: [{ kind: "aws", id: "*" }], notPrincipals: [], conditions: [{ op: "Bool", key: "aws:SecureTransport", values: ["false"] }] }] }), "a single statement, Principal *, NotAction");
const T2 = IamApi.trust({ Statement: [{ Effect: "Allow", Action: ["sts:AssumeRole", "sts:TagSession"], Principal: { AWS: ["arn:aws:iam::444455556666:root", "arn:aws:iam::777788889999:role/x"], CanonicalUser: "abc" } }] });
ok(JSON.stringify(plain(T2.statements[0].principals)) === JSON.stringify([{ kind: "aws", id: "arn:aws:iam::444455556666:root" }, { kind: "aws", id: "arn:aws:iam::777788889999:role/x" }, { kind: "canonical", id: "abc" }]), "several principals of several kinds");
const evil = IamApi.trust({ Statement: [{ Effect: "Allow", Action: "sts:AssumeRole", Principal: { AWS: "<img src=x onerror=alert(1)>" } }] });
ok(evil.statements[0].principals[0].id === "<img src=x onerror=alert(1)>", "hostile values come back as they are");

// ---- paging and errors over a recording send ----
const xml = (s, st = 200) => new Response(s, { status: st, headers: { "content-type": "text/xml" } });
const names = ["a", "b", "c", "d", "e"];
const pagedApi = IamApi(async (rq) => {
  const q = new URLSearchParams(rq.body), from = +(q.get("Marker") || 0), n = +(q.get("MaxItems") || 2), list = names.slice(from, from + n), more = from + n < names.length;
  return xml("<ListRolePoliciesResponse><ListRolePoliciesResult><PolicyNames>" + list.map((x) => "<member>" + x + "</member>").join("") + "</PolicyNames><IsTruncated>" + more + "</IsTruncated>" + (more ? "<Marker>" + (from + n) + "</Marker>" : "") + "</ListRolePoliciesResult></ListRolePoliciesResponse>");
});
ok((await IamApi.all((next) => pagedApi.inline("r", { next, max: 2 }))).items.join() === "a,b,c,d,e", "inline pages by Marker through ApiAll");
await rejects(IamApi(async () => xml("<ErrorResponse><Error><Type>Sender</Type><Code>Throttling</Code><Message>Rate exceeded</Message></Error><RequestId>x</RequestId></ErrorResponse>", 400)).roles(),
  (e) => e.code === "Throttling" && e.status === 400 && e.message === "Throttling: Rate exceeded", "Query error shape");
await rejects(IamApi(async () => Promise.reject(new TypeError("Failed to fetch"))).roles(), (e) => e instanceof TypeError, "a CORS refusal passes through");

// ---- contract ----
const docj = JSON.parse(readFileSync(new URL("../../site/api/iam.openapi.json", import.meta.url), "utf8"));
const ops = Object.values(docj.paths).flatMap((p) => Object.values(p));
ok(docj.openapi === "3.1.0" && docj.servers.length === 0, "OpenAPI 3.1, no server");
ok(JSON.stringify(ops.map((o) => o.operationId).sort()) === JSON.stringify(Object.keys(api).sort()), "one operation per method");
const record = [];
const okSend = async (rq) => { record.push("iam:" + new URLSearchParams(rq.body).get("Action")); return send(rq); };
const rec = IamApi(okSend);
const samples = { roles: [{}], role: ["sws-aws-platform-read"], attached: ["sws-aws-platform-read", {}], inline: ["sws-aws-platform-read", {}],
  inlineDocument: ["sws-aws-platform-read", "s3-browse"], policyDocument: ["arn:aws:iam::aws:policy/SecurityAudit"], providers: [] };
for (const o of ops) {
  const args = o["x-arguments"].slice(o["x-arguments"].indexOf("(") + 1, -1).replace(/\{[^}]*\}/g, "x").split(",").filter((x) => x.trim());
  ok(o["x-arguments"].startsWith(o.operationId + "(") && args.length === api[o.operationId].length, o.operationId + ": arguments");
  ok(o["x-role"] === "read" && o["x-aws-actions"].every((a) => /^iam:(List|Get)[A-Za-z]+$/.test(a)), o.operationId + ": read actions only");
  record.length = 0;
  await rec[o.operationId](...samples[o.operationId]);
  ok(JSON.stringify(record) === JSON.stringify(o["x-aws-actions"]), o.operationId + ": requests need exactly " + o["x-aws-actions"] + " (made " + record + ")");
}
const walk = (v) => { if (Array.isArray(v)) return v.every(walk); if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => k === "$ref" ? !!x.replace(/^#\//, "").split("/").reduce((a, p) => a && a[p], docj) : walk(x)); return true; };
ok(walk(docj), "every $ref resolves");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (iam-api: " + passed + " checks; twin reads, trust parsing, paging, errors, contract)");
