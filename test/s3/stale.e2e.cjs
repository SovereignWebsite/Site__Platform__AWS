// Quick clicks in the S3 browser, against the twin: a slow, older answer must never land under a newer click.
// The twin's answers are slowed for one key or one folder, then the user clicks on before they come back.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "..", "site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".yaml": "text/yaml" };
const srv = http.createServer((q, s) => {
  let p = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (p.endsWith("/")) p += "index.html";
  if (!fs.existsSync(p)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); s.end(fs.readFileSync(p));
}).listen(0);
const fail = (m) => { throw new Error(m); };
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/?twin`);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  // Slow the twin down for whatever matches window.__slow (a substring of the URL).
  await pg.evaluate(() => {
    const h = window.AwsTwin.handle;
    window.AwsTwin.handle = (url, init) => {
      const p = h(url, init);
      return p && window.__slow && url.includes(window.__slow) ? p.then((r) => new Promise((res) => setTimeout(() => res(r), 1500))) : p;
    };
  });
  await pg.click("#tab-s3");
  await pg.click("#s3-list-buckets");
  await pg.click("#s3-buckets button:has-text('demo-site')");
  await pg.click("text=Approve and add the rule to");
  await pg.waitForSelector("#s3-list >> text=index.html");

  // 1. A folder: open assets/ (slow), then go back to the bucket's top before it answers.
  await pg.evaluate(() => { window.__slow = "prefix=assets"; });
  await pg.click("#s3-list >> text=assets/");
  await pg.click("#s3-buckets button:has-text('demo-site')");
  await pg.waitForSelector("#s3-list >> text=index.html");
  await pg.waitForTimeout(2000);
  if ((await pg.textContent("#s3-list")).includes("site.css")) fail("the slow assets/ listing landed under the bucket's top");
  if ((await pg.$$("#s3-list")).length !== 1) fail("two listings on the page");

  // 2. A file: open index.html (slow), then open another file before it answers.
  await pg.evaluate(() => { window.__slow = "/index.html"; });
  await pg.click("#s3-list >> text=index.html");
  await pg.evaluate(() => { window.__slow = null; });
  await pg.click("#s3-list >> text=data/");
  await pg.click("#s3-list >> text=vaults.json");
  await pg.waitForSelector("#s3-file >> text=vault-demo-001");
  await pg.waitForTimeout(2000);
  const shown = await pg.textContent("#s3-file");
  if (shown.includes("Demo site") || shown.includes("index.html")) fail("the slow index.html landed under vaults.json: " + shown.slice(0, 200));
  if (!(await pg.textContent("#s3-status")).includes("vaults.json")) fail("status names the older file");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 stale answers: a slow folder and a slow file are dropped after a newer click)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
