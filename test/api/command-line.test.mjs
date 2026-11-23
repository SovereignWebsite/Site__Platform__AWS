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

// ---- design 09's alias table (ux.aws.a): every alias expands to rows that exist, and the steps run ----
{
  const E = (line, c) => JSON.parse(JSON.stringify(C.expand(line, table, c)));
  const commands = new Set(table.commands.map((r) => r.command)), aliases = C.ALIASES.map((a) => a.alias);
  ok(C.ALIASES.every((a) => a.expands.every((x) => commands.has(x))), "every alias's rows exist in commands.json");
  ok(["help", "ls", "cat", "open", "who", "roles", "stacks", "stack", "events", "fns", "streams", "cdn", "logs", "files", "map", "timeline", "desk"].every((a) => aliases.includes(a)), "design 09's aliases, all present");
  ok(table.commands.every((r) => r.role === "read"), "every row an alias can reach is a read");
  const ctx1 = { region: "eu-west-2", bucketRegions: { bkt: "eu-west-1", "my.bucket": "eu-west-2" } };
  const cases = [
    ["ls", [["s3", "listBuckets"]]],
    ["ls bkt", [["s3", "listObjects", "bkt", "eu-west-1", "--delimiter", "/"]]],
    ["ls bkt/", [["s3", "listObjects", "bkt", "eu-west-1", "--delimiter", "/"]]],
    ["ls bkt/logs/2026/", [["s3", "listObjects", "bkt", "eu-west-1", "--prefix", "logs/2026/", "--delimiter", "/"]]],
    ['cat "bkt/a key with spaces.txt"', [["s3", "getObject", "bkt", "eu-west-1", "a key with spaces.txt"]]],
    ["who sws-aws-platform-read", [["iam", "role", "sws-aws-platform-read"], ["iam", "attached", "sws-aws-platform-read"]]],
    ["roles", [["iam", "roles"]]], ["cdn", [["cloudfront", "distributions"]]],
    ["stacks", [["cfn", "stacks", "eu-west-2"]]], ["stack demo-site", [["cfn", "stack", "eu-west-2", "demo-site"]]], ["events demo-site", [["cfn", "events", "eu-west-2", "demo-site"]]],
    ["fns", [["lambda", "functions", "eu-west-2"]]], ["streams", [["firehose", "streams", "eu-west-2"]]],
    ["logs /aws/lambda/x", [["logs", "events", "eu-west-2", "/aws/lambda/x", "--newest"]]],
    ["logs /aws/lambda/x --pattern ERROR --max 5", [["logs", "events", "eu-west-2", "/aws/lambda/x", "--newest", "--pattern", "ERROR", "--max", "5"]]],
    ["logs /aws/lambda/x --newest", [["logs", "events", "eu-west-2", "/aws/lambda/x", "--newest"]]]
  ];
  for (const [line, want] of cases) {
    const x = E(line, ctx1);
    ok(x.ok && x.kind === "commands" && JSON.stringify(x.steps.map((s) => s.words)) === JSON.stringify(want), line + " -> " + JSON.stringify(want) + " (got " + JSON.stringify(x) + ")");
    ok(x.ok && x.steps.every((s) => { const p = C.parseWords(s.words, table); return p.ok && commands.has(p.row.command); }), line + ": every step parses to an existing row");
  }
  ok(E("cat bkt/k", ctx1).steps && C.parseWords(E("cat bkt/k", ctx1).steps[0].words, table).call.args[3].join() === "0," + (256 * 1024 - 1), "cat keeps the 256 KiB cap");
  // Regions: the bucket's own, never the crumb's; the crumb for regional rows; otherwise asked, never guessed.
  const nb = E("ls other/x", ctx1);
  ok(!nb.ok && nb.code === "needs-bucket-region" && nb.bucket === "other" && nb.lookup.words.join(" ") === "s3 getBucket other", "a bucket with no known region: look it up with s3 getBucket, not the crumb");
  ok(E("cat other/k", ctx1).code === "needs-bucket-region", "cat too");
  for (const l of ["stacks", "stack s", "fns", "streams", "logs /g", "events s"]) ok(E(l, {}).code === "needs-region" && E(l, { region: "../evil" }).code === "needs-region", l + ": no crumb region (or a bad one) asks Which region?");
  ok(E("ls bkt", { bucketRegions: { bkt: "x/../y" } }).code === "needs-bucket-region", "a bucket region that is not a region is not used");
  ok(E("ls constructor", { bucketRegions: {} }).code === "needs-bucket-region" && E("ls hasownproperty", { bucketRegions: {} }).code === "needs-bucket-region", "bucket names are looked up as own keys only");
  // A command wins over an alias; switches, help and plan; usage errors.
  ok(E("logs groups eu-west-2", ctx1).steps[0].words.join(" ") === "logs groups eu-west-2" && E("logs events eu-west-2 /g", ctx1).steps[0].words.join(" ") === "logs events eu-west-2 /g", "a line that is a command stays that command");
  ok(JSON.stringify(E("open bkt/a/b", ctx1)) === JSON.stringify({ ok: true, kind: "switch", console: "files", bucket: "bkt", path: "a/b" }) && E("map").console === "map" && E("desk").kind === "switch", "open and the console names switch, with no AWS call");
  ok(E("help").kind === "help" && E("help").command === null && E("help s3 listObjects").command === "s3 listObjects", "help, and help <command>");
  ok(E("plan cors b").kind === "plan" && /No plan for that yet/.test(E("plan cors b").message), "plan never runs: Desk holds plans");
  for (const l of ["ls a b", "cat bkt", "cat bkt/", "cat /k", "who", "who a b", "roles x", "cdn x", "stacks x", "stack", "logs", "logs --newest", "map x", "open", "open /x"]) ok(E(l, ctx1).code === "arity", l + ": usage");
  for (const l of ["rm bkt/k", "ls *", "s3 deleteBucket bkt", ""]) ok(!E(l, ctx1).ok, JSON.stringify(l) + " refused");
  for (const l of ["ls *", "ls b*", "cat */k", "open ../x", "ls __proto__", "ls B", "ls a"]) ok(E(l, ctx1).code === "arity", l + ": not a bucket name, so no lookup is built");
  // security.aws.a's rules (design 09): no alias shadows a row; an alias takes only its row's declared options.
  const sample = { region: "eu-west-2", bucket: "bkt", key: "k", name: "n", role: "r", policy: "p", arn: "arn:aws:iam::" + A + ":role/r", stack: "s", exportName: "e", group: "/g", id: "EDEMOTWIN00001" };
  for (const row of table.commands) {
    const w = row.command.split(" ").concat(row.params.map((p) => sample[p.name])), x = E(w.join(" "), ctx1);
    ok(x.ok && x.kind === "commands" && x.steps.length === 1 && JSON.stringify(x.steps[0].words) === JSON.stringify(w), "no alias shadows " + row.command);
  }
  ok(E("logs /g --bogus x", ctx1).code === "unknown-option" && E("logs /g --max lots", ctx1).code === "bad-number" && E("logs /g --newest --newest", ctx1).code === "duplicate-option", "logs takes only logs events' own options, checked by its grammar");
  ok(E("stack " + "x".repeat(10) + " --deleted", ctx1).code === "arity" && E("cat bkt/k --bytes 0-1", ctx1).code === "arity", "aliases with no options refuse any");
  ok(C.completeAlias("st").map((a) => a.alias).join() === "stacks,stack,streams", "alias completion");
  // The steps run on the real API over the twin (a parsed line that never runs proves nothing).
  const t2 = await (await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() })).text();
  const g2 = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t2) || [])[1], cr = { accessKeyId: g2("AccessKeyId"), secretAccessKey: g2("SecretAccessKey"), sessionToken: g2("SessionToken") };
  const send2 = async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, cr, req.region, req.service), body: req.body });
  const runWords = (w) => { const x = C.parseWords(w, table); if (!x.ok) throw new Error(x.message); return ctx[x.call.global](send2, { account: A })[x.call.method](...x.call.args); };
  // The twin answers S3 reads as a browser sees them: only buckets with CORS (as the getObject case above).
  const s3b = ctx.S3Api(send2), regions = {};
  let site = null;
  for (const name of await s3b.listBuckets()) if (!site && (await s3b.getBucket(name)).cors) site = name;
  let r = E("ls " + site, { region: "eu-west-2", bucketRegions: regions });
  ok(r.code === "needs-bucket-region", "ls over the twin: first the bucket's region");
  regions[site] = (await runWords(r.lookup.words)).region;
  r = E("ls " + site, { region: "eu-west-2", bucketRegions: regions });
  const listed = await runWords(r.steps[0].words);
  ok(listed.files.length + listed.folders.length > 0, "ls <bucket> runs on S3Api over the twin, in the bucket's own region " + regions[site]);
  const firstFile = listed.files[0];
  if (firstFile) { const got = await runWords(E("cat " + site + "/" + firstFile.key, { bucketRegions: regions }).steps[0].words); ok(got.status === 200 || got.status === 206, "cat runs getObject over the twin"); }
  const who = await Promise.all(E("who sws-aws-platform-read").steps.map((s) => runWords(s.words)));
  ok(who[0].arn === "arn:aws:iam::" + A + ":role/sws-aws-platform-read" && Array.isArray(who[1].items), "who runs iam role and iam attached over the twin");
  ok((await runWords(E("stacks", { region: "eu-west-2" }).steps[0].words)).items.some((s) => s.name === "demo-site"), "stacks runs cfn stacks in the crumb's region over the twin");
}

const src = readFileSync(new URL("../../site/api/command-line.js", import.meta.url), "utf8");
ok(!/\beval\(|new Function|innerHTML|setTimeout|setInterval|fetch\(|localStorage/.test(src.replace(/^\s*\/\/.*$/gm, "")), "no eval, HTML, timers, requests or storage in the parser");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (command-line: " + passed + " checks; grammar, options, --bytes cap, completion, every row, aliases, runs over the twin)");
