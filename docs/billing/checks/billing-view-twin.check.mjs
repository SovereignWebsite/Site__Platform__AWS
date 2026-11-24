// Run from a checkout that has dev.2.aws.a's site/api/costs-api.js and twin (work/dev.2.aws.a.cf-logs 77a2c17), placed in its test/api/. Check: site/billing.js (billing.aws.a) over dev.2.aws.a's CostsApi and twin. Same set-up as costs-twin.test.mjs.
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
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/costs-api.js", "billing.js"]) vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const { AwsTwin, CostsApi, SwsBilling } = ctx, A = AwsTwin.account;
AwsTwin.clock.pause(); AwsTwin.clock.at("2026-11-24T12:00:00.000Z");
const t = await (await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() })).text();
const g1 = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1], creds = { accessKeyId: g1("AccessKeyId"), secretAccessKey: g1("SecretAccessKey"), sessionToken: g1("SessionToken") };
let calls = 0;
const send = async (req) => { calls++; return ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body }); };
const api = CostsApi(send, { account: A });
const answers = await SwsBilling.fetchAll(api, new Date("2026-11-24T12:00:00Z"), A);
const m = SwsBilling.modelFromApi(answers);
let fails = 0; const ok = (c, msg) => { if (!c) { fails++; console.error("FAIL", msg); } else console.log("ok  ", msg); };
ok(Object.keys(m.errors).length === 0, "no section failed: " + JSON.stringify(m.errors));
ok(m.monthToDate && m.monthToDate.amount > 0, "month to date " + SwsBilling.fmt(m.monthToDate));
ok(m.endOfMonth && m.endOfMonth.amount >= m.monthToDate.amount, "end of month " + SwsBilling.fmt(m.endOfMonth));
const near = (a, b) => Math.abs(a - b) < 1e-6;
ok(near(m.byService.reduce((s, g) => s + g.amount, 0), m.monthToDate.amount), "services add up to month to date (" + m.byService.length + " services)");
ok(near(m.byRegion.reduce((s, g) => s + g.amount, 0), m.monthToDate.amount), "regions add up (" + m.byRegion.map((g) => g.key).join(", ") + ")");
ok(m.daily.length === 30, "30 daily bars");
ok(near(m.daily.filter((d) => d.day >= "2026-11-01").reduce((s, d) => s + d.amount, 0), m.monthToDate.amount), "November days add up to month to date");
ok(m.budgets.length >= 1 && m.budgets[0].used !== null, "budget " + m.budgets[0].name + " used " + Math.round(m.budgets[0].used * 100) + "%");
console.log("requests made:", calls);
process.exit(fails ? 1 : 0);
