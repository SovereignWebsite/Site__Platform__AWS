// "Newest file" in the S3 browser (sherpa walk 1, item 6), against the twin: in a folder of files it opens the one
// changed most recently, as a click would; in a folder of folders it says so and opens nothing.
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

  // 1. A folder of folders: nothing opens.
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/cloudfront/2026/11/21/"; }, logs);
  await pg.waitForSelector("#s3-list button");
  await pg.click("#s3-objects button.s3-newest");
  await pg.waitForSelector("#s3-status >> text=No files listed in this folder");
  if ((await pg.textContent("#s3-file")).trim()) fail("something opened in a folder of folders");

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
  console.log("OK (s3 newest: opens the most recently changed file listed, as a click; says so in a folder of folders)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
