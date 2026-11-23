// "Newest file" in the S3 browser (sherpa walk 1, item 6), against the twin: in a folder of files it opens the one
// changed most recently, as a click would; in a folder of folders it follows the last folder by name at each level.
const { chromium, devices } = require("playwright");
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
  const { logs, deps } = await pg.evaluate(() => window.AwsTwin.buckets);

  // 1. A folder of folders (the bucket's root): it follows the last folder by name at each level, as a person
  // digging by hand for the newest log would, and opens that folder's newest file (sherpa walk 7).
  const lastFolder = () => pg.evaluate(() => { const f = [...document.querySelectorAll("#s3-list tr.folder")].map((tr) => tr.dataset.name).sort(); return f[f.length - 1] || null; });
  let at = "", want = null;
  for (let depth = 0; depth < 8 && !want; depth++) {
    await pg.evaluate(([b, f]) => { location.hash = "#/s3/" + b + "/" + f; }, [logs, at]);
    await pg.waitForFunction((f) => { const c = document.querySelector("#s3-objects .crumbs"); return c && document.querySelector("#s3-list") && location.hash.endsWith(f.split("/").map(encodeURIComponent).join("/")); }, at);
    await pg.waitForSelector("#s3-list tr");
    want = await pg.evaluate(() => { let best = null; document.querySelectorAll("#s3-list tr.file").forEach((tr) => { if (!best || tr.dataset.when > best.dataset.when) best = tr; }); return best && best.dataset.name; });
    if (!want) at = await lastFolder();
  }
  if (!want) fail("no file found by hand under " + logs);
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/"; }, logs);
  await pg.waitForSelector("#s3-list >> text=cloudfront/");
  await pg.click("#s3-objects button.s3-newest");
  await pg.waitForFunction((k) => { const h = document.querySelector("#s3-file h4"); return h && h.textContent === k; }, want, { timeout: 15000 })
    .catch(async () => fail("Newest from the root opened " + await pg.textContent("#s3-file h4").catch(() => "nothing") + ", by hand: " + want));
  if (!(await pg.evaluate(() => location.hash)).endsWith(encodeURIComponent(want.split("/").pop()))) fail("address after Newest from the root: " + await pg.evaluate(() => location.hash));

  // 2. A folder of files: the newest by LastModified opens.
  for (const [b, folder] of [[logs, "cloudfront/2026/11/21/10/"], [deps, "lambdas-dependencies/"]]) {
    await pg.evaluate(([b, f]) => { location.hash = "#/s3/" + b + "/" + f; }, [b, folder]);
    await pg.waitForSelector("#s3-list tr.file");
    const want = await pg.evaluate(() => { let best = null; document.querySelectorAll("#s3-list tr.file").forEach((tr) => { if (!best || tr.dataset.when > best.dataset.when) best = tr; }); return best.dataset.name; });
    await pg.click("#s3-objects button.s3-newest");
    await pg.waitForFunction((k) => { const h = document.querySelector("#s3-file h4"); return h && h.textContent === k; }, want);
    if (!(await pg.evaluate(() => location.hash)).endsWith(encodeURIComponent(want.split("/").pop()))) fail("address after Newest file: " + await pg.evaluate(() => location.hash));
  }

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 newest: opens the most recently changed file listed, as a click; from a bucket's root, follows the last folder down to the newest log)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
