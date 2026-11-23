// The twin end to end: the real page, no stubs and no network beyond the page itself. Enter the twin, read
// the synthetic account, see the plans, browse S3 (CORS plan, a .gz log as JSON Lines, inside a zip, YAML).
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
  const errors = [], outside = []; let inTwin = false;
  pg.on("pageerror", (e) => errors.push(e.message));
  pg.on("request", (r) => { const u = new URL(r.url()); if (inTwin && u.hostname !== "localhost") outside.push(u.hostname); });
  await pg.goto(`http://localhost:${srv.address().port}/`);
  await Promise.all([pg.waitForNavigation(), pg.click("#twin-enter")]);
  inTwin = true; // from the twin's first load on, nothing may leave the page
  await pg.reload();
  if (!pg.url().includes("?twin")) fail("twin address");
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  if (!(await pg.textContent("#who")).includes("Twin visitor")) fail("twin identity");
  // the account
  await pg.click("text=Read this account");
  await pg.waitForSelector("text=Cost this month so far");
  if (!(await pg.textContent("#accounts")).includes("sws-aws-platform-read")) fail("twin read role");
  // plans: the add is done, the removal and the stack update wait
  await pg.click("#tab-plans");
  await pg.waitForFunction(() => document.querySelectorAll("#plans .badge.warn").length === 2 && document.querySelectorAll("#plans-done .badge.ok").length === 1);
  await pg.click('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"] button:has-text("Show the plan")');
  await pg.click('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"] button.approve');
  await pg.waitForSelector("text=Applied and checked");
  await pg.waitForFunction(() => document.querySelectorAll("#plans-done .badge.ok").length === 2);
  // S3
  await pg.click("#tab-s3");
  await pg.click("#s3-list-buckets");
  await pg.click("#s3-buckets button:has-text('demo-cloudfront-logs')");
  await pg.click("text=Approve and add the rule to");
  await pg.waitForSelector("#s3-list >> text=cloudfront/");
  for (const f of ["cloudfront/", "2026/", "11/", "21/", "10/"]) await pg.click(`#s3-list >> text=${f}`);
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("text=JSON Lines");
  if (!(await pg.textContent("#s3-file")).includes("cs_uri_stem")) fail("log lines");
  await pg.click("#s3-buckets button:has-text('demo-lambda-deps')");
  await pg.click("text=Approve and add the rule to");
  await pg.click("#s3-list >> text=lambdas-dependencies/");
  await pg.click("#s3-list button:has-text('.zip')");
  await pg.waitForSelector("#s3-file >> text=demo_handler/handler.py");
  await pg.click("#s3-file button:has-text('demo_handler/handler.py')");
  await pg.waitForSelector("#s3-file .viewer pre.code.lang-py .t-kw");
  await pg.click("#s3-buckets button:has-text('demo-site')");
  await pg.click("text=Approve and add the rule to");
  await pg.click("#s3-list >> text=config/");
  await pg.click("#s3-list >> text=site.yaml");
  await pg.waitForSelector("#s3-file pre.code.lang-yaml .t-key");
  if (process.argv[2]) await pg.screenshot({ path: process.argv[2], fullPage: true });
  // fails closed: a service the twin does not answer gets a 501, and nothing leaves the page
  const st = await pg.evaluate(() => AwsTransport.fetch("https://lambda.eu-west-2.amazonaws.com/2015-03-31/functions", { headers: {} }).then((r) => r.status));
  if (st !== 501) fail("twin did not fail closed: " + st);
  // leaving the twin goes back to the real sign-in
  inTwin = false;
  await Promise.all([pg.waitForNavigation(), pg.click("#twin-leave")]);
  await pg.waitForSelector("#signed-out-hero:not([hidden])");
  if (!(await pg.isHidden("#twin-bar"))) fail("still in the twin");
  if (errors.length) fail("page errors: " + errors.join(" | "));
  if (outside.length) fail("the twin reached outside the page: " + [...new Set(outside)].join(", "));
  console.log("OK (twin e2e: account, plans, S3 with CORS plan, .gz logs, zip, YAML; nothing left the page)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
