// Sherpa walk 3, finding 5 (W3-5): the attack sits in one JSON Lines log with nothing pointing at it. A line filter in
// the viewer keeps the lines that contain what is typed (any case) and says how many match; it works on JSON Lines
// (the twin's attack pack), text files and tables, and clearing it brings the whole file back.
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
  const typeIn = async (sel, text) => { await pg.fill(sel, text); await pg.waitForTimeout(300); };

  // 1. The attack pack's log of 22 Nov: filter for the scanner's address.
  await Promise.all([pg.waitForNavigation(), pg.selectOption("#twin-pack", "attack")]);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.click("#twin-pack-see");
  await pg.waitForSelector("#s3-list button:has-text('.gz')");
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("text=JSON Lines");
  const total = +(/JSON Lines \((\d+)\)/.exec(await pg.textContent("#s3-status")) || [])[1];
  if (!(total > 10)) fail("the attack log has " + total + " lines");
  await typeIn("#s3-file input.line-filter", "203.0.113.66");
  const count = await pg.textContent("#s3-file .line-count");
  const m = /^(\d+) of (\d+) lines match$/.exec(count);
  if (!m || +m[2] !== total || !(+m[1] > 0) || !(+m[1] < total)) fail("count: " + count);
  const shown = await pg.textContent("#s3-file pre.json");
  if (!/sqlmap|Nuclei/.test(shown)) fail("the scanner's lines are not shown");
  const kept = JSON.parse(shown);
  if (kept.length !== +m[1] || kept.some((r) => JSON.stringify(r).indexOf("203.0.113.66") < 0)) fail("a line without the address is shown");

  // Case does not matter; no match says so; clearing brings every line back.
  await typeIn("#s3-file input.line-filter", "SQLMAP");
  if (!/^\d+ of \d+ lines match$/.test(await pg.textContent("#s3-file .line-count")) || !/sqlmap/i.test(await pg.textContent("#s3-file pre.json"))) fail("case-insensitive filter");
  await typeIn("#s3-file input.line-filter", "no-such-thing-xyz");
  if (!/No lines match/.test(await pg.textContent("#s3-file"))) fail("no-match message");
  await typeIn("#s3-file input.line-filter", "");
  if (JSON.parse(await pg.textContent("#s3-file pre.json")).length !== total) fail("clearing did not bring every line back");

  // 2. Text and tables, through the browser's own reader (S3Browser.view).
  const r = await pg.evaluate(async () => {
    const wait = () => new Promise((ok) => setTimeout(ok, 300));
    const box = document.createElement("div"); document.body.prepend(box);
    const t = window.S3Browser.view("app.log", "", new TextEncoder().encode("start\nERROR disk full\nok\nerror: retry\nok\n"));
    box.appendChild(t.box);
    const tf = box.querySelector("input.line-filter"); tf.value = "error"; tf.dispatchEvent(new Event("input")); await wait();
    const text = { pre: box.querySelector("pre").textContent, count: box.querySelector(".line-count").textContent };
    box.textContent = "";
    const csv = "ip,path,status\n192.0.2.1,/a,200\n198.51.100.7,/admin,403\n192.0.2.1,/b,200\n198.51.100.7,/wp-login.php,404\n";
    const v = window.S3Browser.view("access.csv", "", new TextEncoder().encode(csv));
    box.appendChild(v.box);
    const f = box.querySelector("input.line-filter"); f.value = "198.51.100.7"; f.dispatchEvent(new Event("input")); await wait();
    const table = { rows: [...box.querySelectorAll("tbody tr")].map((tr) => tr.children[1].textContent), count: box.querySelector(".line-count").textContent };
    f.value = ""; f.dispatchEvent(new Event("input")); await wait();
    table.after = box.querySelectorAll("tbody tr").length;
    box.remove();
    return { text, table };
  });
  if (r.text.pre !== "ERROR disk full\nerror: retry" || r.text.count !== "2 of 6 lines match") fail("text filter: " + JSON.stringify(r.text));
  if (JSON.stringify(r.table.rows) !== JSON.stringify(["/admin", "/wp-login.php"]) || r.table.count !== "2 of 4 rows match" || r.table.after !== 4) fail("table filter: " + JSON.stringify(r.table));

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log(`OK (s3 line filter: the attack pack's scanner found in ${m[1]} of ${total} log lines; any case; no match said; clear restores; text and tables too)`);
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
