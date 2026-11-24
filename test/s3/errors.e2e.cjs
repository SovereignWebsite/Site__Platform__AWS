// S3 errors told apart, with a Retry (first note, item 15), against the twin with errors put in its answers: a file
// gone (NoSuchKey), a folder the read role may not list (AccessDenied), S3 busy (503 SlowDown) and fixed by Retry,
// and the browser refused (Failed to fetch). AWS's own code stays in the message.
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
  const { deps } = await pg.evaluate(() => window.AwsTwin.buckets);
  // window.__err = { match: RegExp source, status, code, times } makes the twin answer matching S3 URLs with that error.
  await pg.evaluate(() => {
    const h = window.AwsTwin.handle;
    window.AwsTwin.handle = (u, i) => {
      const e = window.__err;
      if (e && e.times > 0 && new RegExp(e.match).test(u)) {
        e.times--;
        if (e.code === "fetch") return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve(new Response("<Error><Code>" + e.code + "</Code><Message>put in by the test</Message></Error>", { status: e.status, headers: { "content-type": "application/xml" } }));
      }
      return h(u, i);
    };
  });
  const st = () => pg.textContent("#s3-status");
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/lambdas-dependencies/"; }, deps);
  await pg.waitForSelector("#s3-list button:has-text('.zip')");
  const zip = (await pg.textContent("#s3-list button:has-text('.zip')")).trim();

  // 1. A file gone since the listing.
  await pg.evaluate(() => { window.__err = { match: "\\.zip", status: 404, code: "NoSuchKey", times: 1 }; });
  await pg.click("#s3-list button:has-text('.zip')");
  await pg.waitForSelector("#s3-status >> text=no longer in the bucket");
  if (!(await st()).includes("NoSuchKey")) fail("AWS code not kept: " + await st());
  // Retry opens it once the file answers.
  await pg.click("#s3-status button.s3-retry");
  await pg.waitForSelector("#s3-file >> text=demo_handler/handler.py");

  // 2. A folder the read role may not list.
  await pg.evaluate(() => { window.__err = { match: "list-type=2", status: 403, code: "AccessDenied", times: 1 }; });
  await pg.click("#s3-objects .crumbs button >> nth=0");
  await pg.waitForSelector("#s3-status >> text=refused the read role here");
  if (!(await st()).includes("AccessDenied")) fail("AccessDenied code: " + await st());

  // 3. S3 busy, then Retry lists the folder.
  await pg.click("#s3-status button.s3-retry");
  await pg.waitForSelector("#s3-list >> text=lambdas-dependencies/");
  await pg.click("#s3-list >> text=lambdas-dependencies/");
  await pg.waitForSelector("#s3-list button:has-text('" + zip + "')");
  // Refresh asks S3 again (the listing cache would answer a second visit without asking).
  await pg.evaluate(() => { window.__err = { match: "list-type=2", status: 503, code: "SlowDown", times: 1 }; });
  await pg.click("#s3-objects button:has-text('Refresh')");
  await pg.waitForSelector("#s3-status >> text=busy or failed for a moment");
  if ((await st()).split(/\bRetry\b/).length - 1 !== 1) fail("Retry said more than once: " + await st());
  await pg.click("#s3-status button.s3-retry");
  await pg.waitForSelector("#s3-list button:has-text('" + zip + "')");

  // 4. The browser refused (CORS or offline).
  await pg.evaluate(() => { window.__err = { match: "list-type=2", code: "fetch", times: 1 }; });
  await pg.click("#s3-objects button:has-text('Refresh')");
  await pg.waitForSelector("#s3-status >> text=did not answer the browser");
  if (!/CORS rule/.test(await st())) fail("CORS hint: " + await st());

  // 5. A Retry kept from one bucket and clicked after moving to another asks the new bucket nothing.
  await pg.evaluate(() => { window.__err = { match: "\\.zip", status: 404, code: "NoSuchKey", times: 1 }; });
  // (case 4 left its Retry: it lists the folder again)
  await pg.click("#s3-status button.s3-retry");
  await pg.waitForSelector("#s3-list button:has-text('" + zip + "')");
  await pg.click("#s3-list button:has-text('" + zip + "')");
  await pg.waitForSelector("#s3-status button.s3-retry");
  await pg.evaluate(() => { window.__keptRetry = document.querySelector("#s3-status button.s3-retry"); });
  const { logs } = await pg.evaluate(() => window.AwsTwin.buckets);
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/"; }, logs);
  await pg.waitForSelector("#s3-list >> text=cloudfront/");
  const asked = []; await pg.exposeFunction("__asked", (u) => asked.push(u));
  await pg.evaluate(() => { const h = window.AwsTwin.handle; window.AwsTwin.handle = (u, i) => { window.__asked(u); return h(u, i); }; });
  await pg.evaluate(() => window.__keptRetry.click());
  await pg.waitForSelector("#s3-status >> text=That Retry was for");
  if (asked.length) fail("a stale Retry asked S3: " + asked.join(" "));

  // 6. An expired session: in the twin (no sign-in) the message does not ask the user to sign in.
  await pg.evaluate(() => { window.__err = { match: "list-type=2", status: 400, code: "ExpiredToken", times: 1 }; });
  await pg.click("#s3-status button.s3-retry").catch(() => {});
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/"; }, deps);
  await pg.click("#s3-objects button:has-text('Refresh')").catch(() => {});
  await pg.waitForSelector("#s3-status >> text=The session ran out");
  if (/Sign in/.test(await st())) fail("twin asked to sign in: " + await st());

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 errors: NoSuchKey, AccessDenied, SlowDown and Failed to fetch told apart with AWS's code kept; Retry repeats the step, only in the bucket it failed in)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
