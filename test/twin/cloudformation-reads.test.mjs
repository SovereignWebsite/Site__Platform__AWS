// The twin's CloudFormation read calls (CF-1): ListStacks, DescribeStacks, ListStackResources, DescribeStackEvents,
// ListExports, ListImports, per region, in the XML shapes of the 2010-05-15 query API; the hub's own stack follows a
// plan applied in the twin; unknown stacks and unsigned calls are refused. Node 22; no network.
// Usage: node cloudformation-reads.test.mjs [path to twin.js]   (default: site/twin.js)
import { readFileSync } from "node:fs";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
globalThis.window = globalThis;
globalThis.location = { origin: "http://localhost", search: "" };
const twin = process.argv[2] || new URL("../../site/twin.js", import.meta.url);
new Function(readFileSync(twin, "utf8"))();
const T = globalThis.AwsTwin, auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
const cfn = (region, params, h) => T.handle("https://cloudformation." + region + ".amazonaws.com/", { method: "POST",
  headers: Object.assign({ "content-type": "application/x-www-form-urlencoded" }, h === undefined ? auth : h), body: new URLSearchParams(Object.assign({ Version: "2010-05-15" }, params)).toString() });
const all = (x, tag) => [...x.matchAll(new RegExp("<" + tag + ">([^<]*)</" + tag + ">", "g"))].map((m) => m[1]);
const text = async (r, want) => { if (r.status !== (want || 200)) fail("status " + r.status + " " + (await r.text())); return r.text(); };

// ListStacks per region
let x = await text(await cfn("eu-west-2", { Action: "ListStacks" }));
if (all(x, "StackName").join() !== "demo-site,demo-dns,demo-lambda") fail("eu-west-2 stacks " + all(x, "StackName"));
x = await text(await cfn("us-east-1", { Action: "ListStacks" }));
if (all(x, "StackName").join() !== "sws-aws-platform") fail("us-east-1 stacks " + all(x, "StackName"));
x = await text(await cfn("eu-west-1", { Action: "ListStacks" }));
if (all(x, "StackName").length !== 0 || !/<StackSummaries><\/StackSummaries>/.test(x)) fail("eu-west-1 should have no stacks");
for (const id of all(await text(await cfn("eu-west-2", { Action: "ListStacks" })), "StackId"))
  if (!/^arn:aws:cloudformation:eu-west-2:111122223333:stack\/[a-z0-9-]+\/[0-9a-f-]{36}$/.test(id)) fail("StackId " + id);

// ListStacks: paged on NextToken (pages of 3, the twin's own), StackStatusFilter.member.N, a deleted stack kept
// (boto3.aws.a's review of patch 01: docs/boto3/2026-11-23__19-twin-cloudformation-reads.md)
x = await text(await cfn("eu-west-2", { Action: "ListStacks" }));
const tok = all(x, "NextToken")[0];
if (!tok) fail("a second page should be offered");
x = await text(await cfn("eu-west-2", { Action: "ListStacks", NextToken: tok }));
if (all(x, "StackName").join() !== "demo-site-old" || all(x, "StackStatus").join() !== "DELETE_COMPLETE" || all(x, "NextToken").length) fail("page 2: the deleted stack, last page " + all(x, "StackName"));
if (all(x, "DeletionTime").join() !== "2026-11-17T12:00:00Z") fail("the deleted stack carries its DeletionTime");
const goneArn = all(x, "StackId")[0];
for (const bad of ["nope", "twin-stacks-0", "twin-stacks-4", "twin-stacks-99999"]) {
  const r = await text(await cfn("eu-west-2", { Action: "ListStacks", NextToken: bad }), 400);
  if (!/<Code>ValidationError<\/Code>/.test(r)) fail("a bad NextToken is refused: " + bad);
}
x = await text(await cfn("eu-west-2", { Action: "ListStacks", "StackStatusFilter.member.1": "DELETE_COMPLETE" }));
if (all(x, "StackName").join() !== "demo-site-old") fail("filter DELETE_COMPLETE " + all(x, "StackName"));
x = await text(await cfn("eu-west-2", { Action: "ListStacks", "StackStatusFilter.member.1": "CREATE_COMPLETE", "StackStatusFilter.member.2": "UPDATE_ROLLBACK_COMPLETE" }));
if (all(x, "StackName").join() !== "demo-site,demo-dns,demo-lambda" || all(x, "NextToken").length) fail("filter two statuses " + all(x, "StackName"));
x = await text(await cfn("eu-west-2", { Action: "DescribeStacks", StackName: "demo-site-old" }), 400);
if (!/does not exist/.test(x)) fail("a deleted stack is not found by name");
x = await text(await cfn("eu-west-2", { Action: "DescribeStacks", StackName: goneArn }));
if (all(x, "StackStatus").join() !== "DELETE_COMPLETE" || all(x, "DeletionTime").join() !== "2026-11-17T12:00:00Z") fail("a deleted stack is found by its stack id");
x = await text(await cfn("eu-west-2", { Action: "ListExports" }));
if (all(x, "ExportingStackId").some((s) => s === goneArn)) fail("a deleted stack exports nothing");

// DescribeStacks: by name, by ARN, all in a region; Outputs with ExportName; unknown stack
x = await text(await cfn("us-east-1", { Action: "DescribeStacks", StackName: "sws-aws-platform" }));
if (all(x, "StackStatus").join() !== "CREATE_COMPLETE") fail("platform status " + all(x, "StackStatus"));
if (all(x, "OutputKey").join() !== "ReadRoleArn,ChangeRoleArn") fail("platform outputs");
if (all(x, "ParameterKey").join() !== "GoogleClientId,GoogleSub") fail("platform parameters");
const arn = all(x, "StackId")[0];
x = await text(await cfn("us-east-1", { Action: "DescribeStacks", StackName: arn }));
if (all(x, "StackName").join() !== "sws-aws-platform") fail("DescribeStacks by ARN");
x = await text(await cfn("eu-west-2", { Action: "DescribeStacks" }));
if (all(x, "StackName").length !== 3) fail("DescribeStacks with no name");
if (all(x, "ExportName").join() !== "demo-site-distribution-domain") fail("ExportName " + all(x, "ExportName"));
x = await text(await cfn("eu-west-2", { Action: "DescribeStacks", StackName: "sws-aws-platform" }), 400);
if (!/<Code>ValidationError<\/Code>/.test(x) || !/does not exist/.test(x)) fail("a stack in another region must not be found");

// ListStackResources: the joins to the other areas are the physical ids
x = await text(await cfn("eu-west-2", { Action: "ListStackResources", StackName: "demo-site" }));
if (all(x, "PhysicalResourceId").join() !== [T.buckets.site, T.buckets.logs, "EDEMOTWIN00001"].join()) fail("demo-site resources " + all(x, "PhysicalResourceId"));
x = await text(await cfn("eu-west-2", { Action: "ListStackResources", StackName: "demo-lambda" }));
if (!all(x, "PhysicalResourceId").includes(T.buckets.deps)) fail("demo-lambda makes the deps bucket");
x = await text(await cfn("us-east-1", { Action: "ListStackResources", StackName: "sws-aws-platform" }));
if (all(x, "PhysicalResourceId").join() !== "sws-aws-platform-read,sws-aws-platform-change") fail("platform resources");

// DescribeStackEvents: newest first, the failure and its reason on the rolled-back stack
x = await text(await cfn("eu-west-2", { Action: "DescribeStackEvents", StackName: "demo-lambda" }));
const ts = all(x, "Timestamp");
if (ts.join() !== ts.slice().sort().reverse().join()) fail("events not newest first");
if (all(x, "ResourceStatus")[0] !== "UPDATE_ROLLBACK_COMPLETE" || !all(x, "ResourceStatus").includes("UPDATE_FAILED")) fail("rollback events");
if (new Set(all(x, "EventId")).size !== ts.length) fail("EventIds not unique");

// ListExports and ListImports, per region
x = await text(await cfn("eu-west-2", { Action: "ListExports" }));
if (all(x, "Name").join() !== "demo-site-distribution-domain" || all(x, "Value").join() !== "d111111abcdef8.cloudfront.net") fail("exports");
x = await text(await cfn("eu-west-2", { Action: "ListImports", ExportName: "demo-site-distribution-domain" }));
if (!/<Imports><member>demo-dns<\/member><\/Imports>/.test(x)) fail("imports " + x);
await text(await cfn("us-east-1", { Action: "ListImports", ExportName: "demo-site-distribution-domain" }), 400);

// Unsigned
await text(await cfn("eu-west-2", { Action: "ListStacks" }, {}), 403);

// The hub's own stack follows a plan applied in the twin (CreateChangeSet then ExecuteChangeSet, as app.js does).
// Signed as the change role; the template fetch is not reached by these two actions' state changes, so stub fetch.
globalThis.document = { baseURI: "http://localhost/" };
globalThis.fetch = async () => new Response("Description: >-\n  twin\n");
const change = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCHANGE/x" };
await text(await cfn("us-east-1", { Action: "CreateChangeSet", StackName: "sws-aws-platform", ChangeSetName: "t1", TemplateBody: "Description: >-\n  new\n" }, change));
await text(await cfn("us-east-1", { Action: "ExecuteChangeSet", StackName: "sws-aws-platform", ChangeSetName: "t1" }, change));
x = await text(await cfn("us-east-1", { Action: "DescribeStacks", StackName: "sws-aws-platform" }));
if (all(x, "StackStatus").join() !== "UPDATE_COMPLETE" || all(x, "LastUpdatedTime").length !== 1) fail("platform after apply");
x = await text(await cfn("us-east-1", { Action: "DescribeStackEvents", StackName: "sws-aws-platform" }));
if (all(x, "ResourceStatus")[0] !== "UPDATE_COMPLETE") fail("apply event not first");
console.log("OK (twin CloudFormation reads)");

// On the journal (design 02): the hub stack's update is one cloudformation.executeChangeSet entry with the caller as
// actor, and refolding the journal gives the same status, last-updated time and events (dev.2.aws.a, on 3e936dc).
{
  const j = T.journal(), ex = j.filter((e) => e.op === "cloudformation.executeChangeSet");
  if (ex.length !== 1 || ex[0].actor !== "role:sws-aws-platform-change" || !/^arn:aws:cloudformation:us-east-1:/.test(ex[0].target) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(ex[0].data.t)) fail("executeChangeSet entry " + JSON.stringify(ex));
  const w = T.fold(j);
  const live = await text(await cfn("us-east-1", { Action: "DescribeStackEvents", StackName: "sws-aws-platform" }));
  if (w.stackStatus !== "UPDATE_COMPLETE" || w.stackUpdated !== ex[0].data.t || w.stackEvents.length !== 2 || !live.includes("<Timestamp>" + ex[0].data.t + "</Timestamp>")) fail("refold " + JSON.stringify({ status: w.stackStatus, updated: w.stackUpdated, events: w.stackEvents }));
  console.log("ok journal: executeChangeSet entry and refold");
}

// The customer account's ListStacks pages and filters the same way (boto3.aws.a's review, gaps 1 and 2).
{
  const CA = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/eu-west-2/cloudformation/aws4_request, SignedHeaders=host, Signature=twin" };
  const ids = ["0a1b2c3d4e5f", "1b2c3d4e5f60", "2c3d4e5f6071", "3d4e5f607182"];
  for (const id of ids) await text(await cfn("eu-west-2", { Action: "CreateStack", StackName: "sws-vault-" + id, TemplateURL: "https://example.invalid/vault.yaml",
    "Capabilities.member.1": "CAPABILITY_NAMED_IAM", "Parameters.member.1.ParameterKey": "VaultId", "Parameters.member.1.ParameterValue": id }, CA));
  let names = [], token, pages = 0;
  do { const r = await text(await cfn("eu-west-2", Object.assign({ Action: "ListStacks" }, token ? { NextToken: token } : {}), CA)); names = names.concat(all(r, "StackName")); token = all(r, "NextToken")[0]; pages++; } while (token && pages < 5);
  if (pages !== 2 || names.length !== 4 || new Set(names).size !== 4 || !ids.every((id) => names.includes("sws-vault-" + id))) fail("customer ListStacks: 2 pages, each stack once " + pages + " " + names);
  const f = await text(await cfn("eu-west-2", { Action: "ListStacks", "StackStatusFilter.member.1": "DELETE_COMPLETE" }, CA));
  if (all(f, "StackName").length || all(f, "NextToken").length) fail("customer filter: nothing deleted yet");
  const bad = await text(await cfn("eu-west-2", { Action: "ListStacks", NextToken: "twin-stacks-7" }, CA), 400);
  if (!/ValidationError/.test(bad)) fail("customer: a NextToken past the end is refused");
  console.log("ok customer ListStacks: paging, filter, bad token");
}
