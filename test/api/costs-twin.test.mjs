// CostsApi (site/api/costs-api.js) over the twin's Cost Explorer reads (site/twin.js), signed with the twin's read
// credential: the Costs tab's views (month to date, by service, by region, 30 days daily over its pages, forecast,
// dimension values) from one API, adding up across views, every answer synthetic; Budgets refused as a browser sees it
// (no CORS), passed through as a TypeError. Dates are relative to today. Node 22, no network.
// Run: node test/api/costs-twin.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { URLSearchParams, URL, TextEncoder, TextDecoder, Response, Headers, Blob, CompressionStream, DecompressionStream, Promise, Math, JSON, Date, Object, Array, String, Number, RegExp, Error, TypeError, Uint8Array, Uint32Array, ArrayBuffer, DataView,
  setTimeout: (f) => setImmediate(f), location: { search: "?twin", origin: "https://example.test" } };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ["twin.js", "api/all.js", "api/costs-api.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { AwsTwin, CostsApi } = ctx, NOTE = "synthetic figures from the twin, not an AWS bill";
const SIG = "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/us-east-1/ce/aws4_request, SignedHeaders=host, Signature=twin";
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const notes = [];
const send = async (req) => { const r = await AwsTwin.handle(req.url, { method: req.method, headers: Object.assign({}, req.headers, { authorization: SIG }), body: req.body }); notes.push(r.headers.get("x-twin-note")); return r; };
const api = CostsApi(send, { account: AwsTwin.account || "111122223333" });
const iso = (t) => new Date(t).toISOString().slice(0, 10), DAY = 86400000, now = new Date();
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), m0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), m1 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
const c = (a) => Math.round(a * 10000), sum = (xs) => xs.reduce((x, y) => x + y, 0);
const S = iso(m0), E = iso(today + DAY);

const mtd = (await api.usage({ start: S, end: E })).items[0];
ok(mtd.total && mtd.total.unit === "USD" && typeof mtd.total.amount === "number" && c(mtd.total.amount) > 0 && mtd.estimated === true, "month to date: a number, USD, estimated");
const svc = (await api.usage({ start: S, end: E, groupBy: "SERVICE" })).items[0].groups;
const reg = (await api.usage({ start: S, end: E, groupBy: "REGION" })).items[0].groups;
ok(sum(svc.map((g) => c(g.amount))) === c(mtd.total.amount) && sum(reg.map((g) => c(g.amount))) === c(mtd.total.amount), "by service and by region add up to the month to date");
ok(svc.length === 6 && svc.some((g) => g.key === "Tax" && g.amount === 0), "six services, Tax kept at zero for the view to drop");
const daily = await api.usage({ start: iso(today - 40 * DAY), end: E, granularity: "DAILY" });
ok(daily.items.length === 41 && daily.capped === false, "41 days daily: the twin's two pages of 31 merged");
ok(sum(daily.items.filter((p) => p.start >= S).map((p) => c(p.total.amount))) === c(mtd.total.amount), "this month's days add up to the month to date");
const f = await api.forecast({ start: iso(today), end: iso(m1) });
ok(f.start === iso(today) && f.end === iso(m1) && f.total && c(f.items[0].low) < c(f.items[0].mean) && c(f.items[0].mean) < c(f.items[0].high), "the forecast to month end: its period, a total, an interval");
const dv = await api.dimensionValues({ dimension: "SERVICE", start: S, end: E });
ok(JSON.stringify(dv.items) === JSON.stringify(svc.filter((g) => g.amount > 0).map((g) => g.key)), "dimension values: the services with costs");
ok(notes.length === 7 && notes.every((n) => n === NOTE), "every answer marked synthetic (" + notes.length + ")");
let e = null; try { await api.budgets(); } catch (x) { e = x; }
ok(e instanceof TypeError && e.message === "Failed to fetch", "budgets: refused as without CORS, a TypeError passed through");
e = null; try { await CostsApi(async (req) => AwsTwin.handle(req.url, { method: req.method, headers: req.headers, body: req.body })).usage({ start: S, end: E }); } catch (x) { e = x; }
ok(e && e.code === "AccessDeniedException" && e.status === 403, "unsigned: AccessDeniedException, 403");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (CostsApi over the twin: " + passed + " checks; month to date, by service and region, 41 days over two pages, forecast, dimension values, synthetic, Budgets refused)");
