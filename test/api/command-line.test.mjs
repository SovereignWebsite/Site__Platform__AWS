// CommandLine (site/api/command-line.js): the Command console's fixed grammar over site/api/commands.json (ux.aws.a
// design 09): commands, path parameters in order with the contracts' patterns, --name value options the row lists,
// s3 getObject's --bytes start-end capped at the S3 browser's preview size (R-017), and a parsed line run against the
// real API objects over the twin. Node 22, no network. Run: node test/api/command-line.test.mjs
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
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/all.js", "api/s3-api.js", "api/iam-api.js", "api/cfn-api.js", "api/lambda-api.js", "api/firehose-api.js", "api/logs-api.js", "api/command-line.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const table = JSON.parse(readFileSync(new URL("../../site/api/commands.json", import.meta.url), "utf8"));
const { CommandLine: C, AwsTwin } = ctx, A = AwsTwin.account;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const P = (line, o) => JSON.parse(JSON.stringify(C.parse(line, table, o)));

// ---- the grammar ----
let r = P("s3 listBuckets");
ok(r.ok && JSON.stringify(r.call) === JSON.stringify({ global: "S3Api", method: "listBuckets", args: [] }), "a command with no parameters");
r = P("iam role sws-aws-platform-read");
ok(r.ok && JSON.stringify(r.call.args) === JSON.stringify(["sws-aws-platform-read"]), "one path parameter");
r = P("  cfn   events  eu-west-2   demo-lambda  ");
ok(r.ok && JSON.stringify(r.call) === JSON.stringify({ global: "CfnApi", method: "events", args: ["eu-west-2", "demo-lambda", {}] }), "spaces between words do not matter; options object passed when the row has options");
r = P("s3 listObjects my-bucket eu-west-2 --prefix \"logs/2026 11\" --maxKeys 50");
ok(r.ok && JSON.stringify(r.call.args) === JSON.stringify(["my-bucket", "eu-west-2", { prefix: "logs/2026 11", maxKeys: 50 }]), "quoted value with a space; integer option as a number");
r = P("cfn stacks eu-west-2 --deleted");
ok(r.ok && r.options.deleted === true, "a boolean option alone");
r = P("logs events eu-west-2 /aws/lambda/demo-handler --start 2026-11-21T00:00:00Z --newest");
ok(r.ok && r.call.args[1] === "/aws/lambda/demo-handler" && r.options.newest === true && r.options.start === "2026-11-21T00:00:00Z", "a path with slashes stays one word");
const usage = C.usage(table.commands.find((x) => x.command === "s3 listObjects"));
ok(usage === "s3 listObjects <bucket> <region> [--prefix value] [--delimiter value] [--token value] [--maxKeys value]", "usage from the row: " + usage);

for (const [line, code] of [["", "empty"], ["   ", "empty"], ["ls", "unknown-command"], ["s3 deleteBucket b", "unknown-command"], ["S3 listBuckets", "unknown-command"],
  ["iam role", "arity"], ["iam role a b", "arity"], ["cfn stacks eu-west-2.evil.example/x", "bad-param"], ["cfn stacks EU-WEST-2", "bad-param"],
  ["iam roles --max", "missing-value"], ["iam roles --max ten", "bad-number"], ["iam roles --max 5 --max 6", "duplicate-option"], ["iam roles --admin 1", "unknown-option"],
  ["iam roles -max 5", "arity"], ["iam role \"unterminated", "quote"], ["iam role a\"b", "quote"], ["iam role \"a\"b", "quote"], ["x".repeat(2001), "too-long"],
  ["iam roles --max 1; s3 listBuckets", "bad-number"], ["iam role $(whoami)", "ok"], ["s3 getObject b eu-west-2 k --range 0-10", "unknown-option"]])
  { const x = P(line); ok(code === "ok" ? x.ok : !x.ok && x.code === code, JSON.stringify(line.slice(0, 40)) + " -> " + code + " (got " + (x.ok ? "ok" : x.code) + ")"); }
ok(P("iam role $(whoami)").call.args[0] === "$(whoami)", "a word is a value as typed, never run or expanded");
ok(P("iam role").message === "Usage: iam role <role>", "arity error gives the usage");
ok(P("ls").message === "Not a command. Try help.", "unknown command wording (design 09)");

// ---- s3 getObject --bytes ----
r = P("s3 getObject my-bucket eu-west-2 logs/a.json --bytes 0-1023");
ok(r.ok && JSON.stringify(r.call.args) === JSON.stringify(["my-bucket", "eu-west-2", "logs/a.json", [0, 1023]]), "--bytes start-end becomes getObject's one range argument [start, end]");
ok(JSON.stringify(P("s3 getObject my-bucket eu-west-2 k").call.args[3]) === JSON.stringify([0, 256 * 1024 - 1]), "no --bytes: the first 256 KiB, never the whole object (security.aws.a)");
ok(JSON.stringify(P("s3 getObject my-bucket eu-west-2 k", { previewCap: 1000 }).call.args[3]) === JSON.stringify([0, 999]), "no --bytes with the page's own cap");
ok(P("s3 getObject b eu-west-2 k --bytes 0-" + (256 * 1024 - 1)).ok, "exactly the preview cap is allowed");
const over = P("s3 getObject b eu-west-2 k --bytes 0-" + 256 * 1024);
ok(!over.ok && over.code === "range-over-cap" && over.message === "That range is over the preview limit. Use Files to read it in parts.", "one byte over the cap is refused, with design 09's sentence");
for (const v of ["10-5", "a-b", "5", "-5", "1-", "1.5-2", "0x0-10", "1-2-3"]) ok(P("s3 getObject b eu-west-2 k --bytes " + v).code === "bad-range", "--bytes " + v + " refused");
ok(P("s3 getObject b eu-west-2 k --bytes 0-1 --bytes 2-3").code === "duplicate-option", "--bytes once");
ok(!P("s3 getObject b eu-west-2 k --bytes 0-999", { previewCap: 500 }).ok, "the cap can be set to the page's own (smaller) value");
ok(/preview:\s*256\s*\*\s*1024/.test(readFileSync(new URL("../../site/s3.js", import.meta.url), "utf8")) && C.PREVIEW_CAP === 256 * 1024, "the cap equals the S3 browser's LIMITS.preview (256 KiB)");

// ---- completion ----
ok(JSON.stringify(C.complete("iam rol", table).map((x) => x.command)) === JSON.stringify(["iam role", "iam roles"]), "completion: iam rol");
ok(C.complete("", table).length === table.commands.length && C.complete("zz", table).length === 0, "completion: all, none");

// ---- every row parses from its own usage, and a parsed line runs on the real API over the twin ----
for (const row of table.commands) {
  const sample = { region: "eu-west-2", bucket: "b", key: "k", name: "n", role: "r", policy: "p", arn: "arn:aws:iam::" + A + ":role/r", stack: "s", exportName: "e", group: "/g", id: "EDEMOTWIN00001" };
  const line = row.command + row.params.map((p) => " " + sample[p.name]).join("");
  const x = C.parse(line, table);
  ok(x.ok && x.call.method === row.operationId, row.command + ": parses (" + line + ")" + (x.ok ? "" : " " + x.code));
}
{
  const t = await (await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() })).text();
  const g = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1], creds = { accessKeyId: g("AccessKeyId"), secretAccessKey: g("SecretAccessKey"), sessionToken: g("SessionToken") };
  const send = async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body });
  const run = async (line) => { const x = C.parse(line, table); if (!x.ok) throw new Error(x.message); return ctx[x.call.global](send, { account: A })[x.call.method](...x.call.args); };
  ok((await run("cfn stacks eu-west-2")).items.map((s) => s.name).join() === "demo-site,demo-dns,demo-lambda", "run: cfn stacks eu-west-2 over the twin");
  ok((await run("iam role sws-aws-platform-read")).arn === "arn:aws:iam::" + A + ":role/sws-aws-platform-read", "run: iam role over the twin");
  ok((await run("iam roles --max 2")).items.length === 2, "run: iam roles --max 2 over the twin");
  // getObject runs on S3Api over the twin: the range header is sent and honoured, whatever the start (security.aws.a).
  const s3 = ctx.S3Api(send), sizes = [];
  for (const name of await s3.listBuckets()) {
    const b = await s3.getBucket(name);
    if (!b.cors) continue; // the browser can read only buckets with CORS (the twin answers as a browser sees it)
    const page = await s3.listObjects(name, b.region, { delimiter: "" });
    page.files.forEach((f) => sizes.push({ bucket: name, region: b.region, key: f.key, size: f.size }));
  }
  // The twin's readable objects are all under 1 KB, so the cap is shown with the page's own smaller cap: the same path.
  const obj = sizes.sort((a, b) => b.size - a.size)[0];
  ok(obj && obj.size > 600, "an object over 600 bytes to test with (" + (obj && obj.key + " " + obj.size) + ")");
  const runCap = async (line, cap) => { const x = C.parse(line, table, { previewCap: cap }); if (!x.ok) throw new Error(x.message); return ctx[x.call.global](send, { account: A })[x.call.method](...x.call.args); };
  const capped = await runCap("s3 getObject " + obj.bucket + " " + obj.region + " " + obj.key, 500);
  ok(capped.status === 206 && capped.bytes.length === 500 && /^bytes 0-499\//.test(capped.contentRange || ""), "run: no --bytes fetches only the first cap bytes, never the whole object (" + capped.status + ", " + capped.bytes.length + ", " + capped.contentRange + ")");
  const mid = await run("s3 getObject " + obj.bucket + " " + obj.region + " " + obj.key + " --bytes 5-504");
  ok(mid.status === 206 && mid.bytes.length === 500 && /^bytes 5-504\//.test(mid.contentRange || ""), "run: --bytes 5-504 sends bytes=5-504 (" + mid.contentRange + ")");
  const first = await run("s3 getObject " + obj.bucket + " " + obj.region + " " + obj.key + " --bytes 0-0");
  ok(first.status === 206 && first.bytes.length === 1, "run: --bytes 0-0 (a start of 0) still sends a Range header");
}

const src = readFileSync(new URL("../../site/api/command-line.js", import.meta.url), "utf8");
ok(!/\beval\(|new Function|innerHTML|setTimeout|setInterval|fetch\(|localStorage/.test(src.replace(/^\s*\/\/.*$/gm, "")), "no eval, HTML, timers, requests or storage in the parser");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (command-line: " + passed + " checks; grammar, options, --bytes cap, completion, every row, runs over the twin)");
