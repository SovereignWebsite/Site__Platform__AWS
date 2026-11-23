// The S3 browser's address, against the twin: #/s3/<bucket>/<folder or file> follows each click; reload and a
// shared link open the same place; Back goes back a step; an address can name only this account's buckets, and
// only ever reads (a bucket without the CORS rule shows the plan, never applies it).
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
  const base = `http://localhost:${srv.address().port}/?twin`;
  await pg.goto(base);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  const { site, logs, deps } = await pg.evaluate(() => window.AwsTwin.buckets);
  const hash = () => pg.evaluate(() => location.hash);

  // 1. Clicks write the address (the Lambda dependencies bucket: a folder, then a zip whose name has "==").
  await pg.click("#tab-s3");
  await pg.click(`#s3-buckets button:has-text('${deps}')`);
  await pg.waitForSelector("#s3-list >> text=lambdas-dependencies/");
  if (await hash() !== `#/s3/${deps}/`) fail("bucket address " + await hash());
  await pg.click("#s3-list >> text=lambdas-dependencies/");
  await pg.waitForSelector("#s3-list button:has-text('.zip')");
  if (await hash() !== `#/s3/${deps}/lambdas-dependencies/`) fail("folder address " + await hash());
  const zip = (await pg.textContent("#s3-list button:has-text('.zip')")).trim();
  await pg.click("#s3-list button:has-text('.zip')");
  await pg.waitForSelector("#s3-file >> text=demo_handler/handler.py");
  if (await hash() !== `#/s3/${deps}/lambdas-dependencies/` + encodeURIComponent(zip)) fail("file address " + await hash());

  // 2. Reload keeps the place: the folder listed and the zip open, with no clicks.
  await pg.reload();
  await pg.waitForSelector("#s3-file >> text=demo_handler/handler.py");
  if (!(await pg.textContent("#s3-list")).includes(zip)) fail("folder not listed after reload");
  if ((await pg.getAttribute("#tab-s3", "aria-selected")) !== "true") fail("S3 tab not shown after reload");

  // 3. Back goes to the folder (file closed), then to the bucket's top.
  await pg.goBack();
  await pg.waitForFunction(() => !document.querySelector("#s3-file").textContent.includes("handler.py"));
  if (await hash() !== `#/s3/${deps}/lambdas-dependencies/`) fail("back to folder " + await hash());
  await pg.goBack();
  await pg.waitForSelector("#s3-list >> text=lambdas-dependencies/");
  if (await hash() !== `#/s3/${deps}/`) fail("back to top " + await hash());

  // 4. A shared link straight to a log file five folders down, in another bucket, opens it.
  await pg.goto(base + `#/s3/${logs}/cloudfront/2026/11/21/10/`);
  await pg.waitForSelector("#s3-list button:has-text('.gz')");
  const gz = await pg.textContent("#s3-list button:has-text('.gz')");
  await pg.goto(base + `#/s3/${logs}/cloudfront/2026/11/21/10/` + encodeURIComponent(gz));
  await pg.waitForSelector("text=JSON Lines");
  if (!(await pg.textContent("#s3-file")).includes("cs_uri_stem")) fail("log not opened from a link");

  // 5. Addresses that are not this account's buckets open nothing, and ask S3 nothing.
  const s3asks = []; await pg.exposeFunction("__ask", (u) => s3asks.push(u));
  await pg.evaluate(() => { const h = window.AwsTwin.handle; window.AwsTwin.handle = (u, i) => { if (/\.s3\.|\/\/s3\./.test(u)) window.__ask(u); return h(u, i); }; });
  await pg.evaluate(() => { location.hash = "#/s3/a%2Fevil/x"; });
  await pg.waitForSelector("#s3-status >> text=does not name an S3 bucket");
  await pg.evaluate(() => { location.hash = "#/s3/x/y"; });
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/data/../index.html"; }, site);
  await pg.waitForSelector("#s3-status >> text=does not name an S3 bucket");
  await pg.evaluate(() => { location.hash = "#/s3/not-a-bucket-here/x.json"; });
  await pg.waitForSelector("#s3-status >> text=is not one of this account's buckets");
  if (s3asks.length) fail("S3 asked for a bad address: " + s3asks.join(" "));

  // 6. A link into a bucket that does not answer this site yet shows the plan; an address never approves it.
  let changed = 0; await pg.exposeFunction("__change", () => changed++);
  await pg.evaluate(() => { const h = window.AwsTwin.handle; window.AwsTwin.handle = (u, i) => { if (/UpdateResource/.test(JSON.stringify((i && i.headers) || {}))) window.__change(); return h(u, i); }; });
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/index.html"; }, site);
  await pg.waitForSelector("text=Approve and add the rule to");
  await pg.waitForTimeout(500);
  if (changed) fail("an address changed a bucket");
  if (s3asks.length) fail("S3 asked before the rule: " + s3asks.join(" "));

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 address: clicks write it, reload and links open it, Back steps back, only this account's buckets)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
