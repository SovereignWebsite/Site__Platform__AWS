// Items 10 and 11: the folder listing sorts by name, size or date (either way, folders first, the choice kept across
// folders, aria-sort on the header), counts what is listed, and answers from a one-minute cache when the user goes
// back to a folder; Refresh lists it from S3 again.
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
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ": got " + JSON.stringify(a) + ", want " + JSON.stringify(b)); };
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/?twin`);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  // Count ListObjectsV2 calls by prefix.
  await pg.evaluate(() => {
    const h = window.AwsTwin.handle; window.__lists = [];
    window.AwsTwin.handle = (url, init) => { if (/list-type=2/.test(url)) window.__lists.push(new URL(url).searchParams.get("prefix") || ""); return h(url, init); };
  });
  const lists = () => pg.evaluate(() => window.__lists.splice(0));
  const rows = () => pg.evaluate(() => [...document.querySelectorAll("#s3-list tr")].map((tr) => ({ folder: tr.classList.contains("folder"), name: tr.dataset.name, size: +(tr.dataset.size || 0), when: tr.dataset.when || "" })));
  const sortState = () => pg.evaluate(() => [...document.querySelectorAll("#s3-objects th[data-sort]")].map((th) => th.dataset.sort + ":" + th.getAttribute("aria-sort")));
  const status = () => pg.textContent("#s3-status");

  await pg.click("#tab-s3");
  await pg.click("#s3-buckets button:has-text('demo-site')");
  await pg.click("text=Approve and add the rule to");
  await pg.waitForSelector("#s3-list >> text=index.html");

  // 1. Default: by name, folders first; the status counts folders and files.
  let r = await rows();
  const files = r.filter((x) => !x.folder), folders = r.filter((x) => x.folder);
  if (!files.length || !folders.length) fail("the demo site's top has no folders or no files");
  if (r.slice(0, folders.length).some((x) => !x.folder)) fail("folders are not first");
  eq(files.map((x) => x.name), files.map((x) => x.name).slice().sort(), "files by name");
  eq(await sortState(), ["name:ascending", "size:none", "when:none"], "aria-sort by name");
  if (!new RegExp(": " + folders.length + " folders?, " + files.length + " files?").test(await status())) fail("count in status: " + (await status()));

  // 2. Size: largest first, again smallest first; folders stay first.
  await pg.click("#s3-objects th[data-sort=size] button");
  r = await rows();
  if (r.slice(0, folders.length).some((x) => !x.folder)) fail("folders not first after sorting by size");
  const sizes = r.filter((x) => !x.folder).map((x) => x.size);
  eq(sizes, sizes.slice().sort((a, b) => b - a), "size, largest first");
  eq(await sortState(), ["name:none", "size:descending", "when:none"], "aria-sort size descending");
  await pg.click("#s3-objects th[data-sort=size] button");
  const sizes2 = (await rows()).filter((x) => !x.folder).map((x) => x.size);
  eq(sizes2, sizes2.slice().sort((a, b) => a - b), "size, smallest first");

  // 3. Date: newest first, and the choice is kept when opening another folder.
  await pg.click("#s3-objects th[data-sort=when] button");
  await lists();
  await pg.click("#s3-list >> text=archive/"); await pg.click("#s3-list >> text=2026/");
  await pg.waitForSelector("#s3-list >> text=page-");
  eq(await sortState(), ["name:none", "size:none", "when:descending"], "sort kept in another folder");
  const whens = (await rows()).filter((x) => !x.folder).map((x) => x.when);
  eq(whens, whens.slice().sort().reverse(), "date, newest first");
  if (!/so far, more in S3/.test(await status())) fail("a truncated listing does not say more is in S3: " + (await status()));

  // 4. Cache: back to the top and into archive/ again: no new ListObjects for folders seen in the last minute.
  eq(await lists(), ["archive/", "archive/2026/"], "first visits list from S3");
  await pg.click("#s3-objects .crumbs button >> nth=0");
  await pg.waitForSelector("#s3-list >> text=index.html");
  await pg.click("#s3-list >> text=archive/");
  await pg.waitForSelector("#s3-list >> text=2026/");
  eq(await lists(), [], "going back answers from the cache");
  if (!/listed \d+ s ago; Refresh to list again/.test(await status())) fail("a cached listing does not say so: " + (await status()));

  // 5. Refresh lists from S3 again, and the status no longer says it is cached.
  await pg.click("#s3-objects button:has-text('Refresh')");
  await pg.waitForFunction(() => !/listed \d+ s ago/.test(document.querySelector("#s3-status").textContent) && /: \d+ folder/.test(document.querySelector("#s3-status").textContent));
  eq(await lists(), ["archive/"], "Refresh lists from S3");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 listing: sort by name, size, date both ways with folders first and aria-sort, kept across folders; counts; one-minute cache on going back; Refresh)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
