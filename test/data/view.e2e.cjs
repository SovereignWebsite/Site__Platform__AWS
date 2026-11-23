// The log view (site/data/view.js) in Chromium on the twin's logs, all three packs: headline, gaps, vault
// cards, link mode with provenance, and that hostile log values stay text. Fails if a request leaves the page.
const { chromium } = require("playwright");
const path = require("path");
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
(async () => {
  const browser = await chromium.launch();
  const url = "file://" + path.resolve(__dirname, "view.fixture.html");
  for (const pack of ["baseline", "attack", "surge"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { if (!r.url().startsWith("file://")) fail(pack + ": a request left the page: " + r.url()); });
    await page.goto(url + "?pack=" + pack);
    await page.waitForFunction(() => window.viewResult, null, { timeout: 20000 });
    if (errors.length) fail(pack + ": " + errors.join("; "));
    const res = await page.evaluate(() => window.viewResult);
    const head = await page.textContent(".log-headline");
    if (pack === "baseline" && head !== "225 requests over 9 hours, 20 Nov to 22 Nov; 35 failed (all /favicon.ico); 2 vaults used; 2 gaps in the hours.") fail("baseline headline: " + head);
    if (!head.startsWith(res.requests + " requests over 9 hours")) fail(pack + " headline: " + head);
    if ((await page.$$(".log-gap")).length !== 2) fail(pack + ": two gaps expected");
    if ((await page.$$(".log-vault")).length !== 2) fail(pack + ": two vault cards expected");
    if (!/Nothing was written anywhere/.test(await page.textContent(".log-note"))) fail(pack + ": note");
    // link mode: a vault's lines, each with its file and line
    await page.click('.log-vault button[data-value="vault-demo-001"]');
    const n = await page.$$eval(".log-lines tr", (rs) => rs.length - 1);
    if (n !== Math.min(res.vault1, 500)) fail(pack + ": vault lines " + n + ", summary says " + res.vault1);
    const from = await page.textContent(".log-lines tr:nth-child(2) td:last-child");
    if (!/^demo-distribution-1-2026-11-\d\d-\d\d-00-00\.gz:\d+$/.test(from)) fail(pack + ": provenance '" + from + "'");
    // an hour bar is a link too
    await page.click('button[data-field="hour"]');
    if (!/where hour is 2026-11-20T09/.test(await page.textContent(".log-lines h4"))) fail(pack + ": hour link");
    // investigation mode: a vault refers to its entry in the vaults list and to data/vaults.json
    if (!res.siteKeys) fail(pack + ": the investigation context has no site keys");
    await page.click('.log-vault button[data-value="vault-demo-001"]');
    const refs = await page.textContent(".log-refs");
    if (!refs.includes("Vault vault-demo-001 (files 42, region eu-west-2)")) fail(pack + ": vault ref '" + refs + "'");
    if (!(await page.$$eval(".log-pivots div", (d) => d.length))) fail(pack + ": no pivots");
    // a path goes to its S3 object, and the open callback gets the bucket and key
    await page.click('.log-pivots button[data-field="path"]');
    await page.click('.log-refs button[data-ref="s3-object"]');
    let op = await page.evaluate(() => window.opened.slice(-1)[0]);
    if (!op || !/demo-site/.test(op.bucket) || op.key !== "vault/vault-demo-001/files" && op.key !== "data/vaults.json") fail(pack + ": open path " + JSON.stringify(op));
    // the trail leads back
    if (!/vault vault-demo-001 > path \/vault\/vault-demo-001\/files$/.test(await page.textContent(".log-trail"))) fail(pack + ": trail '" + (await page.textContent(".log-trail")) + "'");
    // provenance opens the log file at its line
    await page.click('.log-lines button[data-ref="src"]');
    op = await page.evaluate(() => window.opened.slice(-1)[0]);
    if (!op || !/cloudfront-logs/.test(op.bucket) || !/\.gz$/.test(op.key) || !op.line) fail(pack + ": open src " + JSON.stringify(op));
    // "/" is the site's index.html
    await page.click('button[data-field="path"][data-value="/"]');
    if (!(await page.textContent(".log-refs")).includes("/index.html")) fail(pack + ": / should refer to index.html");
    const refusedCards = await page.$$(".log-vault-refused");
    if (pack === "attack" ? refusedCards.length < 1 : refusedCards.length !== 0) fail(pack + ": refused line on vault cards " + refusedCards.length);
    if (!/^\d+ served to \d+ clients?$/.test(await page.textContent(".log-vault-ok"))) fail(pack + ": served line");
    // the time window: drag across 22 Nov 09 to 11, everything recomputes for those hours
    const bar = (h) => page.locator('button.log-hour[data-value="' + h + '"]');
    await bar("2026-11-22T09").scrollIntoViewIfNeeded();
    const b1 = await bar("2026-11-22T09").boundingBox(), b3 = await bar("2026-11-22T11").boundingBox();
    await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height - 2); await page.mouse.down();
    await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height - 2); await page.mouse.up();
    const inWin = await page.evaluate(() => window.allRecords.filter((r) => r.hour >= "2026-11-22T09" && r.hour <= "2026-11-22T11").length);
    let headW = await page.textContent(".log-headline");
    if (!headW.startsWith("Window 2026-11-22 09:00 to 2026-11-22 11:59 UTC: " + inWin + " requests over 3 hours")) fail(pack + ": window headline '" + headW + "'");
    if (!(await page.textContent(".log-window-label")).endsWith(inWin + " lines")) fail(pack + ": window label");
    if (await page.$eval('button[data-field="hour"][data-value="2026-11-20T09"]', (b) => b.style.opacity) !== "0.3") fail(pack + ": hours outside the window not dimmed");
    // drill-down stays inside the window
    await page.click('.log-vault button[data-value="vault-demo-001"]');
    const vWin = await page.evaluate(() => window.allRecords.filter((r) => r.hour >= "2026-11-22T09" && r.vault === "vault-demo-001").length);
    if (await page.$$eval(".log-lines tr", (rs) => rs.length - 1) !== Math.min(vWin, 500)) fail(pack + ": vault lines in the window");
    // step back an hour keeps the width: 21 Nov 11 to 22 Nov 10 (the night's gap is stepped over)
    await page.click('button[data-window="back"]');
    if (!(await page.textContent(".log-window-label")).startsWith("2026-11-21 11:00 to 2026-11-22 10:59 UTC")) fail(pack + ": step back '" + (await page.textContent(".log-window-label")) + "'");
    // play from the start runs to the last hour and stops
    await page.click('button[data-window="all"]');
    if (await page.textContent(".log-window-label") !== "All hours" || !(await page.textContent(".log-headline")).startsWith(res.requests + " requests")) fail(pack + ": All");
    await page.click('button[data-window="play"]');
    await page.waitForFunction(() => document.querySelector('button[data-window="play"]').textContent === "Play", null, { timeout: 10000 });
    if (!(await page.textContent(".log-window-label")).startsWith("2026-11-22 11:00 to 2026-11-22 11:59 UTC")) fail(pack + ": play did not reach the last hour");
    if (pack === "attack") {
      // the attack grows hour by hour: refused lines on vault-demo-001 only in the last window
      const refusedLast = await page.$$(".log-vault-refused");
      if (refusedLast.length < 1) fail("attack: refused probes in the last hour");
      await page.click('button[data-window="all"]');
      // follow the attacker: client > its paths; traversal is not a resource
      await page.evaluate(() => { const b = [...document.querySelectorAll('button[data-field="client"]')].find((x) => x.dataset.value === "203.0.113.66"); b && b.click(); });
      const pv = await page.textContent(".log-pivots");
      if (!pv.includes("/.env") || !pv.includes("bot")) fail("attack: pivots of the attacker '" + pv.slice(0, 200) + "'");
      await page.evaluate(() => { const b = [...document.querySelectorAll('button[data-field="path"]')].find((x) => x.dataset.value === "/vault/../../etc/passwd"); b && b.click(); });
      if (!(await page.textContent(".log-refs")).includes("Not a resource")) fail("attack: traversal should not resolve");
      await page.click('button[data-field="agent_kind"][data-value="bot"]');
      const bots = await page.$$eval(".log-lines tr", (rs) => rs.length - 1);
      if (bots < 15) fail("attack: bot lines " + bots);
      if (!(await page.textContent(".log-lines")).includes("/vault/../../etc/passwd")) fail("attack: traversal line not shown as text");
    }
    if (pack === "baseline" && process.argv[2]) await page.screenshot({ path: process.argv[2], fullPage: true });
    await page.close();
  }
  // hostile values stay text
  const page = await browser.newPage();
  await page.goto(url + "?pack=baseline");
  await page.waitForFunction(() => window.viewResult);
  const injected = await page.evaluate(() => {
    const evil = '<img src=x onerror="window.pwned=1">';
    const recs = [{ raw: { timestamp: "2026-11-21T10:00:00Z", c_ip: evil, cs_method: "GET", cs_uri_stem: "/vault/" + evil + "/files", sc_status: 200, sc_bytes: 1, time_taken: 0.001, x_edge_location: evil, cs_user_agent: evil }, src: { key: evil, line: 1 } }]
      .map(LogExtract.normalise);
    recs.forEach((r) => { r.status_class = "2xx"; });
    const s = LogExtract.summarise(recs); s.clients_top = [{ key: evil, requests: 1, errors: 0 }];
    LogView.render(document.getElementById("box"), { discover: LogExtract.discover([]), summary: s, records: recs, read: { files: 1, bytes: 1, skipped: [{ src: { key: evil, line: 2 }, why: evil }] } });
    document.querySelector(".log-vault button").click();
    return { imgs: document.querySelectorAll("#box img").length, text: document.getElementById("box").textContent.includes(evil) };
  });
  // R-014 and R-015 in the page: a failing file, a gzip bomb and a __proto__ vault do not stop the run
  const run = await page.evaluate(async () => {
    const enc = (t) => new Response(new Blob([t]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer().then((b) => new Uint8Array(b));
    const good = await enc('{"timestamp":"2026-11-21T10:00:00Z","c_ip":"203.0.113.5","cs_uri_stem":"/vault/__proto__/files","sc_status":200,"sc_bytes":5}\n');
    const bomb = await enc("x".repeat(3 * 1048576));
    const files = { "l/2026/11/21/10/a.gz": good, "l/2026/11/21/11/b.gz": "throw", "l/2026/11/21/12/c.gz": bomb };
    const box = document.createElement("div"); document.body.appendChild(box);
    const res = await LogView.run(box, Object.keys(files).map((k) => ({ Key: k, Size: 1 })), (k) => files[k] === "throw" ? Promise.reject(new Error("refused")) : Promise.resolve(files[k]), { maxUnzipped: 1048576 });
    return { requests: res.summary.requests, vault: res.summary.vaults[0] && res.summary.vaults[0].key, skipped: res.read.skipped.map((x) => x.why), proto: Object.prototype.requests, note: box.querySelector(".log-note").textContent };
  });
  if (run.requests !== 1 || run.vault !== "__proto__" || run.proto !== undefined) fail("hostile run " + JSON.stringify(run));
  if (!run.skipped.some((w) => /refused/.test(w)) || !run.skipped.some((w) => /more than 1 MB/.test(w))) fail("skips not recorded " + JSON.stringify(run.skipped));
  await page.waitForTimeout(200);
  if (injected.imgs !== 0 || await page.evaluate(() => window.pwned)) fail("a log value was rendered as HTML");
  if (!injected.text) fail("hostile value not shown as text");
  await browser.close();
  console.log("ok: log view on 3 packs (headline, gaps, vault cards, link mode with provenance, investigation: refs, pivots, trail, open; time window: drag, step, play) hostile values stay text, __proto__ keys and gzip bombs handled");
})().catch((e) => fail(e.stack || e));
