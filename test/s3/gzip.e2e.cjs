// Item 7: gzip files of several members back to back (what appending to a .gz gives, and what some log writers do).
// A browser's DecompressionStream stops with an error at the second member; the S3 browser reads every member, does
// not split on a 1f 8b 08 that is only inside compressed data, keeps the members read before a cut preview's end,
// and says when a file is damaged. The twin serves each case as its hourly CloudFront log.
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
  // window.__case(name) builds the bytes for a case; the twin serves window.__body for the log key, with its size.
  await pg.evaluate(() => {
    const gz = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let at = 0; a.forEach((x) => { o.set(x, at); at += x.length; }); return o; };
    const lines = (from, n) => new TextEncoder().encode(Array.from({ length: n }, (_, i) => JSON.stringify({ n: from + i, cs_uri_stem: "/p/" + (from + i) })).join("\n") + "\n");
    window.__case = async (name) => {
      if (name === "three") return cat(await gz(lines(0, 40)), await gz(lines(40, 40)), await gz(lines(80, 40)));
      if (name === "false-magic") {
        // Random bytes compress to stored blocks, so a 1f 8b 08 put into them appears as-is inside member one.
        const r = new Uint8Array(70000); for (let i = 0; i < r.length; i += 65536) crypto.getRandomValues(r.subarray(i, i + 65536)); for (let i = 1000; i < 60000; i += 7000) r.set([0x1f, 0x8b, 0x08, 0x00], i);
        const m1 = await gz(r); let seen = 0; for (let i = 1; i + 2 < m1.length; i++) if (m1[i] === 0x1f && m1[i + 1] === 0x8b && m1[i + 2] === 8) seen++;
        window.__falseMagic = seen;
        return cat(m1, await gz(lines(0, 10)));
      }
      if (name === "big-members") return cat(await gz(lines(0, 50)), await gz(lines(50, 3000)));
      if (name === "cut") { const b = cat(await gz(lines(0, 40)), await gz(lines(40, 40))); return b.subarray(0, b.length - 30); }
    };
    const h = window.AwsTwin.handle;
    window.AwsTwin.handle = (url, init) => {
      const p = new URL(url).pathname;
      if (window.__body && /\/cloudfront\/2026\/11\/21\/10\/[^/?]+\.gz$/.test(p)) {
        const hd = (init && init.headers) || {}, m = /^bytes=(\d+)-(\d+)$/.exec(hd.Range || hd.range || "");
        const b = m ? window.__body.subarray(+m[1], +m[2] + 1) : window.__body;
        return Promise.resolve(new Response(b, { status: m ? 206 : 200, headers: { "content-type": "application/octet-stream" } }));
      }
      if (window.__body && /list-type/.test(url) && /prefix=cloudfront%2F2026%2F11%2F21%2F10%2F/.test(url))
        return h(url, init).then((r) => r.text().then((t) => new Response(t.replace(/<Size>\d+<\/Size>/, "<Size>" + window.__body.length + "</Size>"), { status: r.status, headers: { "content-type": "application/xml" } })));
      return h(url, init);
    };
  });
  await pg.click("#tab-s3");
  const open = async (name, limits) => {
    await pg.evaluate(async ([name, limits]) => { window.__body = await window.__case(name); Object.assign(window.S3Browser.limits, limits || { show: 5 * 1024 * 1024, preview: 256 * 1024 }); }, [name, limits]);
    await pg.click("#s3-buckets button:has-text('demo-cloudfront-logs')");
    for (const f of ["cloudfront/", "2026/", "11/", "21/", "10/"]) await pg.click(`#s3-list >> text=${f}`);
    // Each case changes the file under the same key, so list the folder from S3 again (the listing is cached).
    await pg.click("#s3-objects button:has-text('Refresh')");
    await pg.waitForFunction(() => /: \d+ file/.test(document.querySelector("#s3-status").textContent) && !/listed \d+ s ago/.test(document.querySelector("#s3-status").textContent));
    await pg.click("#s3-list button:has-text('.gz')");
    await pg.waitForFunction(() => /JSON Lines|not text|JSON, formatted/.test(document.querySelector("#s3-status").textContent), null, { timeout: 10000 })
      .catch(async () => fail(name + ": status " + (await pg.textContent("#s3-status"))));
    return { file: await pg.innerText("#s3-file"), status: await pg.textContent("#s3-status") };
  };

  // 1. Three members: all 120 lines, and a note that there were three.
  let r = await open("three");
  if (!/JSON Lines \(120\)/.test(r.status)) fail("three members: " + r.status);
  if (!/3 members back to back/.test(r.file) || /damaged/.test(r.file)) fail("three members note: " + r.file.slice(0, 300));

  // 2. A 1f 8b 08 inside member one's compressed bytes is not a member boundary.
  r = await open("false-magic");
  const seen = await pg.evaluate(() => window.__falseMagic);
  if (seen < 1) fail("the false-magic case has no 1f 8b 08 inside member one");
  if (!/2 members back to back/.test(r.file) || /damaged/.test(r.file)) fail("false magic (" + seen + " inside): " + r.file.slice(0, 300));

  // 3. Preview cut inside member two (member one is 50 lines): all of member one and the start of member two.
  r = await open("big-members", { show: 8000, preview: 6000 });
  const n = +(/JSON Lines \((\d+)\)/.exec(r.status) || [])[1];
  if (!/Preview: the first 5\.9 KB/.test(r.file) || !(n > 50)) fail("cut preview across members: " + r.status + " | " + r.file.slice(0, 200));

  // 4. A damaged file (cut 30 bytes short): the lines that came out are shown, with a note.
  r = await open("cut");
  if (!/damaged or cut/.test(r.file)) fail("damaged note: " + r.file.slice(0, 300));
  if (!/JSON Lines \((\d+)\)/.test(r.status) || +(/JSON Lines \((\d+)\)/.exec(r.status)[1]) < 40) fail("damaged: lines kept " + r.status);

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log(`OK (s3 gzip members: three members read, a 1f 8b 08 inside compressed data (${seen}x) not split on, a cut preview keeps whole members, damaged files say so; ${n} preview lines)`);
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
