// S3-4, "Connected to this bucket" (docs/s3/2026-11-23__s3-4-bucket-graph-plan.md): the panel's words, order and
// grouping over the golden twin graph (test/api/golden/twin-graph.json). Uses Graph.neighbours from site/api/graph.js
// when it has it (dev.2.aws.a's branch); until that lands, a one-hop stand-in in this test gives the same links for
// the first hop. Checks: ontology.aws.a's readings, AWS-confirmed lines first with no mark, claimed lines marked "?",
// more than three of a kind grouped with a count, S3 names open through the address, labels shown as text only.
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
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "api", "golden", "twin-graph.json"), "utf8"));
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/?twin`);
  await pg.waitForSelector("#twin-bar:not([hidden])");
  await pg.waitForSelector("#step1-done:not([hidden])");
  await pg.addScriptTag({ url: "api/graph.js" });
  const real = await pg.evaluate(() => !!(window.Graph && window.Graph.neighbours));
  const logs = golden.nodes.find((n) => n.type === "bucket" && /cloudfront-logs/.test(n.label));
  if (!logs) fail("no logs bucket in the golden graph");
  // a hostile label must stay text
  const g = JSON.parse(JSON.stringify(golden));
  const stream = g.edges.find((e) => e.rel === "writes_to" && e.to === logs.id);
  if (!stream) fail("golden graph lost its writes_to edge");
  const sNode = g.nodes.find((n) => n.id === stream.from); sNode.label = "<img src=x onerror=window.__pwned=1>";
  const res = await pg.evaluate(([json, id]) => {
    const nb = window.Graph.neighbours ? window.Graph.neighbours(json, id) : (function () {
      const byId = new Map(json.nodes.map((n) => [n.id, n]));
      const TR = { api: "verified", template: "verified", content: "claimed", naming: "claimed", comment: "claimed", curated: "curated" };
      return { node: byId.get(id), links: json.edges.filter((e) => (e.from === id || e.to === id) && e.from !== e.to).map((e) => ({
        rel: e.rel, direction: e.from === id ? "out" : "in", node: byId.get(e.from === id ? e.to : e.from), evidence: e.evidence, trust: e.trust || TR[e.evidence], source: e.source, via: null })) };
    })();
    const lines = window.S3Browser.connections(nb);
    const box = document.getElementById("s3-file"); box.textContent = ""; box.appendChild(window.S3Browser.connectedPanel(nb, { twin: true }));
    return { lines: lines.map((l) => ({ mark: l.mark, words: l.words, via: l.via, n: l.nodes.length, otype: l.otype })), text: box.textContent };
  }, [g, logs.id]);
  const firstHop = res.lines.filter((l) => !l.via);
  const find = (w) => firstHop.find((l) => l.words === w);
  // 1. ontology.aws.a's readings from the bucket's side, with the right marks
  if (!find("receives from") || find("receives from").mark !== "") fail("receives from (stream, api): " + JSON.stringify(find("receives from")));
  if (!find("is in") || find("is in").mark !== "") fail("is in (region)");
  const holds = find("holds"); if (!holds || holds.n < 4 || !/^\D/.test(holds.otype)) fail("holds not grouped with a count: " + JSON.stringify(holds));
  const claimed = firstHop.filter((l) => l.mark === "?");
  if (!claimed.some((l) => l.words === "is named in")) fail("is named in (a file names the bucket, content) not marked ?: " + JSON.stringify(claimed));
  const part = find("is part of"); if (!part || part.mark !== "~") fail("is part of (site, curated) not marked ~: " + JSON.stringify(part));
  // 2. order: every confirmed line before every claimed one, curated last
  const rank = (m) => (m === "" ? 0 : m === "?" ? 1 : 2);
  for (let i = 1; i < firstHop.length; i++) if (rank(firstHop[i].mark) < rank(firstHop[i - 1].mark)) fail("trust order broken at line " + i);
  // 3. text only, synthetic said, legend shown
  if (await pg.evaluate(() => window.__pwned)) fail("a label ran as HTML");
  if (!res.text.includes("<img src=x")) fail("hostile label not shown as text");
  if (!res.text.includes("(synthetic)")) fail("twin not said");
  if (!/\?: claimed/.test(res.text)) fail("legend missing");
  // 4. an S3 name opens through the address
  const objBtn = await pg.$("#s3-file .connected button.c-name");
  if (!objBtn) fail("no S3 link in the panel");
  await objBtn.click();
  if (!/^#\/s3\//.test(await pg.evaluate(() => location.hash))) fail("S3 link did not go through the address");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("OK (s3 connected: " + firstHop.length + " first-hop lines for " + logs.label + ", readings and trust marks, grouped, text only, links by address" + (real ? "; Graph.neighbours" : "; one-hop stand-in until Graph.neighbours lands") + ")");
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
