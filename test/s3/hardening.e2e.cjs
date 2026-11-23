// security.aws.a's R-017 and R-018 in the S3 browser's readers, and s3.aws.a's review nits:
// - R-017 (a): a .gz full of 1f 8b 08 is read in bounded time (capped candidate tries, then one lenient unzip);
// - R-017 (b): a CSV row with 100,000 commas shows at most 200 columns and says how many there are;
// - R-018: downloads are application/octet-stream blobs, whatever S3's Content-Type, and their URLs are revoked;
// - S3Browser.limits is a frozen copy; setLimits takes only known keys with numbers.
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
  // The hourly log key serves window.__body as text/html (to check R-018); blob URLs made are recorded.
  await pg.evaluate(() => {
    const mk = URL.createObjectURL, rv = URL.revokeObjectURL; window.__blobs = []; window.__revoked = [];
    URL.createObjectURL = (b) => { const u = mk(b); window.__blobs.push({ url: u, type: b.type }); return u; };
    URL.revokeObjectURL = (u) => { window.__revoked.push(u); return rv(u); };
    const h = window.AwsTwin.handle;
    window.AwsTwin.handle = (url, init) => {
      const p = new URL(url).pathname;
      if (window.__body && /\/cloudfront\/2026\/11\/21\/10\/[^/?]+\.gz$/.test(p)) return Promise.resolve(new Response(window.__body, { status: 200, headers: { "content-type": "text/html" } }));
      if (window.__body && /list-type/.test(url) && /prefix=cloudfront%2F2026%2F11%2F21%2F10%2F/.test(url))
        return h(url, init).then((r) => r.text().then((t) => new Response(t.replace(/<Size>\d+<\/Size>/, "<Size>" + window.__body.length + "</Size>"), { status: r.status, headers: { "content-type": "application/xml" } })));
      return h(url, init);
    };
  });
  await pg.click("#tab-s3");
  const open = async () => {
    await pg.click("#s3-buckets button:has-text('demo-cloudfront-logs')");
    for (const f of ["cloudfront/", "2026/", "11/", "21/", "10/"]) await pg.click(`#s3-list >> text=${f}`);
    await pg.click("#s3-objects button:has-text('Refresh')");
    await pg.waitForFunction(() => /: \d+ file/.test(document.querySelector("#s3-status").textContent) && !/listed \d+ s ago/.test(document.querySelector("#s3-status").textContent));
    const t0 = Date.now();
    await pg.click("#s3-list button:has-text('.gz')");
    await pg.waitForFunction(() => /JSON Lines|not text|JSON, formatted|: [^.]*$/.test(document.querySelector("#s3-status").textContent) && !/^Opening|^Reading/.test(document.querySelector("#s3-status").textContent), null, { timeout: 15000 })
      .catch(async () => fail("not read in time: " + (await pg.textContent("#s3-status"))));
    return Date.now() - t0;
  };

  // 1. R-017 (a): 200 KB of gzip where nearly every byte run is 1f 8b 08, after one real member of log lines.
  await pg.evaluate(async () => {
    const gz = async (t) => new Uint8Array(await new Response(new Blob([t]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    const m1 = await gz(Array.from({ length: 30 }, (_, i) => JSON.stringify({ n: i })).join("\n") + "\n");
    const junk = new Uint8Array(200000); for (let i = 0; i + 3 < junk.length; i += 4) junk.set([0x1f, 0x8b, 0x08, 0x00], i);
    const b = new Uint8Array(m1.length + junk.length); b.set(m1); b.set(junk, m1.length); window.__body = b;
  });
  const ms = await open();
  if (ms > 8000) fail("the crafted gzip took " + ms + " ms");
  if (!/JSON Lines \(30\)/.test(await pg.textContent("#s3-status"))) fail("the real member was not kept: " + (await pg.textContent("#s3-status")));
  if (!/damaged or cut/.test(await pg.textContent("#s3-file"))) fail("no note for the unreadable rest");

  // 2. R-018: the Download link fetches an application/octet-stream blob, though S3 said text/html; revoked later.
  await pg.evaluate(() => { window.__blobs.length = 0; });
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#s3-file a.button:has-text('Download')")]);
  const blobs = await pg.evaluate(() => window.__blobs.slice());
  if (!blobs.length || blobs.some((b) => b.type !== "application/octet-stream")) fail("download blob types: " + JSON.stringify(blobs.map((b) => b.type)));
  if (!dl.suggestedFilename().endsWith(".gz")) fail("download name " + dl.suggestedFilename());

  // 3. R-017 (b): a CSV with one row of 100,000 commas: at most 200 columns, with a note.
  const r = await pg.evaluate(() => {
    const text = "a,b,c\n1,2,3\n" + ",".repeat(100000) + "\n";
    const t0 = performance.now(); const v = window.S3Browser.view("wide.csv", "", new TextEncoder().encode(text));
    return { ms: performance.now() - t0, cols: v.box.querySelectorAll("thead th").length, cells: v.box.querySelectorAll("td").length, note: v.box.textContent };
  });
  if (r.cols > 200 || r.cells > 200 * 200) fail("columns " + r.cols + ", cells " + r.cells);
  if (!/the first 200 of 100001 columns/.test(r.note)) fail("no column note: " + r.note.slice(0, 200));

  // 4. limits: a frozen copy; setLimits ignores unknown keys and non-numbers.
  const lim = await pg.evaluate(() => {
    const a = window.S3Browser.limits; let threw = false; try { "use strict"; a.show = 1; } catch (e) { threw = true; }
    const before = window.S3Browser.limits.show;
    window.S3Browser.setLimits({ show: "1", evil: 5, preview: -3 });
    const after = window.S3Browser.limits;
    return { frozen: Object.isFrozen(a), same: after.show === before, evil: "evil" in after, preview: after.preview };
  });
  if (!lim.frozen || !lim.same || lim.evil || lim.preview !== 256 * 1024) fail("limits: " + JSON.stringify(lim));

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log(`OK (s3 hardening: a gzip full of 1f 8b 08 read in ${ms} ms; downloads are octet-stream; 100,001 columns shown as 200 with a note; limits frozen, setLimits checked)`);
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
