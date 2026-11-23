// Item 9: a large folder (the twin's archive/2026/, 1203 keys, 500 a page) loads its next page by itself when the end
// of the list scrolls into view, once per page even when "Load more" is clicked at the same moment; and the filter
// can ask S3 for the names that start with what was typed, so names beyond the loaded pages are found.
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
  await pg.evaluate(() => {
    const h = window.AwsTwin.handle; window.__lists = [];
    window.AwsTwin.handle = (url, init) => {
      if (/list-type=2/.test(url)) { const q = new URL(url).searchParams; window.__lists.push((q.get("prefix") || "") + (q.get("continuation-token") ? " +page" : "")); }
      return h(url, init);
    };
  });
  const lists = () => pg.evaluate(() => window.__lists.splice(0));
  const files = () => pg.evaluate(() => [...document.querySelectorAll("#s3-list tr.file")].map((tr) => tr.dataset.name));
  const status = () => pg.textContent("#s3-status");

  await pg.click("#tab-s3");
  await pg.click("#s3-buckets button:has-text('demo-site')");
  await pg.click("text=Approve and add the rule to");
  await pg.click("#s3-list >> text=archive/"); await pg.click("#s3-list >> text=2026/");
  await pg.waitForSelector("#s3-objects button:has-text('Load more')");
  if ((await files()).length !== 500) fail("first page is not 500");
  await lists();

  // 1. Scrolling to the end loads the next page by itself, then the last one; every key once.
  for (const want of [1000, 1203]) {
    await pg.evaluate(() => { const b = [...document.querySelectorAll("#s3-objects button")].find((x) => x.textContent === "Load more"); b.scrollIntoView(); });
    await pg.waitForFunction((n) => document.querySelectorAll("#s3-list tr.file").length === n, want, { timeout: 5000 })
      .catch(async () => fail("scrolling did not load to " + want + ": " + (await files()).length));
  }
  const all = await files();
  if (new Set(all).size !== 1203) fail("duplicate or missing keys: " + all.length + " rows, " + new Set(all).size + " distinct");
  if (await pg.$("#s3-objects button:has-text('Load more')")) fail("Load more left after the last page");
  if (/more in S3/.test(await status())) fail("status still says more in S3: " + (await status()));
  const l1 = await lists();
  if (l1.length !== 2 || l1.some((x) => !/ \+page$/.test(x))) fail("want two page requests, got " + JSON.stringify(l1));

  // 2. Clicking Load more while it scrolls into view loads the page once.
  await pg.click("#s3-objects button:has-text('Refresh')");
  await pg.waitForFunction(() => document.querySelectorAll("#s3-list tr.file").length === 500);
  await lists();
  await pg.click("#s3-objects button:has-text('Load more')"); // Playwright scrolls it into view, then clicks
  await pg.waitForFunction(() => document.querySelectorAll("#s3-list tr.file").length >= 1000);
  await pg.waitForTimeout(500);
  const names2 = await files();
  if (names2.length !== new Set(names2).size) fail("a page was loaded twice");
  if ((await lists()).filter((x) => / \+page$/.test(x)).length > 2) fail("more page requests than pages");

  // 3. Search: with pages still in S3, typing a name start offers to ask S3; Enter lists only those names.
  await pg.evaluate(() => { window.S3Browser.limits.autoPages = 0; }); // keep pages in S3 for this step
  await pg.click("#s3-objects button:has-text('Refresh')");
  await pg.waitForFunction(() => document.querySelectorAll("#s3-list tr.file").length === 500);
  await lists();
  await pg.fill("#s3-objects input.filter", "page-12");
  await pg.waitForSelector("#s3-objects button.s3-search:not([hidden])");
  if (!/Find names starting with .page-12. in S3/.test(await pg.textContent("#s3-objects button.s3-search"))) fail("search button label");
  await pg.press("#s3-objects input.filter", "Enter");
  await pg.waitForFunction(() => /names starting with page-12\): \d+ file/.test(document.querySelector("#s3-status").textContent), null, { timeout: 5000 })
    .catch(async () => fail("search status: " + (await status()) + " | files " + (await files()).length + " | " + JSON.stringify(await lists())));
  const found = await files();
  if (!found.length || found.some((k) => !/^archive\/2026\/page-12/.test(k))) fail("search results: " + JSON.stringify(found.slice(0, 5)) + " status " + (await status()) + " lists " + JSON.stringify(await lists()));
  if (!found.includes("archive/2026/page-1203.json")) fail("a name beyond the loaded pages was not found");
  const l3 = await lists();
  if (JSON.stringify(l3) !== JSON.stringify(["archive/2026/page-12"])) fail("search request: " + JSON.stringify(l3));
  if ((await pg.inputValue("#s3-objects input.filter")) !== "page-12") fail("the filter lost the search text");

  // 4. Clear the search: the folder's first page again; and in a folder listed whole, no search button.
  await pg.click("#s3-objects button:has-text('Clear the search')");
  // (at least the first page: the page is scrolled down, so the next one may load by itself at once)
  await pg.waitForFunction(() => document.querySelectorAll("#s3-list tr.file").length >= 500 && !/names starting/.test(document.querySelector("#s3-status").textContent), null, { timeout: 5000 })
    .catch(async () => fail("after Clear: " + (await files()).length + " files, status " + (await status())));
  await pg.click("#s3-objects .crumbs button >> nth=0");
  await pg.waitForSelector("#s3-list >> text=index.html");
  await pg.fill("#s3-objects input.filter", "ind");
  if (!(await pg.$("#s3-objects button.s3-search[hidden]"))) fail("search offered for a folder listed whole");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 paging: 1203 keys load by scrolling, each page once even with a click; search in S3 by name start finds keys beyond the loaded pages; clear returns)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message, (e.stack.match(/paging.e2e.cjs:\d+/) || [""])[0]); process.exit(1); });
