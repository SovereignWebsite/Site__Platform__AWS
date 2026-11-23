// The S3 browser's readers for log formats: CloudFront standard logs (#Version / #Fields, tab-separated), CloudFront
// real-time logs (tabs, no header), CSV with quotes, and Firehose records written back to back with no delimiter.
// Each is read by the browser's own show() (S3Browser.view) inside the twin page, then one gzip of each runs the
// real path through the S3 browser's preview reader.
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

// Fixtures, in the formats AWS documents (CloudFront standard log fields; Firehose with no record delimiter).
const fields = "date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(Referer) cs(User-Agent)";
const standard = "#Version: 1.0\n#Fields: " + fields + "\n" +
  ["2026-11-21\t10:00:01\tLHR62-C2\t2310\t192.0.2.10\tGET\td111111abcdef8.cloudfront.net\t/index.html\t200\t-\tMozilla/5.0",
   "2026-11-21\t10:00:02\tLHR62-C2\t512\t198.51.100.7\tGET\td111111abcdef8.cloudfront.net\t/<script>alert(1)</script>\t404\t-\tcurl/8.0"].join("\n") + "\n";
const realtime = Array.from({ length: 450 }, (_, i) => `1700000000.${String(i).padStart(3, "0")}\t192.0.2.${i % 250}\t200\tGET\t/p/${i}`).join("\n") + "\n";
const csv = 'name,note,size\n"a, b","say ""hi""",10\nc,"two\nlines",20\n';
const firehose = '{"id":1,"msg":"a } brace in a string"}{"id":2,"nested":{"x":[1,2]}}\n{"id":3}';

(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/?twin`);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  // Show one file in a test box with the browser's own reader; return what a user would see.
  const view = (name, text, type) => pg.evaluate(([name, text, type]) => {
    let box = document.getElementById("fmt-test");
    if (!box) { box = document.createElement("div"); box.id = "fmt-test"; document.body.prepend(box); }
    box.textContent = "";
    const v = window.S3Browser.view(name, type, new TextEncoder().encode(text));
    box.appendChild(v.status); box.appendChild(v.box);
    const t = box.querySelector("table");
    return {
      status: v.status.textContent,
      head: t ? [...t.querySelectorAll("thead th")].map((th) => th.textContent) : null,
      rows: t ? [...t.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)) : null,
      json: box.querySelector("pre.json") ? box.querySelector("pre.json").textContent : null,
      markup: !!box.querySelector("table script, table img"),
    };
  }, [name, text, type || ""]);

  // 1. CloudFront standard log: the #Fields names are the columns; cells stay text.
  let r = await view("E2EXAMPLE.2026-11-21-10.abcd1234", standard);
  if (!/CloudFront log, 2 rows/.test(r.status)) fail("standard log status: " + r.status);
  if (r.head.join(" ") !== fields) fail("standard log columns: " + r.head.join(" "));
  if (r.rows[1][7] !== "/<script>alert(1)</script>" || r.markup) fail("a log cell became markup");
  if (r.rows[0][8] !== "200") fail("standard log cell");

  // 2. Real-time log (tabs, no header): numbered columns, 200 rows at a time, Show as text and back.
  r = await view("realtime-2026-11-21-10", realtime);
  if (!/tab-separated, 450 rows/.test(r.status)) fail("real-time status: " + r.status);
  if (r.head.join(",") !== "1,2,3,4,5" || r.rows.length !== 200) fail("real-time first page: " + r.head + " " + r.rows.length);
  await pg.click("#fmt-test button:has-text('Show 200 more of 250')");
  await pg.click("#fmt-test button:has-text('Show 50 more of 50')");
  if ((await pg.$$("#fmt-test tbody tr")).length !== 450) fail("real-time all rows");
  if (await pg.isVisible("#fmt-test button:has-text('more of')")) fail("Show more left after the last page");
  await pg.click("#fmt-test button:has-text('Show as text')");
  if (!(await pg.isVisible("#fmt-test pre")) || (await pg.isVisible("#fmt-test table"))) fail("Show as text");
  if ((await pg.textContent("#fmt-test pre")) !== realtime) fail("the text view is not the file");
  await pg.click("#fmt-test button:has-text('Show as a table')");
  if (!(await pg.isVisible("#fmt-test table"))) fail("Show as a table");

  // 3. CSV with quoted commas, doubled quotes and a line break inside quotes.
  r = await view("report.csv", csv);
  if (!/CSV, 2 rows/.test(r.status)) fail("csv status: " + r.status);
  if (JSON.stringify(r.rows) !== JSON.stringify([["a, b", 'say "hi"', "10"], ["c", "two\nlines", "20"]])) fail("csv cells: " + JSON.stringify(r.rows));

  // 4. Firehose with no delimiter: three records, one with a brace inside a string.
  r = await view("stream-1-2026-11-21-10-00-00-abcd", firehose);
  if (!/3 JSON records back to back/.test(r.status)) fail("firehose status: " + r.status);
  if (JSON.stringify(JSON.parse(r.json)) !== JSON.stringify([{ id: 1, msg: "a } brace in a string" }, { id: 2, nested: { x: [1, 2] } }, { id: 3 }])) fail("firehose records");

  // 5. Not tables: code with tabs, a single JSON object, broken JSON, plain prose.
  r = await view("Makefile", "all:\tbuild\ttest\nbuild:\tdeps\tsrc\n"); if (r.head) fail("a Makefile became a table");
  r = await view("a.json", '{"a":1}'); if (!/JSON, formatted/.test(r.status)) fail("one JSON object: " + r.status);
  r = await view("broken", '{"a":1}{"b":'); if (r.json || r.head) fail("broken JSON was read as records");
  r = await view("notes.txt", "hello\nworld\n"); if (r.head || r.json) fail("prose became a table or JSON");

  // 6. The real path: a gzip of the standard log in an S3 object, opened in the browser (twin) as a table.
  await pg.evaluate((text) => {
    const h = window.AwsTwin.handle;
    window.AwsTwin.handle = (url, init) => {
      if (/\/cloudfront\/2026\/11\/21\/10\/[^/?]+\.gz$/.test(new URL(url).pathname)) {
        const gz = new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")));
        return gz.arrayBuffer().then((b) => new Response(b, { status: 200, headers: { "content-type": "application/octet-stream" } }));
      }
      return h(url, init);
    };
  }, standard);
  await pg.evaluate(() => { document.getElementById("fmt-test").textContent = ""; });
  await pg.click("#tab-s3");
  await pg.click("#s3-buckets button:has-text('demo-cloudfront-logs')");
  for (const f of ["cloudfront/", "2026/", "11/", "21/", "10/"]) await pg.click(`#s3-list >> text=${f}`);
  await pg.click("#s3-list button:has-text('.gz')");
  await pg.waitForSelector("#s3-file table.data-table");
  if (!/CloudFront log, 2 rows/.test(await pg.textContent("#s3-status"))) fail("the S3 browser did not read the .gz log as a table");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 formats: CloudFront standard and real-time logs as tables, CSV with quotes, Firehose records back to back; code and prose untouched)");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
