// CfnApi (site/api/cfn-api.js) over the twin's CloudFormation reads (cloudformation.aws.a's patch 01, ba4bec5) through
// the real transport and SigV4, then paging, ARN derivation and errors over a recording send, then its contract
// (site/api/cfn.openapi.json): one operation per method, the same arguments, and each method's real requests need
// exactly its listed CloudFormation action. Node 22, no network.
// Run: node test/api/cfn-api.test.mjs
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
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/cfn-api.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { CfnApi, AwsTwin } = ctx, A = AwsTwin.account;
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
const api = CfnApi(send, { account: A });

// ---- over the twin ----
const eu = await api.stacks("eu-west-2");
ok(JSON.stringify(eu.items.map((s) => s.name)) === JSON.stringify(["demo-site", "demo-dns", "demo-lambda"]), "stacks(eu-west-2): the three live stacks on the first page");
{ // ListStacks pages (the twin's pages of 3) and keeps a deleted stack for 90 days: stacks() leaves it out unless asked.
  const live = (await CfnApi.all((next) => api.stacks("eu-west-2", { next }))).items.map((s) => s.name), every = (await CfnApi.all((next) => api.stacks("eu-west-2", { next, deleted: true }))).items;
  ok(live.join() === "demo-site,demo-dns,demo-lambda" && every.filter((s) => s.status === "DELETE_COMPLETE").every((s) => !live.includes(s.name)), "all pages: deleted stacks only with deleted: true");
}
ok(seen[0].service === "cloudformation" && seen[0].region === "eu-west-2" && seen[0].url === "https://cloudformation.eu-west-2.amazonaws.com/" && /^Action=ListStacks&Version=2010-05-15$/.test(seen[0].body), "request shape " + seen[0].body);
ok(eu.items.every((s) => /^arn:aws:cloudformation:eu-west-2:\d{12}:stack\/[a-z0-9-]+\/[0-9a-f-]{36}$/.test(s.arn) && s.region === "eu-west-2" && s.description && s.created), "every stack has AWS's StackId as arn, region, description, created");
const lam = eu.items.find((s) => s.name === "demo-lambda");
ok(lam.status === "UPDATE_ROLLBACK_COMPLETE" && lam.updated === "2026-11-21T16:40:00Z" && lam.reason === null, "AWS's own status, kept as it is");
ok((await api.stacks("us-east-1")).items.map((s) => s.name).join() === "sws-aws-platform", "stacks(us-east-1): the hub's own stack");
ok(JSON.stringify(plain(await api.stacks("eu-west-1"))) === JSON.stringify({ items: [], next: null }), "a region with no stacks");
const hub = await api.stack("us-east-1", "sws-aws-platform");
ok(hub.status === "CREATE_COMPLETE" && JSON.stringify(plain(hub.parameters)) === JSON.stringify([{ key: "GoogleClientId", value: "twin-client-id.apps.googleusercontent.com" }, { key: "GoogleSub", value: "000000000000000000000" }]), "stack(): parameters");
ok(JSON.stringify(plain(hub.outputs.map((o) => [o.key, o.value, o.exportName]))) === JSON.stringify([["ReadRoleArn", "arn:aws:iam::" + A + ":role/sws-aws-platform-read", null], ["ChangeRoleArn", "arn:aws:iam::" + A + ":role/sws-aws-platform-change", null]]), "stack(): outputs");
ok((await api.stack("us-east-1", hub.arn)).name === "sws-aws-platform", "stack() by ARN");
const site = await api.stack("eu-west-2", "demo-site");
ok(site.outputs[0].exportName === "demo-site-distribution-domain" && site.outputs[0].value === "d111111abcdef8.cloudfront.net", "stack(): an output with its export name");
await rejects(api.stack("eu-west-2", "sws-aws-platform"), (e) => e.code === "ValidationError" && e.status === 400 && /does not exist/.test(e.message), "a stack in another region is not found");

const sr = await api.resources("eu-west-2", site.arn);
ok(JSON.stringify(plain(sr.items.map((r) => [r.logicalId, r.type, r.arn, r.arnDerived]))) === JSON.stringify([
  ["SiteBucket", "AWS::S3::Bucket", "arn:aws:s3:::" + AwsTwin.buckets.site, true],
  ["LogsBucket", "AWS::S3::Bucket", "arn:aws:s3:::" + AwsTwin.buckets.logs, true],
  ["Distribution", "AWS::CloudFront::Distribution", "arn:aws:cloudfront::" + A + ":distribution/EDEMOTWIN00001", true]]) && sr.next === null, "resources(demo-site): derived ARNs, marked");
ok(sr.items.every((r) => r.status === "CREATE_COMPLETE" && r.updated && r.physicalId), "resources: status, updated, physical id");
const lr = (await api.resources("eu-west-2", "demo-lambda")).items;
ok(lr.find((r) => r.logicalId === "Handler").arn === "arn:aws:lambda:eu-west-2:" + A + ":function:demo-handler" && lr.find((r) => r.logicalId === "Handler").status === "UPDATE_COMPLETE"
  && lr.find((r) => r.logicalId === "HandlerRole").arn === "arn:aws:iam::" + A + ":role/demo-handler-role", "resources(demo-lambda): function and role ARNs");
const dr = (await api.resources("eu-west-2", "demo-dns")).items;
ok(dr[0].arn === "arn:aws:route53:::hostedzone/Z0DEMOTWIN0001" && dr[0].arnDerived && dr[1].type === "AWS::Route53::RecordSet" && dr[1].arn === "urn:sws:cfn-resource:demo-dns/WwwAlias" && dr[1].arnDerived === false, "resources(demo-dns): zone derived; a record set gets a urn, never a guess (its name alone does not give zone and type: the graph joins it)");
ok((await api.resources("us-east-1", "sws-aws-platform")).items.map((r) => r.arn).join() === ["read", "change"].map((x) => "arn:aws:iam::" + A + ":role/sws-aws-platform-" + x).join(), "resources(sws-aws-platform): the platform roles");

const ev = await api.events("eu-west-2", "demo-lambda");
ok(ev.items.length === 5 && ev.next === null && ev.items.map((e) => e.time).join() === ev.items.map((e) => e.time).sort().reverse().join(), "events: newest first, one page");
ok(ev.items[0].status === "UPDATE_ROLLBACK_COMPLETE" && ev.items[0].physicalId === lam.arn && ev.items[0].type === "AWS::CloudFormation::Stack", "events: the stack's own event names the stack ARN");
const failed = ev.items.find((e) => e.status === "UPDATE_FAILED");
ok(failed.logicalId === "Handler" && failed.physicalId === "demo-handler" && /dependencies zip/.test(failed.reason), "events: the failure and its reason");
ok(ev.items.every((e) => e.stackArn === lam.arn), "events: every event carries its stack's ARN (StackId)");
ok(new Set(ev.items.map((e) => e.id)).size === 5 && ev.items[4].reason === "User Initiated", "events: unique ids; reason on the first");

const ex = await api.exports("eu-west-2");
ok(JSON.stringify(plain(ex)) === JSON.stringify({ items: [{ name: "demo-site-distribution-domain", value: "d111111abcdef8.cloudfront.net", stackArn: site.arn, stack: "demo-site" }], next: null }), "exports: name, value, exporting stack");
ok(JSON.stringify(plain(await api.importers("eu-west-2", "demo-site-distribution-domain"))) === JSON.stringify({ items: ["demo-dns"], next: null }), "importers: demo-dns");
ok(JSON.stringify(plain(await api.importers("us-east-1", "demo-site-distribution-domain"))) === JSON.stringify({ items: [], next: null }), "importers: none in another region is an empty page");
ok((await CfnApi.all((next) => api.stacks("eu-west-2", { next }))).items.length === 3, "CfnApi.all drains stacks()");

// The deploy page's progress view polls events() while a stack changes: after a plan is applied in the twin,
// the hub stack's newest event is the update.
{
  const change = await assume("sws-aws-platform-change");
  const cs = async (params) => ctx.AwsTransport.fetch("https://cloudformation.us-east-1.amazonaws.com/", { method: "POST",
    headers: await ctx.SigV4.sign({ method: "POST", url: "https://cloudformation.us-east-1.amazonaws.com/", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(Object.assign({ Version: "2010-05-15" }, params)).toString() }, change, "us-east-1", "cloudformation"),
    body: new URLSearchParams(Object.assign({ Version: "2010-05-15" }, params)).toString() });
  ctx.document = { baseURI: "https://example.test/" };
  ctx.fetch = async () => new Response("Description: >-\n  twin\n");
  const before = (await api.events("us-east-1", "sws-aws-platform")).items.length;
  ok((await cs({ Action: "CreateChangeSet", StackName: "sws-aws-platform", ChangeSetName: "t1", TemplateBody: "Description: >-\n  new\n" })).ok, "twin: change set made as the change role");
  ok((await cs({ Action: "ExecuteChangeSet", StackName: "sws-aws-platform", ChangeSetName: "t1" })).ok, "twin: change set executed");
  ctx.fetch = () => { throw new Error("a request left the page"); };
  const after = await api.events("us-east-1", "sws-aws-platform"), st = await api.stack("us-east-1", "sws-aws-platform");
  ok(after.items.length === before + 2 && after.items[0].status === "UPDATE_COMPLETE" && st.status === "UPDATE_COMPLETE" && st.updated === after.items[0].time, "events() shows the applied plan first; stack() agrees");
}

// ---- over a recording send: paging, filters, entities, errors ----
const wrap = (name, inner, next) => "<" + name + "Response xmlns=\"http://cloudformation.amazonaws.com/doc/2010-05-15/\"><" + name + "Result>" + inner + (next ? "<NextToken>" + next + "</NextToken>" : "") + "</" + name + "Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></" + name + "Response>";
const fake = (answer) => { const log = []; return { log, send: async (req) => { log.push(Object.fromEntries(new URLSearchParams(req.body))); const a = answer(log[log.length - 1], req); return new Response(a[1], { status: a[0] }); } }; };
const sum = (name, status, extra) => "<member><StackId>arn:aws:cloudformation:eu-west-1:" + A + ":stack/" + name + "/00000000-0000-4000-8000-000000000000</StackId><StackName>" + name + "</StackName><CreationTime>2026-01-01T00:00:00Z</CreationTime><StackStatus>" + status + "</StackStatus>" + (extra || "") + "</member>";
{
  const f = fake((q) => [200, q.NextToken ? wrap("ListStacks", "<StackSummaries>" + sum("c", "CREATE_COMPLETE") + "</StackSummaries>")
    : wrap("ListStacks", "<StackSummaries>" + sum("a", "DELETE_COMPLETE", "<DeletionTime>2026-01-02T00:00:00Z</DeletionTime>") + sum("b", "ROLLBACK_COMPLETE", "<StackStatusReason>The following resource(s) failed to create: [X]. </StackStatusReason><TemplateDescription>a &amp; b &lt;c&gt; &#233;</TemplateDescription>") + "</StackSummaries>", "tok/en+1=")]);
  const c = CfnApi(f.send, { account: A });
  const p1 = await c.stacks("eu-west-1");
  ok(p1.items.map((s) => s.name).join() === "b" && p1.next === "tok/en+1=", "DELETE_COMPLETE left out; next is NextToken as given");
  ok(p1.items[0].reason === "The following resource(s) failed to create: [X]. " && p1.items[0].description === "a & b <c> é", "reason and entities read as text");
  const p2 = await c.stacks("eu-west-1", { next: p1.next });
  ok(f.log[1].NextToken === "tok/en+1=" && p2.items[0].name === "c" && p2.next === null, "next goes back as NextToken");
  ok((await c.stacks("eu-west-1", { deleted: true })).items.map((s) => s.name).join() === "a,b", "deleted: true keeps them");
  ok((await CfnApi.all((next) => c.stacks("eu-west-1", { next }))).items.map((s) => s.name).join() === "b,c", "all() over two pages");
}
{
  const f = fake((q) => [200, wrap("ListStackResources", "<StackResourceSummaries>" +
    "<member><LogicalResourceId>Q</LogicalResourceId><PhysicalResourceId>https://sqs.eu-west-1.amazonaws.com/" + A + "/q</PhysicalResourceId><ResourceType>AWS::SQS::Queue</ResourceType><ResourceStatus>CREATE_COMPLETE</ResourceStatus></member>" +
    "<member><LogicalResourceId>T</LogicalResourceId><PhysicalResourceId>arn:aws:sns:eu-west-1:" + A + ":t</PhysicalResourceId><ResourceType>AWS::SNS::Topic</ResourceType><ResourceStatus>CREATE_COMPLETE</ResourceStatus></member>" +
    "<member><LogicalResourceId>R</LogicalResourceId><PhysicalResourceId>r</PhysicalResourceId><ResourceType>AWS::IAM::Role</ResourceType><ResourceStatus>CREATE_FAILED</ResourceStatus><ResourceStatusReason>denied</ResourceStatusReason></member>" +
    "<member><LogicalResourceId>B</LogicalResourceId><ResourceType>AWS::S3::Bucket</ResourceType><ResourceStatus>CREATE_IN_PROGRESS</ResourceStatus></member>" +
    "</StackResourceSummaries>")]);
  const stackArn = "arn:aws:cloudformation:eu-west-1:" + A + ":stack/s/00000000-0000-4000-8000-000000000000";
  const [q, t] = (await CfnApi(f.send, { account: A }).resources("eu-west-1", stackArn)).items;
  ok(q.arn === "urn:sws:cfn-resource:" + stackArn + "/Q" && !q.arnDerived, "a type with no rule: urn with the stack ARN, not derived");
  ok(t.arn === "arn:aws:sns:eu-west-1:" + A + ":t" && t.arnDerived === false, "a physical id that is an ARN is used as it is");
  const noAcct = (await CfnApi(f.send).resources("eu-west-1", "s")).items;
  ok(noAcct[2].arn === "urn:sws:cfn-resource:s/R" && noAcct[2].arnDerived === false, "a role with no account known: urn, never a guess");
  ok(noAcct[3].physicalId === null && noAcct[3].arn === "urn:sws:cfn-resource:s/B" && noAcct[3].status === "CREATE_IN_PROGRESS", "a resource still being made has no physical id: urn");
}
{
  const f = fake(() => [400, "<ErrorResponse xmlns=\"http://cloudformation.amazonaws.com/doc/2010-05-15/\"><Error><Type>Sender</Type><Code>ValidationError</Code><Message>Export 'x' is not imported by any stack.</Message></Error><RequestId>r</RequestId></ErrorResponse>"]);
  ok(JSON.stringify(plain(await CfnApi(f.send).importers("eu-west-1", "x"))) === JSON.stringify({ items: [], next: null }), "importers: CloudFormation's not-imported ValidationError is an empty page");
  const g = fake(() => [403, "<ErrorResponse><Error><Code>AccessDenied</Code><Message>User is not authorized to perform: cloudformation:ListImports</Message></Error></ErrorResponse>"]);
  await rejects(CfnApi(g.send).importers("eu-west-1", "x"), (e) => e.code === "AccessDenied" && e.status === 403 && e.message.startsWith("AccessDenied: User is not"), "importers: other errors are errors");
  const h = fake(() => [400, "<ErrorResponse><Error><Code>ValidationError</Code><Message>Stack with id nope does not exist</Message></Error></ErrorResponse>"]);
  await rejects(CfnApi(h.send).events("eu-west-1", "nope"), (e) => e.code === "ValidationError" && e.status === 400, "events: unknown stack");
  const i = fake(() => [503, "Service Unavailable"]);
  await rejects(CfnApi(i.send).stacks("eu-west-1"), (e) => e.code === "HTTP 503" && e.status === 503, "a non-XML failure keeps its status");
  const d = fake(() => [200, wrap("DescribeStacks", "<Stacks><member><StackId>arn:aws:cloudformation:eu-west-1:" + A + ":stack/x/00000000-0000-4000-8000-000000000000</StackId><StackName>x</StackName>" +
    "<Outputs><member><OutputKey>K</OutputKey><OutputValue>V</OutputValue><Description>the output's own</Description></member></Outputs>" +
    "<Parameters><member><ParameterKey>P</ParameterKey><ParameterValue>1</ParameterValue></member><member><ParameterKey>Q</ParameterKey></member></Parameters>" +
    "<StackStatus>CREATE_COMPLETE</StackStatus><CreationTime>2026-01-01T00:00:00Z</CreationTime></member></Stacks>")]);
  const dx = await CfnApi(d.send).stack("eu-west-1", "x");
  ok(dx.description === null && dx.outputs[0].description === "the output's own" && JSON.stringify(plain(dx.parameters)) === JSON.stringify([{ key: "P", value: "1" }, { key: "Q", value: null }]) && dx.status === "CREATE_COMPLETE", "stack(): an output's Description is not the stack's; nested members read whole");
  const n = fake(() => [200, wrap("DescribeStacks", "<Stacks></Stacks>")]);
  await rejects(CfnApi(n.send).stack("eu-west-1", "x"), (e) => e.code === "ValidationError", "an empty DescribeStacks answer is not found");
}
{
  const cors = CfnApi(() => Promise.reject(new TypeError("Failed to fetch")));
  await rejects(cors.stacks("eu-west-1"), (e) => e instanceof TypeError && e.message === "Failed to fetch", "a CORS TypeError passes through");
  let sent = 0; const counting = CfnApi(async () => { sent++; return new Response(""); });
  await rejects(counting.stacks("eu-west-1.evil.example/x"), (e) => e instanceof TypeError && /not an AWS region/.test(e.message), "a bad region is refused");
  await rejects(counting.stack("eu-west-1", ""), (e) => e instanceof TypeError, "a stack name is required");
  await rejects(counting.importers("eu-west-1"), (e) => e instanceof TypeError, "an export name is required");
  ok(sent === 0, "nothing is sent for bad input");
  let thrown = null; try { CfnApi(); } catch (e) { thrown = e; }
  ok(thrown instanceof TypeError, "CfnApi needs a send");
  const src = readFileSync(new URL("../../site/api/cfn-api.js", import.meta.url), "utf8");
  ok(!/\beval\(|new Function|innerHTML/.test(src), "no eval or HTML in the source");
  // A non-string region is tested and used as the same string (security R-023 b).
  const hosts = []; const h = CfnApi(async (rq) => { hosts.push(rq.url + " " + rq.region); return new Response("<ListStacksResponse><ListStacksResult><StackSummaries></StackSummaries></ListStacksResult></ListStacksResponse>"); });
  await h.stacks({ toString: () => "eu-west-1" });
  await h.stacks({ n: 0, toString() { return this.n++ ? "evil.example/x" : "eu-west-1"; } }); // a second reading would give another host
  ok(hosts.every((x) => x === "https://cloudformation.eu-west-1.amazonaws.com/ eu-west-1"), "the region string tested is the one used: " + hosts.join(", "));
}
// ---- hostile arguments: every method sends exactly one Action, its own (security R-023 c) ----
{
  const HOSTILE = ["a&Action=DeleteStack", "x=y&StackName=other", "Action=DeleteStack", "&", "=", "%26Action%3DDeleteStack", "a\nAction=UpdateStack"];
  const own = { stacks: "ListStacks", stack: "DescribeStacks", resources: "ListStackResources", events: "DescribeStackEvents", exports: "ListExports", importers: "ListImports" };
  const bodies = []; const c = CfnApi(async (rq) => { bodies.push(rq.body); return new Response("<X><Imports></Imports><Stacks><member><StackName>s</StackName></member></Stacks></X>"); });
  for (const v of HOSTILE) {
    const o = { next: v, deleted: v };
    const calls = { stacks: [o], stack: [v], resources: [v, o], events: [v, o], exports: [o], importers: [v, o] };
    for (const [m, args] of Object.entries(calls)) {
      bodies.length = 0;
      await c[m]("eu-west-1", ...args);
      const q = new URLSearchParams(bodies[0]);
      ok(bodies.length === 1 && q.getAll("Action").length === 1 && q.get("Action") === own[m] && q.getAll("Version").join() === "2010-05-15", m + "(" + JSON.stringify(v) + "): one Action, " + own[m] + " (" + bodies[0] + ")");
      const named = { stack: "StackName", resources: "StackName", events: "StackName", importers: "ExportName" }[m];
      if (named) ok(q.getAll(named).length === 1 && q.get(named) === v, m + ": the name goes as one value, unchanged");
      if (m !== "stack") ok(q.getAll("NextToken").length === 1 && q.get("NextToken") === v, m + ": next goes as one NextToken, unchanged");
      ok([...q.keys()].every((k) => ["Action", "Version", "StackName", "ExportName", "NextToken"].includes(k)), m + ": no other parameters (" + [...q.keys()] + ")");
    }
  }
}
// ---- linear parsing and a body cap (security R-023 a) ----
{
  const big = (s, n) => s.repeat(n);
  const answers = [
    "<ListStacksResponse><ListStacksResult><StackSummaries>" + big("<member><StackName>x", 60000),
    "<ListStacksResponse><ListStacksResult><StackSummaries><member>" + big("<StackStatus ", 60000),
    "<DescribeStacksResponse><DescribeStacksResult><Stacks><member><StackId>a</StackId>" + big("<Outputs>", 80000) + "</member></Stacks></DescribeStacksResult></DescribeStacksResponse>",
    big("<Code>", 100000)
  ];
  for (const a of answers) {
    const c = CfnApi(async () => new Response(a, { status: a.startsWith("<Code>") ? 400 : 200 }));
    const t0 = Date.now();
    try { await (a.includes("DescribeStacks") ? c.stack("eu-west-1", "a") : c.stacks("eu-west-1")); } catch (e) { /* refused or not found is fine */ }
    ok(Date.now() - t0 < 300, "an unclosed tag in " + (a.length >> 10) + " KB parsed in " + (Date.now() - t0) + " ms");
  }
  const huge = CfnApi(async () => new Response("<X>" + "a".repeat(4 * 1024 * 1024) + "</X>"));
  await rejects(huge.stacks("eu-west-1"), (e) => e.code === "TooLarge", "an answer over 4 MB is refused before parsing");
}
{
}

// ---- contract ----
const docj = JSON.parse(readFileSync(new URL("../../site/api/cfn.openapi.json", import.meta.url), "utf8"));
const ops = Object.values(docj.paths).flatMap((p) => Object.values(p));
ok(docj.openapi === "3.1.0" && docj.servers.length === 0 && docj["x-browser-global"] === "CfnApi", "OpenAPI 3.1, no server");
ok(JSON.stringify(ops.map((o) => o.operationId).sort()) === JSON.stringify(Object.keys(api).sort()), "one operation per method");
const record = [];
const rec = CfnApi(async (rq) => { record.push("cloudformation:" + new URLSearchParams(rq.body).get("Action")); return send(rq); }, { account: A });
const samples = { stacks: ["eu-west-2", {}], stack: ["eu-west-2", "demo-site"], resources: ["eu-west-2", "demo-site", {}], events: ["eu-west-2", "demo-site", {}],
  exports: ["eu-west-2", {}], importers: ["eu-west-2", "demo-site-distribution-domain", {}] };
for (const o of ops) {
  const args = o["x-arguments"].slice(o["x-arguments"].indexOf("(") + 1, -1).replace(/\{[^}]*\}/g, "x").split(",").filter((x) => x.trim());
  ok(o["x-arguments"].startsWith(o.operationId + "(") && args.length === api[o.operationId].length, o.operationId + ": arguments");
  ok(o["x-role"] === "read" && o["x-aws-actions"].every((a) => /^cloudformation:(List|Describe)[A-Za-z]+$/.test(a)), o.operationId + ": read actions only");
  record.length = 0;
  await rec[o.operationId](...samples[o.operationId]);
  ok(JSON.stringify(record) === JSON.stringify(o["x-aws-actions"]), o.operationId + ": requests need exactly " + o["x-aws-actions"] + " (made " + record + ")");
}
const walk = (v) => { if (Array.isArray(v)) return v.every(walk); if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => k === "$ref" ? !!x.replace(/^#\//, "").split("/").reduce((a, p) => a && a[p], docj) : walk(x)); return true; };
ok(walk(docj), "every $ref resolves");
const actions = [...new Set(ops.flatMap((o) => o["x-aws-actions"]))].sort();
ok(actions.join() === "cloudformation:DescribeStackEvents,cloudformation:DescribeStacks,cloudformation:ListExports,cloudformation:ListImports,cloudformation:ListStackResources,cloudformation:ListStacks", "the read role needs six actions: " + actions);

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (cfn-api: " + passed + " checks; twin reads, paging, ARNs, errors, contract)");
