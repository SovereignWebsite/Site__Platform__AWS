// A large file in the S3 browser, against the twin: it is previewed from one Range request (never fetched whole),
// a .gz is unzipped from its first bytes, the preview ends on a whole line, and Download fetches the whole file.
// The twin's files are small, so the limits are lowered for the test (S3Browser.limits).
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
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/?twin`);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  // Record every S3 object read the twin answers: the key and the Range asked for (none = the whole object).
  await pg.evaluate(() => {
    const h = window.AwsTwin.handle; window.__gets = [];
    window.AwsTwin.handle = (url, init) => {
      const hd = (init && init.headers) || {}, range = hd.Range || hd.range || null;
      if (/\.s3\.|s3\.[a-z0-9-]+\.amazonaws/.test(url) && !/list-type/.test(url)) window.__gets.push({ key: new URL(url).pathname, range });
      return h(url, init);
    };
  });
  const gets = () => pg.evaluate(() => window.__gets.splice(0));
  await pg.click("#tab-s3");

  // 1. Plain text: index.html is 155 B; with show at 100 B and preview at 120 B it is previewed, cut at a line end.
  await pg.evaluate(() => { window.S3Browser.setLimits({ show: 100, preview: 120 }); });
  await pg.click("#s3-buckets button:has-text('demo-site')");
  await pg.click("text=Approve and add the rule to");
  await pg.waitForSelector("#s3-list >> text=index.html");
  await gets();
  await pg.click("#s3-list >> text=index.html");
  await pg.waitForSelector("#s3-file .preview");
  let g = await gets();
  if (g.length !== 1 || g[0].range !== "bytes=0-119") fail("index.html: want one read of bytes=0-119, got " + JSON.stringify(g));
  const note = await pg.textContent("#s3-file .preview");
  if (!/Preview: the first \d+ B of 155 B/.test(note)) fail("preview note: " + note);
  const shown = await pg.textContent("#s3-file pre");
  if (!shown.endsWith("\n")) fail("the preview does not end on a whole line: " + JSON.stringify(shown.slice(-40)));
  if (shown.length > 120) fail("the preview shows more than was fetched");
  // Download fetches the whole file, once, and only on the click.
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#s3-file button:has-text('Download (155 B)')")]);
  if (dl.suggestedFilename() !== "index.html") fail("download name " + dl.suggestedFilename());
  if (fs.readFileSync(await dl.path()).length !== 155) fail("download is not the whole file");
  g = await gets();
  if (g.length !== 1 || g[0].range !== null) fail("Download: want one whole read, got " + JSON.stringify(g));

  // 2. gzip: the twin's CloudFront log is a few hundred bytes (over 500); with show at 500 B and preview at 400 B, 400 B are fetched and unzipped
  //    to whole JSON Lines, though the gzip stream is cut.
  await pg.evaluate(() => { window.S3Browser.setLimits({ show: 500, preview: 400 }); });
  await pg.click("#s3-buckets button:has-text('demo-cloudfront-logs')");
  for (const f of ["cloudfront/", "2026/", "11/", "21/", "10/"]) await pg.click(`#s3-list >> text=${f}`);
  await gets();
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("#s3-file .preview");
  // One or more whole log lines came out of the cut gzip (one line reads as a JSON value, more as JSON Lines).
  await pg.waitForFunction(() => /JSON Lines \(\d+\)|: JSON, formatted/.test(document.querySelector("#s3-status").textContent), null, { timeout: 5000 })
    .catch(async () => fail("gzip preview status: " + (await pg.textContent("#s3-status"))));
  g = await gets();
  if (g.length !== 1 || g[0].range !== "bytes=0-399") fail(".gz: want one read of bytes=0-399, got " + JSON.stringify(g));
  if (!/first 400 B of \d+ B \(gzip\)/.test(await pg.textContent("#s3-file .preview"))) fail("gzip preview note");
  if (!(await pg.textContent("#s3-file")).includes("cs_uri_stem")) fail("no log fields in the gzip preview");

  // 3. Under the limit, a file is still read whole and shown as before (no preview note).
  await pg.evaluate(() => { window.S3Browser.setLimits({ show: 5 * 1024 * 1024, preview: 256 * 1024 }); });
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForFunction(() => /gzip: \d+ B unzipped/.test(document.querySelector("#s3-file").textContent));
  if (await pg.$("#s3-file .preview")) fail("a small file shows a preview note");
  g = await gets();
  if (g.length !== 1 || g[0].range !== null) fail("small file: want one whole read, got " + JSON.stringify(g));

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 preview: large files by one Range request, cut gzip unzipped, whole lines, Download on click only)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message, (e.stack.match(/preview.e2e.cjs:\d+/) || [""])[0]); process.exit(1); });
