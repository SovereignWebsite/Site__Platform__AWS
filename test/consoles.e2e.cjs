// The consoles (site/consoles.js) against the twin: each tab reads itself on opening, a row opens its detail, and
// nothing leaves the page. Costs, Stacks and DNS, IAM roles, Lambda (with recent runs and Firehose), CloudFront.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".yaml": "text/yaml" };
const srv = http.createServer((q, s) => {
  let p = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (p.endsWith("/")) p += "index.html";
  if (!fs.existsSync(p)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); s.end(fs.readFileSync(p));
}).listen(0);
const fail = (m) => { throw new Error(m); };
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [], outside = [];
  pg.on("pageerror", (e) => errors.push(e.message));
  pg.on("request", (r) => { const h = new URL(r.url()).hostname; if (h !== "localhost") outside.push(h); });
  await pg.goto(`http://localhost:${srv.address().port}/?twin`);
  await pg.waitForSelector("#step1-done:not([hidden])");
  const done = (t) => pg.waitForFunction((t) => { const s = document.querySelector("#console-" + t + " .status"); return s && /\bok\b/.test(s.className); }, t, { timeout: 20000 });
  const steps = [
    ["costs", null, /This month so far/, null],
    ["stacks", "demo-site", /Stacks in eu-west-2 \(3\)/, /What it made \(3\)/],
    ["iam", "demo-handler-role", /Roles \(\d+\)/, /Who may assume it/],
    ["lambda", "demo-handler", /Functions in eu-west-2 \(3\)/, /Recent runs[\s\S]*Duration ms/],
    ["cloudfront", "EDEMOTWIN00001", /Distributions \(1\)/, /Origins/],
  ];
  for (const [tab, pick, list, det] of steps) {
    await pg.click("#tab-" + tab); await done(tab);
    const body = await pg.textContent("#console-" + tab + " .console-body");
    if (!list.test(body)) fail(tab + ": list not shown: " + body.slice(0, 200));
    if (pick) {
      await pg.click(`#console-${tab} .console-body button:has-text('${pick}')`);
      await pg.waitForFunction(([t, re]) => new RegExp(re).test((document.querySelector("#console-" + t + " .console-detail") || {}).textContent || ""), [tab, det.source], { timeout: 15000 });
    }
  }
  // the zone's records open from Stacks and DNS
  await pg.click("#tab-stacks"); await pg.click("#console-stacks button:has-text('example.com.')");
  await pg.waitForFunction(() => /www\.example\.com/.test(document.querySelector("#console-stacks .console-detail").textContent));
  // a region with no stacks says so
  await pg.selectOption("#console-stacks .console-controls select[aria-label=Region]", "us-east-1"); await done("stacks");
  if (!/sws-aws-platform/.test(await pg.textContent("#console-stacks .console-body"))) fail("the platform stack in us-east-1");
  // the Firehose stream opens its files in the S3 browser
  await pg.click("#tab-lambda"); await pg.click("#console-lambda button:has-text('demo-cloudfront-logs')");
  await pg.click("#console-lambda button:has-text('Open its files in the S3 browser')");
  await pg.waitForSelector("#s3-list >> text=2026/");
  if (errors.length) fail("page errors: " + errors.join(" | "));
  if (outside.length) fail("the twin reached outside the page: " + [...new Set(outside)].join(", "));
  console.log("OK (consoles: costs, stacks and DNS, IAM roles, Lambda with runs and Firehose, CloudFront; details open; nothing left the page)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
