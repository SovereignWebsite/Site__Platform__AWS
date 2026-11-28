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
    ["iam", "demo-handler-role", /Who has access to this account through this site[\s\S]*you \(visitor@twin\.example\)[\s\S]*Read and Change[\s\S]*open any file in S3[\s\S]*Roles \(\d+\)/, /Who may assume it/],
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
  // Activity: CloudTrail's history, with the calls this page just made as this site's sessions, newest first
  await pg.click("#tab-activity"); await done("activity");
  const act = await pg.textContent("#console-activity .console-body");
  if (!/Done through this site in us-east-1/.test(act) || !/ListRoles/.test(act) || !/role sws-aws-platform-read/.test(act)) fail("activity: " + act.slice(0, 200));
  await pg.click("#console-activity .console-body tbody button >> nth=0");
  await pg.waitForSelector("#console-activity .console-detail >> text=The CloudTrail record");
  await pg.selectOption("#console-activity select[aria-label=Show]", "changes"); await done("activity");
  if (!/UpdateAssumeRolePolicy/.test(await pg.textContent("#console-activity .console-body"))) fail("activity: changes only");
  // the zone's records open from Stacks and DNS
  await pg.click("#tab-stacks"); await pg.click("#console-stacks button:has-text('example.com.')");
  await pg.waitForFunction(() => /www\.example\.com/.test(document.querySelector("#console-stacks .console-detail").textContent));
  // DNS changes: create a zone, add an A record, change it, delete it; each a plan first, then Approve
  await pg.fill("#console-stacks input[aria-label='Domain for the new zone']", "new.example.org");
  await pg.click("#console-stacks .dns-form button:has-text('Show the plan')");
  await pg.waitForSelector("#console-stacks .plan-card >> text=Create the public hosted zone new.example.org");
  if (!/\$0\.50 a month/.test(await pg.textContent("#console-stacks .plan-card"))) fail("zone plan has no cost");
  await pg.click("#console-stacks .plan-card button.approve");
  await pg.waitForFunction(() => { const d = document.querySelector("#console-stacks .console-detail"); return d && /^new\.example\.org\./.test((d.querySelector("h3") || {}).textContent || "") && /Name servers \(give these/.test(d.textContent); }, null, { timeout: 15000 });
  await pg.fill("#console-stacks input[aria-label='Record name']", "app");
  await pg.selectOption("#console-stacks select[aria-label='Record type']", "A");
  await pg.fill("#console-stacks textarea[aria-label='Values']", "192.0.2.10");
  await pg.click("#console-stacks .console-detail button:has-text('Show the plan')");
  await pg.waitForSelector("#console-stacks .console-detail .plan-card >> text=Add A app.new.example.org.");
  await pg.click("#console-stacks .console-detail .plan-card button.approve");
  await pg.waitForFunction(() => /app\.new\.example\.org\.\s*A\s*300\s*192\.0\.2\.10/.test(((document.querySelector("#console-stacks .console-detail table") || {}).textContent || "").replace(/\s+/g, " ")), null, { timeout: 15000 });
  await pg.fill("#console-stacks textarea[aria-label='Values']", "192.0.2.11");
  await pg.fill("#console-stacks input[aria-label='Record name']", "app");
  await pg.click("#console-stacks .console-detail button:has-text('Show the plan')");
  await pg.waitForSelector("#console-stacks .console-detail .plan-card >> text=Change A app.new.example.org.");
  await pg.click("#console-stacks .console-detail .plan-card button.approve");
  await pg.waitForFunction(() => /192\.0\.2\.11/.test(((document.querySelector("#console-stacks .console-detail table") || {}).textContent || "")), null, { timeout: 15000 });
  await pg.click("#console-stacks .console-detail tr:has-text('app.new.example.org.') button:has-text('Delete')");
  await pg.click("#console-stacks .console-detail .plan-card button.approve");
  await pg.waitForFunction(() => !/app\.new\.example\.org/.test(((document.querySelector("#console-stacks .console-detail table") || {}).textContent || "")), null, { timeout: 15000 });
  // a region with no stacks says so
  await pg.selectOption("#console-stacks .console-controls select[aria-label=Region]", "us-east-1"); await done("stacks");
  if (!/sws-aws-platform/.test(await pg.textContent("#console-stacks .console-body"))) fail("the platform stack in us-east-1");
  // the Firehose stream opens its files in the S3 browser
  await pg.click("#tab-lambda"); await pg.click("#console-lambda button:has-text('demo-cloudfront-logs')");
  await pg.click("#console-lambda button:has-text('Open its files in the S3 browser')");
  await pg.waitForSelector("#s3-list >> text=2026/");
  // Feedback: the message and chosen parts, read here and shown before anything is sent; the account ID masked
  await pg.click("#tab-feedback"); await pg.fill("#fb-msg", "Please chart the costs.");
  for (const p of ["lambda", "cloudfront", "stacks"]) await pg.check("#fb-part-" + p);
  await pg.click("text=Prepare: read the parts");
  await pg.waitForFunction(() => /exactly what will be shared/.test(document.querySelector("#feedback .status").textContent), null, { timeout: 15000 });
  const pv = await pg.textContent("#feedback .fb-preview");
  if (!/Please chart the costs/.test(pv) || !/demo-handler/.test(pv) || !/EDEMOTWIN00001/.test(pv) || !/demo-site/.test(pv)) fail("feedback preview: " + pv.slice(0, 300));
  if (/111122223333/.test(pv) || !/\*{8}3333/.test(pv)) fail("feedback did not mask the account ID");
  if (errors.length) fail("page errors: " + errors.join(" | "));
  if (outside.length) fail("the twin reached outside the page: " + [...new Set(outside)].join(", "));
  console.log("OK (consoles: costs, stacks and DNS, IAM roles, Lambda with runs and Firehose, CloudFront; details open; nothing left the page)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
