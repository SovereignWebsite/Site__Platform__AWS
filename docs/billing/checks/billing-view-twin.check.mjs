// Check: site/billing.js (billing.aws.a) over dev.2.aws.a's CostsApi and twin. Run from a checkout of
// work/dev.2.aws.a.costs (c93246c, 0fe0324) with this file in its test/api/: node test/api/billing-view-twin.check.mjs
// Same set-up as that branch's costs-twin.test.mjs: the twin handles signed calls directly; dates are relative to today.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { URLSearchParams, URL, TextEncoder, TextDecoder, Response, Headers, Blob, CompressionStream, DecompressionStream, Promise, Math, JSON, Date, Object, Array, String, Number, RegExp, Error, TypeError, Uint8Array, Uint32Array, ArrayBuffer, DataView,
  setTimeout: (f) => setImmediate(f), location: { search: "?twin", origin: "https://example.test" } };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ["twin.js", "api/all.js", "api/costs-api.js", "billing.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { AwsTwin, CostsApi, SwsBilling } = ctx;
const SIG = "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/us-east-1/ce/aws4_request, SignedHeaders=host, Signature=twin";
let calls = 0;
const send = async (req) => { calls++; return AwsTwin.handle(req.url, { method: req.method, headers: Object.assign({}, req.headers, { authorization: SIG }), body: req.body }); };
const account = AwsTwin.account || "111122223333";
const api = CostsApi(send, { account });
const now = new Date();
const m = SwsBilling.modelFromApi(await SwsBilling.fetchAll(api, now, account));
let fails = 0; const ok = (c, msg) => { if (!c) { fails++; console.error("FAIL", msg); } else console.log("ok  ", msg); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const firstOfMonth = now.toISOString().slice(0, 8) + "01";
ok(Object.keys(m.errors).length === 0, "no section failed: " + JSON.stringify(m.errors));
if (now.getUTCDate() > 1) {
  ok(m.monthToDate && m.monthToDate.amount > 0, "month to date " + SwsBilling.fmt(m.monthToDate));
  ok(m.endOfMonth && m.endOfMonth.amount >= m.monthToDate.amount, "whole month " + SwsBilling.fmt(m.endOfMonth));
  ok(near(m.byService.reduce((s, g) => s + g.amount, 0), m.monthToDate.amount), "services add up (" + m.byService.length + ", zero lines dropped)");
  ok(near(m.byRegion.reduce((s, g) => s + g.amount, 0), m.monthToDate.amount), "regions add up (" + m.byRegion.map((g) => g.key).join(", ") + ")");
  ok(near(m.daily.filter((d) => d.day >= firstOfMonth).reduce((s, d) => s + d.amount, 0), m.monthToDate.amount), "this month's days add up");
}
ok(m.daily.length === 30, "30 daily bars");
ok(calls === 5, "five Cost Explorer requests, no Budgets call");
console.log("requests made:", calls);
process.exit(fails ? 1 : 0);
