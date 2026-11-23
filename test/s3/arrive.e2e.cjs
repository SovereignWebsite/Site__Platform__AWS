// Arriving in the S3 browser by an address puts the place on screen: after the twin's "See it in", a shared link
// to a folder or a file, or a reload, the folder's crumbs (or the file's heading) are in view and hold the focus.
// Sherpa walk 3, finding 2: the list opened at 825 px on an 800 px window (1320 px on phone), page not scrolled.
// Clicks inside the browser do not move the page.
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

// The element is inside the window, and the focus is on it (or inside it).
async function onScreen(pg, sel, what) {
  const r = await pg.evaluate((sel) => {
    const e = document.querySelector(sel); if (!e) return null;
    const b = e.getBoundingClientRect(), a = document.activeElement;
    return { top: b.top, bottom: b.bottom, h: innerHeight, focus: e === a || e.contains(a) };
  }, sel);
  if (!r) fail(what + ": not found");
  if (r.top < 0 || r.bottom > r.h) fail(what + ": off screen (" + Math.round(r.top) + " to " + Math.round(r.bottom) + " px in a " + r.h + " px window)");
  if (!r.focus) fail(what + ": not focused (" + await pg.evaluate(() => { const a = document.activeElement; return a ? a.tagName + "#" + a.id + "." + a.className + " " + (a.textContent || "").slice(0, 40) : "none"; }) + ")");
}

async function run(br, ctxOpts, label) {
  const ctx = await br.newContext(ctxOpts), pg = await ctx.newPage();
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message));
  const base = `http://localhost:${srv.address().port}/`;
  await pg.goto(base + "?twin&pack=attack");
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  const { logs } = await pg.evaluate(() => window.AwsTwin.buckets);

  // 1. "See it in the CloudFront logs": the folder's crumbs are on screen and focused.
  await pg.evaluate(() => scrollTo(0, 0));
  await pg.click("#twin-pack-see");
  await pg.waitForSelector("#s3-list button:has-text('.gz')");
  await onScreen(pg, "#s3-objects .crumbs", label + " see-it crumbs");

  // 2. A click inside the browser does not move the page or the focus to the crumbs.
  await pg.evaluate(() => scrollTo(0, 0));
  const y0 = await pg.evaluate(() => scrollY);
  const gz = (await pg.textContent("#s3-list button:has-text('.gz')")).trim();
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("text=JSON Lines");
  const moved = await pg.evaluate((y0) => scrollY !== y0 && document.activeElement && document.activeElement.closest(".crumbs"), y0);
  if (moved) fail(label + ": a click moved the page to the crumbs");

  // 3. A shared link to a file (fresh load): the file's heading is on screen and focused.
  const at = await pg.evaluate(() => location.hash);
  await pg.goto("about:blank");
  await pg.goto(base + "?twin&pack=attack" + at);
  await pg.waitForSelector("text=JSON Lines");
  if (!(await pg.textContent("#s3-file h4")).endsWith(gz)) fail(label + ": wrong file from the link");
  await onScreen(pg, "#s3-file h4", label + " file heading from a link");

  // 4. Back to the folder: the crumbs again.
  await pg.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/cloudfront/"; }, logs);
  await pg.waitForSelector("#s3-list >> text=2026/");
  await onScreen(pg, "#s3-objects .crumbs", label + " crumbs after a new address");

  if (errors.length) fail(label + " page errors: " + errors.join(" | "));
  await ctx.close();
}

(async () => {
  const br = await chromium.launch();
  await run(br, { viewport: { width: 1200, height: 800 } }, "desktop");
  await run(br, { ...devices["iPhone 13"] }, "phone");
  console.log("OK (s3 arrival: See it in, links and new addresses put the place on screen with the focus; clicks do not)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
