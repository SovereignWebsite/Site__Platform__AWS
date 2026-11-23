// "Summarise these logs" in the S3 browser, against the twin, with data.aws.a's site/data scripts loaded into the
// page (index.html does not load them yet): offered on a folder of hourly logs and nowhere else, absent when the
// scripts are not there, and the summary is built from the folder's files in the page, asking only the twin.
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
  const base = `http://localhost:${srv.address().port}/?twin`;
  await pg.goto(base);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  const { logs, deps } = await pg.evaluate(() => window.AwsTwin.buckets);
  const day = `#/s3/${logs}/cloudfront/2026/11/21/`;

  // 1. Without the data scripts: no button.
  await pg.evaluate((h) => { location.hash = h; }, day);
  await pg.waitForSelector("#s3-list button");
  if (await pg.$("#s3-objects button:has-text('Summarise these logs')")) fail("button shown without LogView");

  // 2. With them: offered on a day of logs, not on a non-log folder.
  for (const f of ["data/extract.js", "data/links.js", "data/view.js"]) await pg.addScriptTag({ url: f });
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/lambdas-dependencies/"; }, deps);
  await pg.waitForSelector("#s3-list button:has-text('.zip')");
  if (await pg.$("#s3-objects button:has-text('Summarise these logs')")) fail("button shown on a folder that is not logs");
  await pg.evaluate((h) => { location.hash = h; }, day);
  await pg.waitForSelector("#s3-objects button:has-text('Summarise these logs')");

  // 3. The summary: every file under the day, read in the page; only S3 GETs to the logs bucket.
  const asks = []; await pg.exposeFunction("__ask", (m, u) => asks.push(m + " " + u));
  await pg.evaluate(() => { const h = window.AwsTwin.handle; window.AwsTwin.handle = (u, i) => { window.__ask((i && i.method) || "GET", u); return h(u, i); }; });
  await pg.click("#s3-objects button:has-text('Summarise these logs')");
  await pg.waitForSelector("#s3-status >> text=nothing was kept or sent", { timeout: 20000 });
  const text = await pg.textContent("#s3-file");
  if (!/requests/.test(text)) fail("no summary shown: " + text.slice(0, 200));
  if (!(await pg.textContent("#s3-file h4")).includes("cloudfront/2026/11/21/")) fail("summary heading");
  const s3 = asks.filter((a) => /\.s3\.|\/\/s3\./.test(a));
  if (!s3.some((a) => /list-type=2&max-keys=1000/.test(a))) fail("the folder was not listed in full");
  const files = s3.filter((a) => /\.gz(\?|$)/.test(a));
  if (!files.length) fail("no log file read");
  if (s3.some((a) => !a.startsWith("GET ") || a.indexOf(logs) < 0)) fail("unexpected S3 request: " + s3.filter((a) => !a.startsWith("GET ") || a.indexOf(logs) < 0).join(" "));
  if (await pg.evaluate(() => location.hash) !== `#/s3/${logs}/cloudfront/2026/11/21/`) fail("address after summary " + await pg.evaluate(() => location.hash));

  // 4. Investigation mode: a line's file:line opens that log file through the address (same checks as a link).
  const val = await pg.$("#s3-file button[data-field]");
  if (!val) fail("no clickable value in the summary");
  await val.click();
  await pg.waitForSelector("#s3-file button[data-ref='src']");
  await pg.click("#s3-file button[data-ref='src']");
  await pg.waitForSelector("text=JSON Lines");
  if (!/^#\/s3\/[^/]+\/cloudfront\/2026\/11\/21\/\d{2}\/.+\.gz$/.test(await pg.evaluate(() => location.hash))) fail("jump to the log file: " + await pg.evaluate(() => location.hash));

  // 5. A folder over 500 MB in all is refused before anything is read, with the total shown.
  await pg.evaluate(() => {
    const h = window.AwsTwin.handle;
    window.AwsTwin.handle = (u, i) => {
      const r = h(u, i); if (!r || !/list-type=2&max-keys=1000/.test(u)) return r;
      let extra = ""; for (let n = 0; n < 20; n++) extra += "<Contents><Key>cloudfront/2026/11/21/23/big-" + n + ".gz</Key><Size>31457280</Size></Contents>";
      return r.then((res) => res.text().then((t) => new Response(t.replace("</ListBucketResult>", extra + "</ListBucketResult>"), { status: res.status, headers: res.headers })));
    };
  });
  await pg.evaluate((h) => { location.hash = h; }, day);
  await pg.waitForSelector("#s3-objects button:has-text('Summarise these logs')");
  asks.length = 0;
  await pg.click("#s3-objects button:has-text('Summarise these logs')");
  await pg.waitForSelector("#s3-status >> text=for one summary; open a smaller folder");
  if (!/MB in all/.test(await pg.textContent("#s3-status"))) fail("total not shown");
  if (asks.some((a) => /\.gz(\?|$)/.test(a))) fail("a file was read past the total ceiling");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 summary: offered on a folder of hourly logs only when LogView is loaded; " + files.length + " files read in the page, GETs to the logs bucket only; file:line opens the log; over 500 MB refused before reading)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
