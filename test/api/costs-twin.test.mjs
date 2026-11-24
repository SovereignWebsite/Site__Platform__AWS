// CostsApi over the twin's Cost Explorer and Budgets reads (58d3bf6), signed as the page signs: the Costs tab's views
// (month to date, forecast, 30 days daily, by service, by region, budgets) from one API, adding up across views, every
// answer synthetic. Node 22, no network. Run: node test/api/costs-twin.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array, Map, Set,
  setTimeout, crypto: globalThis.crypto, console, btoa, atob, encodeURIComponent, decodeURIComponent,
  location: { search: "?twin", origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/costs-api.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { AwsTwin, CostsApi } = ctx, A = AwsTwin.account;
AwsTwin.clock.pause(); AwsTwin.clock.at("2026-11-24T12:00:00.000Z");
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const t = await (await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() })).text();
const g1 = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1], creds = { accessKeyId: g1("AccessKeyId"), secretAccessKey: g1("SecretAccessKey"), sessionToken: g1("SessionToken") };
const notes = [];
const send = async (req) => { const r = await ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body }); notes.push(r.headers.get("x-twin-note")); return r; };
const api = CostsApi(send, { account: A });
const c = (a) => Math.round(Number(a) * 10000), sum = (xs) => xs.reduce((x, y) => x + y, 0);

const mtd = (await api.usage({ start: "2026-11-01", end: "2026-11-25" })).items[0];
ok(mtd.total && mtd.total.unit === "USD" && c(mtd.total.amount) > 0 && mtd.estimated, "month to date: a figure, estimated");
const svc = (await api.usage({ start: "2026-11-01", end: "2026-11-25", groupBy: "SERVICE" })).items[0].groups;
const reg = (await api.usage({ start: "2026-11-01", end: "2026-11-25", groupBy: "REGION" })).items[0].groups;
ok(sum(svc.map((g) => c(g.amount))) === c(mtd.total.amount) && sum(reg.map((g) => c(g.amount))) === c(mtd.total.amount), "by service and by region add up to the month to date");
ok(svc.length === 6 && svc.every((g) => typeof g.key === "string"), "six services by name");
const daily = await CostsApi.all((next) => api.usage({ start: "2026-10-26", end: "2026-11-25", granularity: "DAILY", next }));
ok(daily.items.length === 30 && !daily.capped, "30 days daily, over its pages");
ok(sum(daily.items.filter((p) => p.start >= "2026-11-01").map((p) => c(p.total.amount))) === c(mtd.total.amount), "the November days add up to the month to date");
const f = await api.forecast({ start: "2026-11-24", end: "2026-12-01" });
ok(f.total && c(f.items[0].low) < c(f.items[0].mean) && c(f.items[0].mean) < c(f.items[0].high), "the forecast to month end, with its interval");
const dv = await api.dimensionValues({ dimension: "SERVICE", start: "2026-11-01", end: "2026-11-25" });
ok(JSON.stringify(dv.items) === JSON.stringify(svc.map((g) => g.key)), "dimension values: the same services");
const b = (await api.budgets()).items;
ok(b.length === 1 && b[0].name === "Monthly cap (synthetic)" && b[0].limit.amount === "10.0" && c(b[0].actual.amount) === c(mtd.total.amount) && b[0].timeUnit === "MONTHLY", "the budget: its limit, and actual spend equal to the month to date");
ok(notes.length > 0 && notes.every((n) => n === "synthetic figures from the twin, not an AWS bill"), "every answer marked synthetic (" + notes.length + " answers)");
let e = null; try { await CostsApi(send, { account: "444455556666" }).budgets(); } catch (x) { e = x; }
ok(e && e.code === "AccessDeniedException" && e.status === 403, "another account's budgets: AccessDeniedException, 403");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (CostsApi over the twin: " + passed + " checks; month to date, by service and region, 30 days, forecast, dimension values, budget, synthetic)");
