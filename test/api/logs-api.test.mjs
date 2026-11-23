// LogsApi (site/api/logs-api.js): over the twin through the real transport and SigV4 (groups, events, newest first,
// patterns, paging and ApiAll), LogsApi.invocations against the twin's metrics, then errors and request shapes over a
// recording send, then its contract (site/api/logs.openapi.json): one operation per method, the same arguments, and
// each method's real request needs exactly its listed IAM action. Needs the twin's CloudWatch Logs (lambda.aws.a's
// patch, on work/dev.1.aws.a). Node 22, no network. Run: node test/api/logs-api.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array,
  setTimeout, crypto: globalThis.crypto, console, btoa,
  location: { search: "?twin", origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/logs-api.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { LogsApi, AwsTwin } = ctx;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const rejects = async (p, test, m) => { try { await p; ok(false, m + ": did not reject"); } catch (e) { ok(test(e), m + ": " + e.message); } };
const A = AwsTwin.account, R = "eu-west-2";

const assume = async (role) => {
  const r = await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/" + role, RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() });
  const t = await r.text(), g = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1];
  return { accessKeyId: g("AccessKeyId"), secretAccessKey: g("SecretAccessKey"), sessionToken: g("SessionToken") };
};
const creds = await assume("sws-aws-platform-read");
const send = async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body });
const metric = async (fn, name, stat, start, end) => {
  const p = { Action: "GetMetricData", Version: "2010-08-01", StartTime: start, EndTime: end, "MetricDataQueries.member.1.Id": "m1",
    "MetricDataQueries.member.1.MetricStat.Metric.Namespace": "AWS/Lambda", "MetricDataQueries.member.1.MetricStat.Metric.MetricName": name,
    "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Name": "FunctionName", "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Value": fn,
    "MetricDataQueries.member.1.MetricStat.Period": "3600", "MetricDataQueries.member.1.MetricStat.Stat": stat };
  const r = await send({ service: "monitoring", region: R, method: "POST", url: "https://monitoring." + R + ".amazonaws.com/", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(p).toString() });
  const x = await r.text();
  return [...(/<Values>(.*?)<\/Values>/.exec(x) || ["", ""])[1].matchAll(/<member>([^<]*)<\/member>/g)].map((a) => +a[1]);
};

// ---- over the twin ----
const logs = LogsApi(send);
const gp = await logs.groups(R, { prefix: "/aws/lambda/" });
ok(gp.next === null && gp.items.map((g) => g.name).join() === "/aws/lambda/demo-handler,/aws/lambda/demo-log-enricher,/aws/lambda/demo-nightly-report", "groups " + JSON.stringify(gp.items.map((g) => g.name)));
const g0 = gp.items[0];
ok(g0.arn === "arn:aws:logs:" + R + ":" + A + ":log-group:/aws/lambda/demo-handler" && g0.region === R && /^2026-11-18T/.test(g0.created) && g0.retentionDays === 30 && g0.storedBytes > 0, "group shape " + JSON.stringify(g0));
const two = await logs.groups(R, { max: 2 }), rest = await logs.groups(R, { max: 2, next: two.next });
ok(two.items.length === 2 && two.next && rest.items.length === 1 && rest.next === null, "groups paging");

const day = { start: "2026-11-21T00:00:00Z", end: "2026-11-21T23:59:59Z" };
const all = await ctx.ApiAll((next) => logs.events(R, "/aws/lambda/demo-handler", Object.assign({ max: 7, next }, day)), { maxItems: 10000 });
ok(!all.capped && all.items.length > 0 && all.items.every((e) => typeof e.timestamp === "number" && e.time === new Date(e.timestamp).toISOString() && /^2026\/11\/21\//.test(e.stream) && e.id), "events drained " + all.items.length);
for (let i = 1; i < all.items.length; i++) if (all.items[i].timestamp < all.items[i - 1].timestamp) { ok(false, "events out of order"); break; }
const newest = await logs.events(R, "/aws/lambda/demo-handler", Object.assign({ newest: true, max: 3 }, day));
ok(newest.items.map((e) => e.id).join() === all.items.slice(-3).reverse().map((e) => e.id).join(), "newest first");
const byArn = await logs.events(R, "arn:aws:logs:" + R + ":" + A + ":log-group:/aws/lambda/demo-handler:*", Object.assign({ pattern: "REPORT" }, day));
ok(byArn.items.length && byArn.items.every((e) => e.message.startsWith("REPORT ")), "by ARN, REPORT pattern");
const ms = await logs.events(R, "/aws/lambda/demo-handler", { start: Date.parse(day.start), end: Date.parse(day.end), pattern: "REPORT" });
ok(ms.items.length === byArn.items.length, "epoch ms window equals ISO window");

// invocations: one per vault API request, durations and memory from REPORT, the metric's mean, nothing incomplete
const inv = LogsApi.invocations(all.items);
ok(inv.length === byArn.items.length && inv.every((v) => v.complete && v.start && v.end && v.durationMs > 0 && v.billedMs >= v.durationMs && v.memoryMb === 256 && v.maxMemoryMb > 0 && v.errors === 0 && v.lines.length === 3), "invocations " + JSON.stringify(inv[0]));
const hour = all.items.filter((e) => e.time >= "2026-11-21T10:00:00" && e.time < "2026-11-21T11:00:00");
const ih = LogsApi.invocations(hour), avg = await metric("demo-handler", "Duration", "Average", "2026-11-21T10:00:00Z", "2026-11-21T11:00:00Z");
ok(ih.length && Math.abs(ih.reduce((a, v) => a + v.durationMs, 0) / ih.length - avg[0]) < 0.01, "mean REPORT Duration " + avg[0]);
// a page cut mid-invocation: newest first, the last two lines (REPORT, END) have no START; a lone START is incomplete
const cut = LogsApi.invocations(newest.items.slice(0, 2)), lone = LogsApi.invocations(all.items.slice(0, 1));
ok(cut.length === 1 && cut[0].complete && cut[0].start === null && cut[0].durationMs > 0, "cut page: REPORT without START " + JSON.stringify(cut[0]));
ok(lone.length === 1 && !lone[0].complete && lone[0].start && lone[0].durationMs === null && LogsApi.invocations([]).length === 0, "lone START is incomplete");
const en = LogsApi.invocations((await logs.events(R, "/aws/lambda/demo-log-enricher", { start: "2026-11-21T10:00:00Z", end: "2026-11-21T10:59:59Z" })).items);
ok(en.length === 4 && en.every((v) => v.complete && v.lines.length === 4 && v.memoryMb === 128), "enricher: 4 runs, INFO line joined");

// the attack pack: [ERROR] lines counted per invocation, equal to the metric's Errors
ctx.location.search = "?twin&pack=attack"; vm.runInContext(readFileSync(new URL("../../site/twin.js", import.meta.url), "utf8"), ctx, { filename: "twin.js" });
const atk = await ctx.ApiAll((next) => logs.events(R, "/aws/lambda/demo-handler", { start: "2026-11-22T00:00:00Z", end: "2026-11-22T23:59:59Z", max: 10000, next }));
const ai = LogsApi.invocations(atk.items), mErr = (await metric("demo-handler", "Errors", "Sum", "2026-11-22T00:00:00Z", "2026-11-23T00:00:00Z")).reduce((a, b) => a + b, 0);
ok(mErr > 0 && ai.reduce((a, v) => a + v.errors, 0) === mErr && ai.filter((v) => v.errors).every((v) => v.lines.length === 4), "attack errors " + mErr);
const quoted = await logs.events(R, "/aws/lambda/demo-handler", { start: "2026-11-22T00:00:00Z", end: "2026-11-22T23:59:59Z", pattern: "\"[ERROR]\"" });
ok(quoted.items.length === mErr, "quoted [ERROR] pattern");

// ---- errors and request shapes over a recording send ----
const seen = [];
const rec = (status, body, headers) => async (rq) => { seen.push(rq); return new Response(body, { status, headers: headers || {} }); };
await rejects(LogsApi(rec(400, JSON.stringify({ __type: "com.amazonaws.logs#ResourceNotFoundException", message: "The specified log group does not exist." })))
  .events(R, "/aws/lambda/x"), (e) => e.code === "ResourceNotFoundException" && e.status === 400, "#-prefixed __type");
await rejects(LogsApi(rec(400, JSON.stringify({ __type: "InvalidParameterException:extra", message: "bad" }))).groups(R), (e) => e.code === "InvalidParameterException", "__type cut at ':'");
await rejects(LogsApi(rec(503, "busy")).groups(R), (e) => e.code === "HTTP 503" && e.status === 503, "non-JSON error");
seen.length = 0;
await rejects(logs.groups("eu-west-2.evil.example/x"), (e) => e instanceof ctx.TypeError || e.name === "TypeError", "bad region");
await rejects(LogsApi(rec(200, "{}")).events(R, ""), (e) => e.name === "TypeError", "no group");
await rejects(LogsApi(rec(200, "{}")).events(R, "/g", { start: "not a time" }), (e) => e.name === "TypeError", "bad time");
ok(seen.length === 0, "no request made for bad arguments");
await LogsApi(rec(200, JSON.stringify({ events: [] }))).events(R, "/aws/lambda/demo-handler", { start: "2026-11-21T00:00:00Z", end: 1795000000000, pattern: "REPORT", newest: true, max: 99999, next: "t1" });
const body = JSON.parse(seen[0].body);
ok(seen[0].url === "https://logs." + R + ".amazonaws.com/" && seen[0].method === "POST" && seen[0].service === "logs" && seen[0].headers["x-amz-target"] === "Logs_20140328.FilterLogEvents" && seen[0].headers["content-type"] === "application/x-amz-json-1.1", "request line");
ok(body.logGroupName === "/aws/lambda/demo-handler" && body.startTime === Date.parse("2026-11-21T00:00:00Z") && body.endTime === 1795000000000 && body.filterPattern === "REPORT" && body.startFromHead === false && body.limit === 10000 && body.nextToken === "t1" && !("logGroupIdentifier" in body), "request body " + seen[0].body);
seen.length = 0;
await LogsApi(rec(200, JSON.stringify({ logGroups: [] }))).groups(R, { max: 500 });
ok(JSON.parse(seen[0].body).limit === 50 && !("logGroupNamePrefix" in JSON.parse(seen[0].body)), "groups limit capped at 50, no empty prefix sent");

// ---- contract ----
const doc = JSON.parse(readFileSync(new URL("../../site/api/logs.openapi.json", import.meta.url), "utf8"));
const ops = Object.values(doc.paths).flatMap((p) => Object.values(p));
const deny = async (rq) => { seen.push(rq); return new Response(JSON.stringify({ __type: "AccessDeniedException", message: "no" }), { status: 400 }); };
const api = LogsApi(deny), samples = { groups: [R, {}], events: [R, "/aws/lambda/demo-handler", {}] };
ok(doc.openapi === "3.1.0" && doc.servers.length === 0, "OpenAPI 3.1, no server");
ok(JSON.stringify(ops.map((o) => o.operationId).sort()) === JSON.stringify(Object.keys(api).sort()), "one operation per method");
for (const o of ops) {
  const args = o["x-arguments"].slice(o["x-arguments"].indexOf("(") + 1, -1).replace(/\{[^}]*\}/g, "x").split(",").filter((x) => x.trim());
  ok(o["x-arguments"].startsWith(o.operationId + "(") && args.length === api[o.operationId].length, o.operationId + ": arguments");
  ok(o["x-role"] === "read" && o["x-aws-actions"].length === 1 && /^logs:(Describe|Filter)[A-Za-z]+$/.test(o["x-aws-actions"][0]), o.operationId + ": read action");
  seen.length = 0;
  await rejects(api[o.operationId](...samples[o.operationId]), (e) => e.code === "AccessDeniedException", o.operationId + " denied");
  ok(seen.length === 1 && o["x-aws-actions"][0] === "logs:" + seen[0].headers["x-amz-target"].split(".")[1], o.operationId + ": request needs exactly " + o["x-aws-actions"]);
}
const walk = (v) => { if (Array.isArray(v)) return v.every(walk); if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => k === "$ref" ? !!x.replace(/^#\//, "").split("/").reduce((a, p) => a && a[p], doc) : walk(x)); return true; };
ok(walk(doc), "every $ref resolves");
ok(doc["x-not-requests"] && doc["x-not-requests"].invocations && typeof LogsApi.invocations === "function", "invocations documented as no request");

// dev.2.aws.a, on taking the patch: the region is read once (R-023 b), and the source has no markup or eval sinks.
{
  const hosts = []; const h = LogsApi(async (rq) => { hosts.push(rq.url + " " + rq.region); return new Response(JSON.stringify({ logGroups: [] })); });
  await h.groups({ n: 0, toString() { return this.n++ ? "evil.example/x" : "eu-west-2"; } });
  ok(hosts.length === 1 && hosts[0] === "https://logs.eu-west-2.amazonaws.com/ eu-west-2", "the region string tested is the one used: " + hosts);
  const src = (await import("node:fs")).readFileSync(new URL("../../site/api/logs-api.js", import.meta.url), "utf8");
  ok(!/\beval\(|new Function|innerHTML|document\./.test(src), "no eval or HTML in the source: messages stay text");
  let sent = 0; const n = LogsApi(async () => { sent++; return new Response(JSON.stringify({ events: [] })); });
  await rejects(n.events("eu-west-2", "/g", { newest: true, start: "2023-12-31T23:59:59Z" }), (e) => e.name === "TypeError" && /2024-01-01/.test(e.message), "newest with a start before 2024 is refused (AWS's InvalidParameterException)");
  ok(sent === 0, "nothing sent for it");
  await n.events("eu-west-2", "/g", { newest: true, start: "2024-01-01T00:00:00Z" });
  ok(sent === 1, "newest with a start on 2024-01-01 is sent");
}

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (logs: " + passed + " checks; twin reads, invocations against metrics, attack errors, request shapes, errors, contract)");
