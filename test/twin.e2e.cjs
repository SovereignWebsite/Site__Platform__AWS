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
  // the twin opens on S3; the account is read on entry
  if ((await pg.getAttribute("#tab-s3", "aria-selected")) !== "true") fail("twin did not open on S3");
  if (await pg.isVisible("#add-account")) fail("add-account form shown in the twin");
  await pg.click("#tab-accounts");
  // the account: set up already and read on entry; no CloudFormation steps, no sign out or forget in the twin
  await pg.waitForSelector("text=Cost this month so far (synthetic)");
  if (!(await pg.textContent("#accounts .badge")).includes("set up")) fail("twin account not set up");
  if ((await pg.textContent("#accounts")).includes("Open CloudFormation")) fail("CloudFormation steps shown in the twin");
  if (!(await pg.isHidden("#sign-out")) || !(await pg.isHidden("#forget-device"))) fail("sign out or forget shown in the twin");
  if (!/\d\d:\d\d [A-Z]/.test(await pg.textContent("#accounts .stats"))) fail("Until is not 24-hour with a zone");
  // tabs by keyboard
  await pg.focus("#tab-accounts"); await pg.keyboard.press("ArrowRight");
  if ((await pg.evaluate(() => document.activeElement.id)) !== "tab-s3" || (await pg.getAttribute("#tab-s3", "aria-selected")) !== "true") fail("arrow key on tabs");
  if ((await pg.getAttribute("#tab-accounts", "tabindex")) !== "-1") fail("roving tabindex");
  if (!(await pg.textContent("#accounts")).includes("sws-aws-platform-read")) fail("twin read role");
  // plans: the add is done, the removal and the stack update wait
  await pg.click("#tab-plans");
  if (await pg.isHidden("#plans-twin-note")) fail("no twin note on the plans");
  await pg.waitForFunction(() => document.querySelectorAll("#plans .badge.warn").length === 2 && document.querySelectorAll("#plans-done .badge.ok").length === 1);
  await pg.click('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"] button:has-text("Show the plan")');
  await pg.click('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"] button.approve');
  await pg.waitForSelector("text=Applied and checked");
  await pg.waitForFunction(() => document.querySelectorAll("#plans-done .badge.ok").length === 2);
  // S3
  await pg.click("#tab-s3");
  await pg.waitForSelector("#s3-buckets button:has-text('demo.static.example')"); // listed on entry
  await pg.click("#s3-buckets button:has-text('demo-cloudfront-logs')"); // CORS already in place: only the demo site shows the plan
  await pg.waitForSelector("#s3-list >> text=cloudfront/");
  for (const f of ["cloudfront/", "2026/", "11/", "21/", "10/"]) await pg.click(`#s3-list >> text=${f}`);
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("text=JSON Lines");
  if (!(await pg.textContent("#s3-file")).includes("cs_uri_stem")) fail("log lines");
  await pg.click("#s3-buckets button:has-text('demo-lambda-deps')");
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
  // more than 1000 keys: the first page and Load more
  await pg.click("#s3-objects .crumbs button >> nth=0");
  await pg.click("#s3-list >> text=archive/"); await pg.click("#s3-list >> text=2026/");
  for (let i = 0; i < 2; i++) { // the page asks for 500 a time: three pages for 1203 keys
    await pg.waitForSelector("#s3-objects button:has-text('Load more')");
    await pg.click("#s3-objects button:has-text('Load more')");
  }
  await pg.waitForSelector("#s3-list >> text=page-1203.json");
  // a small zip read whole: one request, the count honest
  await pg.click("#s3-buckets button:has-text('demo-lambda-deps')");
  await pg.click("#s3-list >> text=lambdas-dependencies/");
  await pg.click("#s3-list button:has-text('.zip')");
  await pg.waitForSelector("#s3-file >> text=read whole");
  if (!(await pg.textContent("#s3-file")).includes("2026-11-18")) fail("zip entry dates");
  if (process.argv[2]) await pg.screenshot({ path: process.argv[2], fullPage: true });
  // demo packs: the attack pack shows the scanner in the logs of 22 Nov
  if (await pg.$eval("#twin-pack", (e) => e.value) !== "baseline") fail("default pack");
  await Promise.all([pg.waitForNavigation(), pg.selectOption("#twin-pack", "attack")]);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  if (!(await pg.textContent("#twin-pack-about")).includes("scanning")) fail("pack description");
  // "See it in" opens the place the attack shows
  await pg.click("#twin-pack-see");
  await pg.waitForSelector("#s3-list button:has-text('.gz')");
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("text=JSON Lines");
  const attack = await pg.textContent("#s3-file");
  if (!attack.includes("203.0.113.66") || !/sqlmap|Nuclei/.test(attack)) fail("attack not in the logs");
  // fails closed: a service the twin does not answer gets a 501, and nothing leaves the page
  const st = await pg.evaluate(() => AwsTransport.fetch("https://dynamodb.eu-west-2.amazonaws.com/", { headers: {} }).then((r) => r.status));
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
