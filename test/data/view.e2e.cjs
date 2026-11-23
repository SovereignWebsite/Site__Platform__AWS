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
    if (pack === "attack") {
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
  await page.waitForTimeout(200);
  if (injected.imgs !== 0 || await page.evaluate(() => window.pwned)) fail("a log value was rendered as HTML");
  if (!injected.text) fail("hostile value not shown as text");
  await browser.close();
  console.log("ok: log view on 3 packs (headline, gaps, vault cards, link mode with provenance) and hostile values stay text");
})().catch((e) => fail(e.stack || e));
