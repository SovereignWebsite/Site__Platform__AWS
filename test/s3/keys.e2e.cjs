// The S3 browser by keyboard alone, against the twin (first note, item 13): Up, Down, Home and End move between
// rows; Enter opens; Backspace goes up a level (file to folder, folder to parent) with the focus on the crumbs;
// "/" moves to the filter, where typing is never taken over; Escape clears the filter.
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
const focused = (pg) => pg.evaluate(() => { const a = document.activeElement; return a ? (a.closest(".crumbs") ? "crumbs:" : a.classList.contains("filter") ? "filter:" : "") + a.textContent.trim() : ""; });
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/?twin`);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  const { deps, logs } = await pg.evaluate(() => window.AwsTwin.buckets);
  // a folder with several rows: the days of November in the CloudFront logs
  await pg.evaluate((b) => { location.hash = "#/s3/" + b + "/cloudfront/2026/11/"; }, logs);
  await pg.waitForSelector("#s3-list button");
  const rows = await pg.$$eval("#s3-list button", (b) => b.map((x) => x.textContent.trim()));
  if (rows.length < 2) fail("need two rows in the twin's dependencies bucket, got " + rows.length);

  // 1. Up, Down, Home and End move between rows.
  await pg.focus("#s3-list button");
  await pg.keyboard.press("ArrowDown");
  if (await focused(pg) !== rows[1]) fail("ArrowDown: " + await focused(pg));
  await pg.keyboard.press("ArrowUp");
  if (await focused(pg) !== rows[0]) fail("ArrowUp: " + await focused(pg));
  await pg.keyboard.press("End");
  if (await focused(pg) !== rows[rows.length - 1]) fail("End: " + await focused(pg));
  await pg.keyboard.press("Home");
  if (await focused(pg) !== rows[0]) fail("Home: " + await focused(pg));

  await pg.click("#tab-s3");
  await pg.click(`#s3-buckets button:has-text('${deps}')`);
  await pg.waitForSelector("#s3-list >> text=lambdas-dependencies/");
  // 2. Enter opens a folder; Backspace goes back up and the focus is on the crumbs.
  await pg.focus("#s3-list >> text=lambdas-dependencies/");
  await pg.keyboard.press("Enter");
  await pg.waitForSelector("#s3-list button:has-text('.zip')");
  await pg.focus("#s3-list button:has-text('.zip')");
  await pg.keyboard.press("Enter");
  await pg.waitForSelector("#s3-file >> text=demo_handler/handler.py");
  // 3. Backspace from a file closes it (the folder stays), then from the folder goes to the bucket's top.
  await pg.focus("#s3-list button:has-text('.zip')");
  await pg.keyboard.press("Backspace");
  await pg.waitForFunction(() => !document.querySelector("#s3-file").textContent.trim());
  if (!(await pg.evaluate(() => location.hash)).endsWith("/lambdas-dependencies/")) fail("Backspace from a file: " + await pg.evaluate(() => location.hash));
  if (!(await focused(pg)).startsWith("crumbs:")) fail("focus after closing the file: " + await focused(pg));
  await pg.keyboard.press("Backspace");
  await pg.waitForSelector("#s3-list >> text=lambdas-dependencies/");
  if (await pg.evaluate(() => location.hash) !== `#/s3/${deps}/`) fail("Backspace from a folder: " + await pg.evaluate(() => location.hash));
  if (!(await focused(pg)).startsWith("crumbs:")) fail("focus after going up: " + await focused(pg));

  // 4. "/" moves to the filter; typing filters (Backspace there edits the text); Escape clears it.
  await pg.keyboard.press("/");
  if (!(await focused(pg)).startsWith("filter:")) fail("/ did not focus the filter: " + await focused(pg));
  await pg.keyboard.type("lambdasx");
  await pg.keyboard.press("Backspace");
  if (await pg.inputValue("#s3-objects .filter") !== "lambdas") fail("Backspace in the filter was taken over");
  if (await pg.$$eval("#s3-list tr:not([hidden])", (r) => r.length) !== 1) fail("filter did not narrow the rows");
  await pg.keyboard.press("Escape");
  if (await pg.inputValue("#s3-objects .filter") !== "") fail("Escape did not clear the filter");
  if (await pg.$$eval("#s3-list tr[hidden]", (r) => r.length)) fail("rows still hidden after Escape");

  // 5. The bucket chips are one Tab stop; arrows move between them; Enter opens the bucket and the focus moves to
  // its crumbs, so Tab does not walk every other bucket first (sherpa walk 5).
  const stops = await pg.$$eval("#s3-buckets button", (b) => b.filter((x) => x.tabIndex === 0).length);
  if (stops !== 1) fail("bucket chips in the Tab order: " + stops);
  const chips = await pg.$$eval("#s3-buckets button", (b) => b.map((x) => x.textContent));
  await pg.focus("#s3-buckets button[tabindex='0']");
  const from = await focused(pg), i0 = chips.indexOf(from);
  await pg.keyboard.press("ArrowRight");
  if (await focused(pg) !== chips[(i0 + 1) % chips.length]) fail("ArrowRight on the chips: " + await focused(pg));
  await pg.keyboard.press("Home");
  if (await focused(pg) !== chips[0]) fail("Home on the chips: " + await focused(pg));
  const target = chips.find((c) => c === deps) ? deps : chips[0];
  await pg.focus(`#s3-buckets button:has-text('${target}')`);
  await pg.keyboard.press("Enter");
  await pg.waitForSelector("#s3-list button");
  await pg.waitForFunction(() => document.activeElement && document.activeElement.closest(".crumbs"));
  if (await pg.$$eval("#s3-buckets button", (b) => b.filter((x) => x.tabIndex === 0).map((x) => x.textContent).join()) !== target) fail("the opened bucket is not the chips' Tab stop");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 keyboard: arrows, Home, End, Enter, Backspace up a level with focus on the crumbs, / to filter, Escape clears; bucket chips one Tab stop, Enter moves on to the crumbs)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
