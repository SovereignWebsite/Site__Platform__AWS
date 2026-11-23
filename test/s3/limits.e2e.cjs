// R-016, the S3 browser's part: a small .gz that unzips to far more than the show limit is unzipped only up to the
// limit (and says so), and a file whose size is not known (a link to a key not on its folder's first page) is not
// fetched at all, zip or not.
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
  // The twin's hourly log becomes a gzip of 64 MB of log lines (about 0.3 MB compressed); every object read is recorded.
  await pg.evaluate(() => {
    const line = '{"date":"2026-11-21","cs_uri_stem":"/index.html","sc_status":200,"pad":"' + "x".repeat(100) + '"}\n';
    const big = new TextEncoder().encode(line.repeat(Math.ceil(64 * 1024 * 1024 / line.length)));
    window.__bomb = new Response(new Blob([big]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const h = window.AwsTwin.handle; window.__gets = [];
    window.AwsTwin.handle = (url, init) => {
      const p = new URL(url).pathname;
      if (!/list-type/.test(url) && /\.s3\.|s3\.[a-z0-9-]+\.amazonaws/.test(url)) window.__gets.push(p);
      if (/\/cloudfront\/2026\/11\/21\/10\/[^/?]+\.gz$/.test(p)) return window.__bomb.then((b) => new Response(b, { status: 200, headers: { "content-type": "application/octet-stream" } }));
      if (/list-type/.test(url) && /prefix=cloudfront%2F2026%2F11%2F21%2F10%2F/.test(url)) {
        // The listing gives the bomb's real (compressed) size, under the show limit, so the whole-file path is taken.
        return Promise.all([h(url, init), window.__bomb]).then(([r, b]) => r.text().then((t) => new Response(t.replace(/<Size>\d+<\/Size>/, "<Size>" + b.byteLength + "</Size>"), { status: r.status, headers: { "content-type": "application/xml" } })));
      }
      return h(url, init);
    };
  });
  const size = await pg.evaluate(() => window.__bomb.then((b) => b.byteLength));
  if (size > 5 * 1024 * 1024) fail("the test gzip is not small: " + size);

  // 1. Click the small .gz: unzipping stops at the limit, a note says so, the page stays usable.
  await pg.click("#tab-s3");
  await pg.click("#s3-buckets button:has-text('demo-cloudfront-logs')");
  for (const f of ["cloudfront/", "2026/", "11/", "21/", "10/"]) await pg.click(`#s3-list >> text=${f}`);
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("#s3-file .preview", { timeout: 20000 });
  const note = await pg.textContent("#s3-file .preview");
  if (!/unzips to more than 5\.0 MB; unzipping stopped there/.test(note)) fail("gzip cap note: " + note);
  if (!/JSON Lines \(\d+\)/.test(await pg.textContent("#s3-status"))) fail("the capped part is not shown as log lines");
  const shown = await pg.evaluate(() => document.querySelectorAll("#s3-file .j-num").length);
  if (shown === 0 || shown > 1000) fail("rows built: " + shown);

  // 2. A link to a key not in its folder's listing: nothing is fetched, and the status says why.
  for (const key of ["cloudfront/2026/11/21/10/not-listed.gz", "cloudfront/2026/11/21/10/not-listed.zip"]) {
    await pg.evaluate(() => { window.__gets.length = 0; });
    const bucket = await pg.textContent("#s3-buckets button[aria-pressed=true]");
    await pg.evaluate((h) => { location.hash = h; }, "#/s3/" + bucket + "/" + key);
    await pg.waitForFunction(() => /size is not known yet, so it was not opened|not in the part of this folder listed so far/.test(document.querySelector("#s3-status").textContent), null, { timeout: 5000 })
      .catch(async () => fail(key + ": status " + (await pg.textContent("#s3-status"))));
    const gets = await pg.evaluate(() => window.__gets.slice());
    if (gets.some((p) => p.endsWith("/" + key))) fail(key + " was fetched: " + gets.join(", "));
  }

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log(`OK (s3 limits: a ${Math.round(size / 1024)} KB gzip of 64 MB stops unzipping at 5 MB with a note; unknown-size files, zip or not, are not fetched)`);
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
