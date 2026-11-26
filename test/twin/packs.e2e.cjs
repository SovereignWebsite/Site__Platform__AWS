// Design 02 step 2 in the page: the twin fetches its pack from twin/packs/<id>.json (same origin) and runs it; a
// pack file that fails its checks, or does not answer, leaves the twin answering AWS-shaped 503s, and the page
// makes no request to AWS either way.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "..", "site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".yaml": "text/yaml" };
let override = null; // { path, status, body }
const srv = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  if (override && u === override.path) { s.writeHead(override.status, { "content-type": "application/json" }); return s.end(override.body); }
  let p = path.join(root, u); if (p.endsWith("/")) p += "index.html";
  if (!fs.existsSync(p)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); s.end(fs.readFileSync(p));
}).listen(0);
const fail = (m) => { throw new Error(m); };
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage();
  const asked = []; pg.on("request", (r) => asked.push(r.url()));
  const base = `http://localhost:${srv.address().port}/`;
  const ask = () => pg.evaluate(async () => {
    await window.AwsTwin.ready();
    const r = await window.AwsTwin.handle("https://cloudcontrolapi.eu-west-2.amazonaws.com/", { method: "POST", headers: { "x-amz-target": "CloudApiService.ListResources",
      authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261122/eu-west-2/cloudcontrolapi/aws4_request, SignedHeaders=host, Signature=twin" }, body: JSON.stringify({ TypeName: "AWS::S3::Bucket" }) });
    return { status: r.status, text: await r.text(), err: window.AwsTwin.loadError() };
  });

  // 1. The attack pack, from its file.
  await pg.goto(base + "?twin&pack=attack");
  const ok = await ask();
  if (ok.status !== 200 || ok.err !== null) fail("attack pack: " + JSON.stringify(ok).slice(0, 200));
  if (!asked.some((u) => u === base + "twin/packs/attack.json")) fail("the pack file was not fetched: " + asked.filter((u) => /packs/.test(u)));

  // 2. A pack file that fails its checks, then one that is missing: 503s, with the reason.
  for (const [why, o] of [["an unknown generator", { status: 200, body: JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(path.join(root, "twin/packs/baseline.json"), "utf8")), { generate: [{ gen: "eval" }] })) }],
    ["not JSON", { status: 200, body: "alert(1)" }], ["missing", { status: 404, body: "" }]]) {
    override = Object.assign({ path: "/twin/packs/baseline.json" }, o);
    await pg.goto(base + "?twin&pack=baseline");
    const r = await ask();
    if (r.status !== 503 || !/ServiceUnavailable/.test(r.text) || !r.err) fail(why + ": " + JSON.stringify(r).slice(0, 200));
  }
  override = null;
  if (asked.some((u) => /amazonaws\.com/.test(u))) fail("a request went to AWS: " + asked.filter((u) => /amazonaws/.test(u)).join(" "));
  console.log("OK (twin packs in the page: the attack pack fetched from twin/packs/attack.json and run; a bad, non-JSON or missing pack file gives 503s; no request to AWS)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
