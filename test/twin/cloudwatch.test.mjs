// The twin's CloudWatch GetMetricData (Query protocol, 2010-08-01): Firehose and Lambda metrics built from the
// hourly log files the stream delivered, so the numbers agree with the logs; descending by default, ascending on
// request; no datapoints for a function that did not run; the attack pack shows as Lambda errors; unsigned calls
// refused. Node 22; no network.
import { readFileSync } from "node:fs";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const src = readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8");
globalThis.window = globalThis;
const load = (search) => { globalThis.location = { origin: "http://localhost", search }; new Function(src)(); return globalThis.AwsTwin; };
const auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
const CW = "https://monitoring.eu-west-2.amazonaws.com/";
const call = (T, params, h) => T.handle(CW, { method: "POST", headers: Object.assign({ "content-type": "application/x-www-form-urlencoded" }, h === undefined ? auth : h), body: new URLSearchParams(params).toString() });
const query = (ns, name, dim, val, stat, extra) => Object.assign({ Action: "GetMetricData", Version: "2010-08-01", StartTime: "2026-11-20T00:00:00Z", EndTime: "2026-11-23T00:00:00Z",
  "MetricDataQueries.member.1.Id": "m1", "MetricDataQueries.member.1.MetricStat.Metric.Namespace": ns, "MetricDataQueries.member.1.MetricStat.Metric.MetricName": name,
  "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Name": dim, "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Value": val,
  "MetricDataQueries.member.1.MetricStat.Period": "3600", "MetricDataQueries.member.1.MetricStat.Stat": stat }, extra || {});
const members = (x, tag) => { const m = new RegExp("<" + tag + ">(.*?)</" + tag + ">").exec(x); return m ? [...m[1].matchAll(/<member>([^<]*)<\/member>/g)].map((a) => a[1]) : []; };
const series = async (T, ...a) => { const r = await call(T, query(...a)); const x = await r.text(); if (r.status !== 200) fail(a[1] + " status " + r.status + " " + x); return { t: members(x, "Timestamps"), v: members(x, "Values").map(Number), x }; };
const lines = async (T, key) => {
  const r = await T.handle("https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/" + key, { method: "GET", headers: auth });
  const txt = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  return txt.trim().split("\n").map((l) => JSON.parse(l));
};
const key = (iso) => { const [d, h] = [iso.slice(8, 10), iso.slice(11, 13)]; return "cloudfront/2026/11/" + d + "/" + h + "/demo-distribution-1-2026-11-" + d + "-" + h + "-00-00.gz"; };
const api = (L) => L.filter((l) => /^\/vault\/[^/]+\/files/.test(l.cs_uri_stem));

let T = load("");
// Firehose records per hour are the lines in that hour's delivered file
const fr = await series(T, "AWS/Firehose", "DeliveryToS3.Records", "DeliveryStreamName", "demo-cloudfront-logs", "Sum");
if (fr.t.length !== 9) fail("expected 9 hourly datapoints, got " + fr.t.length);
if (fr.t[0] !== "2026-11-22T11:00:00Z" || fr.t[8] !== "2026-11-20T09:00:00Z") fail("not descending by default: " + fr.t[0] + " .. " + fr.t[8]);
for (let i = 0; i < 9; i++) { const L = await lines(T, key(fr.t[i])); if (L.length !== fr.v[i]) fail("records " + fr.t[i] + ": " + fr.v[i] + " vs " + L.length + " lines"); }
if (!/^<GetMetricDataResponse xmlns="http:\/\/monitoring.amazonaws.com\/doc\/2010-08-01\/">/.test(fr.x) || !fr.x.includes("<StatusCode>Complete</StatusCode>")) fail("response shape");
// demo-handler invocations are the vault API requests in the logs
const inv = await series(T, "AWS/Lambda", "Invocations", "FunctionName", "demo-handler", "Sum");
for (let i = 0; i < 9; i++) { const n = api(await lines(T, key(inv.t[i]))).length; if (n !== inv.v[i]) fail("invocations " + inv.t[i] + ": " + inv.v[i] + " vs " + n); }
const err = await series(T, "AWS/Lambda", "Errors", "FunctionName", "demo-handler", "Sum");
if (err.v.some((v) => v !== 0)) fail("errors on a normal day: " + err.v);
const dur = await series(T, "AWS/Lambda", "Duration", "FunctionName", "demo-handler", "Average");
if (!dur.v.length || dur.v.some((v) => !(v > 0 && v < 200))) fail("duration out of range: " + dur.v);
// ascending on request; a window; a function that did not run; the enricher
const asc = await call(T, query("AWS/Firehose", "IncomingRecords", "DeliveryStreamName", "demo-cloudfront-logs", "Sum", { ScanBy: "TimestampAscending", StartTime: "2026-11-21T10:00:00Z", EndTime: "2026-11-21T12:00:00Z" }));
const at = members(await asc.text(), "Timestamps");
if (at.join() !== "2026-11-21T10:00:00Z,2026-11-21T11:00:00Z") fail("ascending window: " + at);
if ((await series(T, "AWS/Lambda", "Invocations", "FunctionName", "demo-nightly-report", "Sum")).t.length !== 0) fail("nightly report ran by day");
if ((await series(T, "AWS/Lambda", "Invocations", "FunctionName", "demo-log-enricher", "Sum")).v.some((v) => v !== 4)) fail("enricher not 4 an hour (900 s buffer)");
// refusals
if ((await call(T, query("AWS/Lambda", "Invocations", "FunctionName", "demo-handler", "Sum"), {})).status !== 403) fail("unsigned call answered");
// Period as AWS takes it (boto3.aws.a): 60 is valid (Complete, no datapoints, a note, since the twin keeps hours);
// 86400 sums the hours of each day; 90 is not a valid period
let p60 = await call(T, query("AWS/Lambda", "Invocations", "FunctionName", "demo-handler", "Sum", { "MetricDataQueries.member.1.MetricStat.Period": "60" }));
let x60 = await p60.text();
if (p60.status !== 200 || members(x60, "Timestamps").length !== 0 || !x60.includes("<StatusCode>Complete</StatusCode>") || !x60.includes("TwinHourlyOnly")) fail("Period 60: " + p60.status + " " + x60.slice(0, 200));
const day = await call(T, query("AWS/Firehose", "DeliveryToS3.Records", "DeliveryStreamName", "demo-cloudfront-logs", "Sum", { "MetricDataQueries.member.1.MetricStat.Period": "86400" }));
const dx = await day.text(), dt = members(dx, "Timestamps"), dv = members(dx, "Values").map(Number);
if (dt.join() !== "2026-11-22T00:00:00Z,2026-11-21T00:00:00Z,2026-11-20T00:00:00Z") fail("daily buckets: " + dt);
const want22 = fr.v.slice(0, 3).reduce((a, b) => a + b, 0);
if (dv[0] !== want22) fail("daily sum 22 Nov: " + dv[0] + " vs " + want22);
if ((await call(T, query("AWS/Lambda", "Invocations", "FunctionName", "demo-handler", "Sum", { "MetricDataQueries.member.1.MetricStat.Period": "90" }))).status !== 400) fail("Period 90 accepted");
// a metric is matched on its exact dimensions: an extra dimension finds nothing
const extra = await call(T, query("AWS/Lambda", "Invocations", "FunctionName", "demo-handler", "Sum", { "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.2.Name": "Resource", "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.2.Value": "demo-handler" }));
if (members(await extra.text(), "Timestamps").length !== 0) fail("extra dimension matched");
if ((await call(T, { Action: "PutMetricData" })).status !== 400) fail("PutMetricData answered");
if ((await call(T, query("AWS/Lambda", "Invocations", "FunctionName", "demo-handler", "Sum", { EndTime: "2026-11-19T00:00:00Z" }))).status !== 400) fail("EndTime before StartTime accepted");

// attack pack: the probes on the vault API show as demo-handler errors on 22 Nov only
T = load("?pack=attack");
const ae = await series(T, "AWS/Lambda", "Errors", "FunctionName", "demo-handler", "Sum");
const on22 = ae.t.map((t, i) => [t, ae.v[i]]).filter((p) => p[0].startsWith("2026-11-22"));
if (!on22.some((p) => p[1] > 0) || ae.t.some((t, i) => !t.startsWith("2026-11-22") && ae.v[i] > 0)) fail("attack errors: " + JSON.stringify(ae));
for (const [t, v] of on22) { const n = api(await lines(T, key(t))).filter((l) => l.sc_status >= 400).length; if (n !== v) fail("attack errors " + t + ": " + v + " vs " + n); }
console.log("OK (cloudwatch: Firehose records = lines delivered, demo-handler = vault API requests, order, window, refusals, attack errors)");
