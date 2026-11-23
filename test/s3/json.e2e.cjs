// The S3 browser's JSON view: large lists and objects show a page at a time, deep large values start folded and
// are built only when opened, every bracket folds by mouse or keyboard, and the text on the page stays valid JSON.
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
  // Show a value in a test box with the browser's own jsonView (the box is emptied and reused).
  const put = (v) => pg.evaluate((v) => {
    let box = document.getElementById("json-test");
    if (!box) { box = document.createElement("div"); box.id = "json-test"; document.body.prepend(box); }
    box.textContent = "";
    const t0 = performance.now(); box.appendChild(window.S3Browser.jsonView(v));
    return { ms: performance.now() - t0, nodes: box.querySelectorAll("*").length };
  }, v);
  const textValue = () => pg.evaluate(() => JSON.parse(document.querySelector("#json-test pre").textContent));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // 1. A list of 450: 200 at a time, then the rest; the text is valid JSON at every step and equal at the end.
  const list = Array.from({ length: 450 }, (_, i) => ({ i, path: "/p/" + i }));
  await put(list);
  if ((await pg.$$("#json-test .j-num")).length !== 200) fail("first page is not 200 items");
  await pg.click("#json-test button.j-more:has-text('Show 200 more of 250')");
  await pg.click("#json-test button.j-more:has-text('Show 50 more of 50')");
  if (await pg.$("#json-test button.j-more")) fail("a Show more button is left");
  if (!same(await textValue(), list)) fail("the paged text is not the JSON");

  // 2. Deep and large: c (three levels down, 60 items) starts folded, built only when opened.
  const deep = { a: { b: { c: Array.from({ length: 60 }, (_, i) => i), d: [1, 2] } }, "x <img src=x onerror=alert(1)>": "<script>alert(1)</script>" };
  await put(deep);
  if ((await pg.textContent("#json-test pre")).indexOf('"c": [ 60 items ]') < 0) fail("c is not shown folded with its count");
  if ((await pg.$$("#json-test .j-num")).length !== 2) fail("the folded list was built before it was opened");
  await pg.click('#json-test button.j-fold[title="Unfold 60 items"]');
  if ((await pg.$$("#json-test .j-num")).length !== 62) fail("opening c did not build it");
  if (!same(await textValue(), deep)) fail("the opened text is not the JSON");
  if (await pg.$("#json-test img, #json-test script")) fail("a string became markup");

  // 3. Fold by keyboard: Enter on a's bracket folds it; again unfolds it, the same text as before.
  await pg.focus('#json-test button.j-fold[title="Fold 1 key"]'); await pg.keyboard.press("Enter");
  if ((await pg.getAttribute('#json-test button.j-fold[title="Unfold 1 key"]', "aria-expanded")) !== "false") fail("Enter did not fold");
  // What the user sees (innerText skips the folded, hidden part).
  if ((await pg.innerText("#json-test pre")).indexOf('"a": { 1 key }') < 0) fail("folded a does not read { 1 key }: " + (await pg.innerText("#json-test pre")));
  await pg.keyboard.press("Enter");
  if (!same(await textValue(), deep)) fail("unfolded text differs");

  // 4. Big: 100,000 rows render one page, quickly, with a bounded number of nodes.
  const r = await pg.evaluate(() => {
    const box = document.getElementById("json-test"); box.textContent = "";
    const big = Array.from({ length: 100000 }, (_, i) => ({ i }));
    const t0 = performance.now(); box.appendChild(window.S3Browser.jsonView(big));
    return { ms: performance.now() - t0, nodes: box.querySelectorAll("*").length };
  });
  if (r.nodes > 2000) fail("100,000 rows built " + r.nodes + " nodes");
  if (r.ms > 1000) fail("100,000 rows took " + Math.round(r.ms) + " ms");
  if (!(await pg.textContent("#json-test button.j-more")).includes("of 99800")) fail("the count of what is left");

  // 5. In the browser: a JSON Lines log from the twin is shown with brackets that fold.
  await pg.evaluate(() => { document.getElementById("json-test").textContent = ""; });
  await pg.click("#tab-s3");
  await pg.click("#s3-buckets button:has-text('demo-cloudfront-logs')");
  for (const f of ["cloudfront/", "2026/", "11/", "21/", "10/"]) await pg.click(`#s3-list >> text=${f}`);
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("#s3-file pre.json button.j-fold");
  if (!(await pg.textContent("#s3-file pre.json")).includes("cs_uri_stem")) fail("log rows not shown");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log(`OK (s3 json: pages of 200, deep large values folded and built on open, keyboard folding, text stays JSON; 100,000 rows in ${Math.round(r.ms)} ms, ${r.nodes} nodes)`);
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
