// The twin's CloudWatch Logs (JSON 1.1, Logs_20140328): DescribeLogGroups lists the three Lambda log groups;
// FilterLogEvents gives START, END and REPORT per invocation, and they agree with GetMetricData and the delivered
// CloudFront logs (demo-handler: one invocation per vault API request, REPORT Duration its time_taken; errors only in
// the attack pack on 22 Nov; demo-log-enricher: 4 runs an hour); time window, stream prefix, filter patterns, paging,
// the ARN form, errors as AWS names them; unsigned calls refused. Node 22; no network.
import { readFileSync } from "node:fs";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const src = readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8");
globalThis.window = globalThis;
const load = (search) => { globalThis.location = { origin: "http://localhost", search }; new Function(src)(); return globalThis.AwsTwin; };
const auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
const LOGS = "https://logs.eu-west-2.amazonaws.com/";
const call = async (T, target, q, h) => {
  const r = await T.handle(LOGS, { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": "Logs_20140328." + target }, h === undefined ? auth : h), body: JSON.stringify(q) });
  return { status: r.status, type: r.headers.get("content-type"), j: await r.json() };
};
const ok = async (T, target, q) => { const r = await call(T, target, q); if (r.status !== 200) fail(target + " " + r.status + " " + JSON.stringify(r.j)); return r.j; };
const ms = (iso) => Date.parse(iso);
const day = (d) => ({ startTime: ms("2026-11-" + d + "T00:00:00Z"), endTime: ms("2026-11-" + d + "T23:59:59Z") });
const lines = async (T, d, h) => {
  // The hour's one file, by listing its folder (Firehose's names end in a uuid, design 06).
  const ls = await (await T.handle("https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/?list-type=2&prefix=" + encodeURIComponent("cloudfront/2026/11/" + d + "/" + h + "/"), { method: "GET", headers: auth })).text();
  const keys = [...ls.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]);
  if (keys.length !== 1 || !/\/demo-cloudfront-logs-1-2026-11-\d{2}-\d{2}-00-00-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.gz$/.test(keys[0])) fail("one Firehose-named file per hour: " + keys.join());
  const key = keys[0];
  const r = await T.handle("https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/" + key, { method: "GET", headers: auth });
  return (await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text()).trim().split("\n").map((l) => JSON.parse(l));
};
const metric = async (T, fn, name, stat, start, end) => {
  const p = { Action: "GetMetricData", Version: "2010-08-01", StartTime: start, EndTime: end, "MetricDataQueries.member.1.Id": "m1",
    "MetricDataQueries.member.1.MetricStat.Metric.Namespace": "AWS/Lambda", "MetricDataQueries.member.1.MetricStat.Metric.MetricName": name,
    "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Name": "FunctionName", "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Value": fn,
    "MetricDataQueries.member.1.MetricStat.Period": "3600", "MetricDataQueries.member.1.MetricStat.Stat": stat };
  const x = await (await T.handle("https://monitoring.eu-west-2.amazonaws.com/", { method: "POST", headers: auth, body: new URLSearchParams(p).toString() })).text();
  return [...(/<Values>(.*?)<\/Values>/.exec(x) || ["", ""])[1].matchAll(/<member>([^<]*)<\/member>/g)].map((a) => +a[1]);
};
const api = (L) => L.filter((l) => /^\/vault\/[^/]+\/files/.test(l.cs_uri_stem));

let T = load("");
// DescribeLogGroups
const lg = await ok(T, "DescribeLogGroups", {});
if (lg.logGroups.map((g) => g.logGroupName).join() !== "/aws/lambda/demo-handler,/aws/lambda/demo-log-enricher,/aws/lambda/demo-nightly-report") fail("groups " + JSON.stringify(lg.logGroups.map((g) => g.logGroupName)));
const g0 = lg.logGroups[0];
if (g0.arn !== "arn:aws:logs:eu-west-2:" + T.account + ":log-group:/aws/lambda/demo-handler:*" || g0.logGroupArn !== g0.arn.slice(0, -2) || !(g0.storedBytes > 0) || typeof g0.creationTime !== "number") fail("group shape " + JSON.stringify(g0));
if ((await ok(T, "DescribeLogGroups", { logGroupNamePrefix: "/aws/lambda/demo-n" })).logGroups.length !== 1) fail("prefix");
// demo-handler on 21 Nov, 10:00 to 10:59: one invocation per vault API request in that hour's file, REPORT = time_taken
const hour = { startTime: ms("2026-11-21T10:00:00Z"), endTime: ms("2026-11-21T10:59:59.999Z") };
const ev = (await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler" }, hour))).events;
const A = api(await lines(T, "21", "10"));
const starts = ev.filter((e) => e.message.startsWith("START RequestId: ")), reports = ev.filter((e) => e.message.startsWith("REPORT RequestId: "));
if (starts.length !== A.length || reports.length !== A.length || ev.filter((e) => e.message.startsWith("END ")).length !== A.length) fail("invocations " + starts.length + " vs " + A.length + " requests");
if (!/^START RequestId: [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12} Version: \$LATEST\n$/.test(starts[0].message)) fail("START line " + JSON.stringify(starts[0].message));
if (!/^REPORT RequestId: \S+\tDuration: \d+\.\d\d ms\tBilled Duration: \d+ ms\tMemory Size: 256 MB\tMax Memory Used: \d+ MB\t\n$/.test(reports[0].message)) fail("REPORT line " + JSON.stringify(reports[0].message));
const durs = reports.map((e) => +/Duration: ([\d.]+) ms/.exec(e.message)[1]).sort((a, b) => a - b), want = A.map((l) => +(l.time_taken * 1000).toFixed(2)).sort((a, b) => a - b);
if (durs.join() !== want.join()) fail("durations differ from time_taken");
const avg = await metric(T, "demo-handler", "Duration", "Average", "2026-11-21T10:00:00Z", "2026-11-21T11:00:00Z");
if (Math.abs(avg[0] - durs.reduce((a, b) => a + b, 0) / durs.length) > 0.01) fail("REPORT mean " + avg[0] + " vs metric");
for (let i = 1; i < ev.length; i++) if (ev[i].timestamp < ev[i - 1].timestamp) fail("not in time order");
if (new Set(ev.map((e) => e.eventId)).size !== ev.length || new Set(ev.map((e) => e.logStreamName)).size !== 1) fail("event ids or one stream per hour");
if (!/^2026\/11\/21\/\[\$LATEST\][0-9a-f]{32}$/.test(ev[0].logStreamName) || !(ev[0].ingestionTime > ev[0].timestamp)) fail("stream name or ingestion " + JSON.stringify(ev[0]));
if (ev.some((e) => e.message.startsWith("[ERROR]"))) fail("errors on a normal day");
// the enricher: 4 runs an hour, as the metric says
const en = (await ok(T, "FilterLogEvents", Object.assign({ logGroupIdentifier: "arn:aws:logs:eu-west-2:" + T.account + ":log-group:/aws/lambda/demo-log-enricher:*" }, hour))).events;
if (en.filter((e) => e.message.startsWith("START")).length !== 4) fail("enricher runs " + en.length);
const enriched = en.filter((e) => e.message.startsWith("[INFO]")).reduce((a, e) => a + +/Enriched (\d+) records/.exec(e.message)[1], 0);
if (enriched !== (await lines(T, "21", "10")).length) fail("enricher records " + enriched);
// the nightly report did not run in these hours
if ((await ok(T, "FilterLogEvents", { logGroupName: "/aws/lambda/demo-nightly-report" })).events.length !== 0) fail("nightly report ran by day");
// filter patterns: plain terms, ?terms, -terms, "phrases"; paging with nextToken; stream prefix
const all = (await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler" }, day("21")))).events;
const rep = (await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", filterPattern: "REPORT" }, day("21")))).events;
if (!rep.length || rep.length !== all.filter((e) => e.message.includes("REPORT")).length) fail("REPORT filter");
const se = (await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", filterPattern: "?START ?END" }, day("21")))).events;
if (se.length !== 2 * rep.length) fail("?START ?END " + se.length);
if ((await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", filterPattern: "RequestId -REPORT -START" }, day("21")))).events.length !== rep.length) fail("-terms");
if ((await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", filterPattern: "\"Memory Size: 256 MB\"" }, day("21")))).events.length !== rep.length) fail("phrase");
if ((await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", filterPattern: "report" }, day("21")))).events.length !== 0) fail("case-insensitive match");
let got = [], tok;
do { const p = await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", limit: 5 }, day("21"), tok ? { nextToken: tok } : {})); if (p.events.length > 5) fail("limit"); got = got.concat(p.events); tok = p.nextToken; } while (tok);
if (got.map((e) => e.eventId).join() !== all.map((e) => e.eventId).join()) fail("paging lost or repeated events");
const s0 = all[0].logStreamName;
if ((await ok(T, "FilterLogEvents", { logGroupName: "/aws/lambda/demo-handler", logStreamNamePrefix: s0 })).events.some((e) => e.logStreamName !== s0)) fail("stream prefix");
// errors, as AWS names them, and refusals
const bad = [
  [{ logGroupName: "/aws/lambda/nope" }, 400, "ResourceNotFoundException"],
  [{ logGroupName: "/aws/lambda/demo-handler", logGroupIdentifier: "/aws/lambda/demo-handler" }, 400, "InvalidParameterException"],
  [{ logGroupName: "/aws/lambda/demo-handler", limit: 0 }, 400, "InvalidParameterException"],
  [{ logGroupName: "/aws/lambda/demo-handler", nextToken: "twin-5" }, 400, "InvalidParameterException"],
  [{ logGroupName: "/aws/lambda/demo-handler", filterPattern: "{ $.level = \"ERROR\" }" }, 400, "InvalidParameterException"],
  [{ logGroupName: "constructor" }, 400, "ResourceNotFoundException"],
  [{ logGroupName: "/aws/lambda/__proto__" }, 400, "ResourceNotFoundException"]];
for (const [q, st, type] of bad) { const r = await call(T, "FilterLogEvents", q); if (r.status !== st || r.j.__type !== type) fail(JSON.stringify(q) + " -> " + r.status + " " + JSON.stringify(r.j)); }
{ const w = await call(T, "PutLogEvents", {}); if (w.j.__type !== "UnknownOperationException" || w.status !== 404) fail("write call answered " + w.status); } // 404 per the Logs CommonErrors page
// boto3.aws.a's note 11: ?terms combined with other terms are ignored; startFromHead false is newest first;
// searchedLogStreams comes back empty; a missing group parameter is a parameter error; 56-digit event ids
if ((await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", filterPattern: "?START ?END REPORT" }, day("21")))).events.length !== rep.length) fail("?terms not ignored beside a plain term");
const newest = await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", startFromHead: false, limit: 3 }, day("21")));
if (newest.events.map((e) => e.eventId).join() !== all.slice(-3).reverse().map((e) => e.eventId).join()) fail("startFromHead false not newest first");
if (!Array.isArray(newest.searchedLogStreams) || newest.searchedLogStreams.length) fail("searchedLogStreams");
// startFromHead as botocore documents it: false is refused for a startTime before 2024 (or none); the token's direction wins
for (const q of [{ startTime: ms("2023-12-31T23:59:59Z") }, {}])
  if ((await call(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", startFromHead: false }, q))).j.__type !== "InvalidParameterException") fail("startFromHead false before 2024 accepted " + JSON.stringify(q));
{ let got2 = [], t2; do { const p = await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", limit: 4 }, day("21"), t2 ? { nextToken: t2, startFromHead: true } : { startFromHead: false })); got2 = got2.concat(p.events); t2 = p.nextToken; } while (t2);
  if (got2.map((e) => e.eventId).join() !== all.slice().reverse().map((e) => e.eventId).join()) fail("token direction does not win over startFromHead"); }
if (!all.every((e) => /^\d{56}$/.test(e.eventId))) fail("event id form " + all[0].eventId);
{ const m = await call(T, "FilterLogEvents", {}); if (m.j.__type !== "InvalidParameterException") fail("missing group " + JSON.stringify(m.j)); }
// DescribeLogGroups: pattern (three fields only), prefix and pattern exclusive, empty prefix refused, limit and paging
const pg = (await ok(T, "DescribeLogGroups", { logGroupNamePattern: "log-enr" })).logGroups;
if (pg.length !== 1 || Object.keys(pg[0]).sort().join() !== "arn,creationTime,logGroupName") fail("pattern " + JSON.stringify(pg));
for (const q of [{ logGroupNamePrefix: "/aws", logGroupNamePattern: "x" }, { logGroupNamePrefix: "" }, { limit: 51 }, { nextToken: "x" }])
  if ((await call(T, "DescribeLogGroups", q)).j.__type !== "InvalidParameterException") fail("DescribeLogGroups accepted " + JSON.stringify(q));
const p1 = await ok(T, "DescribeLogGroups", { limit: 2 }), p2 = await ok(T, "DescribeLogGroups", { limit: 2, nextToken: p1.nextToken });
if (p1.logGroups.length !== 2 || !p1.nextToken || p2.logGroups.length !== 1 || p2.nextToken) fail("DescribeLogGroups paging");
if ((await call(T, "FilterLogEvents", { logGroupName: "/aws/lambda/demo-handler" }, {})).status !== 403) fail("unsigned call answered");
if ((await call(T, "DescribeLogGroups", {})).type !== "application/x-amz-json-1.1") fail("content type");
// the attack pack: [ERROR] lines on 22 Nov equal the metric's Errors
T = load("?pack=attack"); T.reset();
const errs = (await ok(T, "FilterLogEvents", Object.assign({ logGroupName: "/aws/lambda/demo-handler", filterPattern: "\"[ERROR]\"" }, day("22")))).events;
const mErr = (await metric(T, "demo-handler", "Errors", "Sum", "2026-11-22T00:00:00Z", "2026-11-23T00:00:00Z")).reduce((a, b) => a + b, 0);
if (!errs.length || errs.length !== mErr) fail("attack errors " + errs.length + " vs metric " + mErr);
if (!/^\[ERROR\]\t2026-11-22T\S+Z\t\S+\tRequest refused with 4\d\d: /.test(errs[0].message)) fail("ERROR line " + JSON.stringify(errs[0].message));
console.log("ok twin/logs (" + all.length + " events on 21 Nov for demo-handler; " + errs.length + " errors in the attack pack)");
