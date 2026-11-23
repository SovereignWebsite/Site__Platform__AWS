// End to end in Chromium, with Google and AWS stubbed: sign in, add an account, download the
// template, read, show the plan, approve, and check the UpdateAssumeRolePolicy body.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "site");
const srv = http.createServer((q, s) => {
  let p = path.join(root, decodeURIComponent(q.url.split("?")[0]));
  if (p.endsWith("/")) p += "index.html";
  if (!fs.existsSync(p)) { s.writeHead(404); return s.end(); }
  let b = fs.readFileSync(p);
  if (p.endsWith("config.js")) b = Buffer.from(String(b).replace(/googleClientId: "[^"]*"/, 'googleClientId: "123-abc.apps.googleusercontent.com"'));
  s.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".yaml": "text/yaml" }[path.extname(p)] || "text/plain" });
  s.end(b);
}).listen(0);
const port = srv.address().port;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = b64({ alg: "none" }) + "." + b64({ sub: "111222333444555", email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";
const K = "token.actions.githubusercontent.com:sub";
let policy = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Federated: "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com" }, Action: "sts:AssumeRoleWithWebIdentity",
  Condition: { StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" }, "ForAnyValue:StringEquals": { [K]: ["repo:SovereignWebsite@358722364/SovereignWebsite__Factory@1464324035:environment:apply"] } } }] };
const calls = []; let flips = 0; let zipServed = 0;
const gz = fs.readFileSync(path.join(__dirname, "fixtures/trail.json.gz")), zipf = fs.readFileSync(path.join(__dirname, "fixtures/plain.zip"));
const flip = (p) => { const q = JSON.parse(JSON.stringify(p)); if (flips++ % 2) { const c = q.Statement[0].Condition; q.Statement[0].Condition = Object.fromEntries(Object.entries(c).reverse()); q.Statement[0] = Object.fromEntries(Object.entries(q.Statement[0]).reverse()); } return q; };
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ acceptDownloads: true });
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await pg.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "text/javascript", body:
    `window.google={accounts:{id:{initialize:function(o){window.__cb=o.callback},renderButton:function(e){var b=document.createElement('button');b.id='g';b.textContent='Google';b.onclick=function(){__cb({credential:${JSON.stringify(jwt)}})};e.appendChild(b)},disableAutoSelect:function(){},prompt:function(){window.__prompts=(window.__prompts||0)+1}}}};` }));
  await pg.route("https://sts.amazonaws.com/", async (r) => {
    const body = new URLSearchParams(r.request().postData()); calls.push("sts:" + body.get("Action") + ":" + (body.get("RoleArn") || ""));
    const xml = body.get("Action") === "AssumeRoleWithWebIdentity"
      ? `<R><Credentials><AccessKeyId>ASIATEST</AccessKeyId><SecretAccessKey>s</SecretAccessKey><SessionToken>t</SessionToken><Expiration>${new Date(Date.now() + 3600e3).toISOString()}</Expiration></Credentials></R>`
      : `<R><Arn>arn:aws:sts::000000000000:assumed-role/sws-aws-platform-read/sws-aws-platform</Arn></R>`;
    if (body.get("Action") !== "AssumeRoleWithWebIdentity" && !r.request().headers()["authorization"]) return r.fulfill({ status: 403, body: "<E><Code>Unsigned</Code></E>" });
    r.fulfill({ contentType: "text/xml", headers: { "access-control-allow-origin": "*" }, body: xml });
  });
  await pg.route("https://ce.us-east-1.amazonaws.com/", (r) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ResultsByTime: [{ Total: { UnblendedCost: { Amount: "12.3456", Unit: "USD" } } }] }) }));
  await pg.route("https://iam.amazonaws.com/", (r) => {
    const body = new URLSearchParams(r.request().postData()); calls.push("iam:" + body.get("Action"));
    // Like IAM: a list of one is stored (and read back) as the bare value.
    const collapse = (v) => Array.isArray(v) ? (v.length === 1 ? collapse(v[0]) : v.map(collapse)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, collapse(x)])) : v;
    if (body.get("Action") === "UpdateAssumeRolePolicy") { policy = JSON.parse(body.get("PolicyDocument")); policy.Statement.forEach((st) => { st.Condition = collapse(st.Condition); }); return r.fulfill({ contentType: "text/xml", headers: { "access-control-allow-origin": "*" }, body: "<R/>" }); }
    r.fulfill({ contentType: "text/xml", headers: { "access-control-allow-origin": "*" }, body: `<R><AssumeRolePolicyDocument>${encodeURIComponent(JSON.stringify(flip(policy)))}</AssumeRolePolicyDocument></R>` });
  });
  // Cloud Control, S3 and CloudFormation stubs (S3 browser and the stack plan).
  let cors = false; const seen = {};
  const ok = (r, body, type) => r.fulfill({ contentType: type || "application/json", headers: { "access-control-allow-origin": "*" }, body });
  await pg.route(/https:\/\/cloudcontrolapi\.[a-z0-9-]+\.amazonaws\.com\//, (r) => {
    const t = r.request().headers()["x-amz-target"]; const q = JSON.parse(r.request().postData()); const host = new URL(r.request().url()).host; calls.push("cc:" + t.split(".")[1] + "@" + host.split(".")[1]);
    // Like the real Cloud Control: a change to an eu-west-2 bucket sent to us-east-1 fails with S3's 301.
    if (t.endsWith("UpdateResource") && !host.includes("eu-west-2")) return ok(r, JSON.stringify({ ProgressEvent: { RequestToken: "bad", OperationStatus: "FAILED", StatusMessage: "301 PermanentRedirect" } }));
    if (t.endsWith("GetResourceRequestStatus") && q.RequestToken === "bad") return ok(r, JSON.stringify({ ProgressEvent: { OperationStatus: "FAILED", StatusMessage: "The bucket you are attempting to access must be addressed using the specified endpoint." } }));
    if (!r.request().headers()["authorization"]) return r.fulfill({ status: 403, body: "{}" });
    if (t.endsWith("ListResources")) return ok(r, JSON.stringify({ ResourceDescriptions: [{ Identifier: "my-bucket" }] }));
    if (t.endsWith("GetResource")) return ok(r, JSON.stringify({ ResourceDescription: { Identifier: q.Identifier, Properties: JSON.stringify(Object.assign({ BucketName: "my-bucket", RegionalDomainName: "my-bucket.s3.eu-west-2.amazonaws.com" }, cors ? { CorsConfiguration: { CorsRules: [{ Id: "sws-aws-platform", AllowedOrigins: [`http://localhost:${port}`], AllowedMethods: ["GET", "HEAD"] }] } } : {})) } }));
    if (t.endsWith("UpdateResource")) { seen.patch = JSON.parse(q.PatchDocument); return ok(r, JSON.stringify({ ProgressEvent: { RequestToken: "tok", OperationStatus: "IN_PROGRESS" } })); }
    if (t.endsWith("GetResourceRequestStatus")) { cors = true; return ok(r, JSON.stringify({ ProgressEvent: { OperationStatus: "SUCCESS" } })); }
  });
  await pg.route(/https:\/\/my-bucket\.s3\.eu-west-2\.amazonaws\.com\/.*/, (r) => {
    const h = r.request().headers(); calls.push("s3:" + new URL(r.request().url()).pathname);
    if (!h["authorization"] || !h["x-amz-content-sha256"] || !h["authorization"].includes("/eu-west-2/s3/")) return r.fulfill({ status: 403, body: "<Error><Code>BadSig</Code></Error>" });
    const u = new URL(r.request().url());
    if (u.pathname === "/") return ok(r, `<ListBucketResult><CommonPrefixes><Prefix>logs/</Prefix></CommonPrefixes><Contents><Key>data.json</Key><Size>27</Size><LastModified>2026-11-23T00:00:00.000Z</LastModified></Contents><Contents><Key>trail.json.gz</Key><Size>${gz.length}</Size></Contents><Contents><Key>stack.yaml</Key><Size>3000</Size></Contents><Contents><Key>pkg.zip</Key><Size>${zipf.length}</Size></Contents></ListBucketResult>`, "application/xml");
    if (u.pathname === "/stack.yaml") return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" }, body: fs.readFileSync(path.join(__dirname, "../site/cloudformation/bootstrap.yaml")) });
    if (u.pathname === "/trail.json.gz") return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/x-gzip" }, body: gz });
    if (u.pathname === "/pkg.zip") {
      const m = /bytes=(\d+)-(\d+)/.exec(h["range"] || "");
      if (!m) { zipServed += zipf.length; return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/zip" }, body: zipf }); }
      if (!h["authorization"].includes("range;")) return r.fulfill({ status: 403, body: "<Error><Code>RangeNotSigned</Code></Error>" });
      const part = zipf.subarray(+m[1], +m[2] + 1); zipServed += part.length;
      return r.fulfill({ status: 206, headers: { "access-control-allow-origin": "*", "content-type": "application/zip" }, body: part });
    }
    if (u.pathname === "/data.json") return ok(r, '{"b":[1,2],"a":{"x":"<img src=x onerror=alert(1)>"}}', "application/json");
    r.fulfill({ status: 404, body: "<Error><Code>NoSuchKey</Code></Error>" });
  });
  await pg.route("https://cloudformation.us-east-1.amazonaws.com/", (r) => {
    const b = new URLSearchParams(r.request().postData()); const A = b.get("Action"); calls.push("cfn:" + A);
    const x = (body) => ok(r, body, "text/xml");
    if (A === "GetTemplate") return x("<R><TemplateBody>AWSTemplateFormatVersion: &quot;2010-09-09&quot;\nold: v1</TemplateBody></R>");
    if (A === "CreateChangeSet") { seen.cs = Object.fromEntries(b); return x("<R><Id>cs</Id></R>"); }
    if (A === "DescribeChangeSet") return x("<R><Status>CREATE_COMPLETE</Status><Changes><member><ResourceChange><Action>Modify</Action><LogicalResourceId>PlatformRead</LogicalResourceId><ResourceType>AWS::IAM::Role</ResourceType><Replacement>False</Replacement></ResourceChange></member></Changes></R>");
    if (A === "ExecuteChangeSet") return x("<R/>");
    if (A === "DescribeStacks") return x("<R><StackStatus>UPDATE_COMPLETE</StackStatus></R>");
  });
  await pg.goto(`http://localhost:${port}/`);
  await pg.waitForFunction(() => window.__prompts === 1); // no session: Google is asked to sign in without a click
  await pg.click("#g");
  await pg.waitForSelector("#step1-done:not([hidden])");
  if (await pg.isVisible("#google-button")) throw new Error("button still shown when signed in");
  await pg.fill("#acct-label", "Main"); await pg.fill("#acct-id", "000000000000"); await pg.click("#add-account button");
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("text=1. Download this account's template")]);
  const tpl = fs.readFileSync(await dl.path(), "utf8");
  if (!tpl.includes('Default: "111222333444555"') || !tpl.includes('Default: "123-abc.apps.googleusercontent.com"')) throw new Error("template defaults missing: " + tpl.slice(0, 600));
  await pg.click("text=Read this account");
  await pg.waitForSelector("text=Cost this month so far", { timeout: 5000 }).catch(async () => { const d = new Date(); if (d.getUTCDate() !== 1) throw new Error("read: " + await pg.textContent("#accounts")); });
  // The vault: a refresh keeps the session and the account; nothing readable is stored.
  await pg.reload();
  await pg.waitForSelector("#restored:not([hidden])", { timeout: 5000 });
  await pg.waitForTimeout(300); if (await pg.evaluate(() => window.__prompts)) throw new Error("prompted although the session was restored");
  if (!(await pg.textContent("#accounts")).includes("Main")) throw new Error("account not restored");
  const stored = await pg.evaluate(() => new Promise((res) => { const r = indexedDB.open("sws-sealed-store"); r.onsuccess = () => { const t = r.result.transaction("kv").objectStore("kv"); const all = {}; const c = t.openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) { const dk = all["device-key"]; res({ keys: Object.keys(all), extractable: dk.privateKey.extractable, text: JSON.stringify(Object.fromEntries(Object.entries(all).filter(([k]) => k !== "device-key").map(([k, v]) => [k, Array.from(new Uint8Array(v.ct))]))) }); return; } all[cur.key] = cur.value; cur.continue(); }; }; }));
  if (stored.extractable !== false) throw new Error("device private key is extractable");
  const ctBytes = JSON.parse(stored.text); const asText = Object.values(ctBytes).map((a) => Buffer.from(a).toString("latin1")).join("");
  if (asText.includes("ASIATEST") || asText.includes(jwt.split(".")[1]) || asText.includes("000000000000")) throw new Error("plaintext in the sealed store");
  const ls = await pg.evaluate(() => JSON.stringify(localStorage)); if (ls.includes("000000000000")) throw new Error("account in localStorage");
  await pg.click("#tab-plans");
  // Badges: every plan checks AWS; all three are waiting at first.
  // (the last-step plan cannot run yet: removing the Factory subject would leave none)
  await pg.waitForFunction(() => { const t = [...document.querySelectorAll("#plans .badge")].map((b) => b.textContent); return t.filter((x) => x === "Waiting for you").length === 2 && t.includes("Not possible yet"); });
  await pg.click('li[data-plan="2026-11-22__iac-dns-trust"] button:has-text("Show the plan")');
  await pg.click('li[data-plan="2026-11-22__iac-dns-trust"] button.approve');
  await pg.waitForSelector("text=Applied and checked");
  // Applied: it re-checks, turns Done and moves to the history.
  await pg.waitForSelector('#plans-done li[data-plan="2026-11-22__iac-dns-trust"] .badge.ok', { state: "attached" });
  if (await pg.$eval("#plans-done-count", (e) => e.textContent) !== "1" || await pg.isHidden("#plans-history")) throw new Error("history");
  await pg.waitForSelector('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"] .badge.warn');
  await pg.click('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"] button:has-text("Show the plan")');
  await pg.waitForSelector('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"] pre.diff');
  if (process.argv[3]) await pg.locator('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"]').screenshot({ path: process.argv[3] });
  if ((await pg.locator("pre.diff span.add").count()) === 0) throw new Error("no diff view");
  const subs = policy.Statement[0].Condition["ForAnyValue:StringEquals"][K];
  if (subs.length !== 2 || !subs[0].includes("SovereignWebsite__IaC")) throw new Error("policy " + JSON.stringify(subs));
  // Step 5: remove the Factory subject; checked by reading the role back.
  await pg.click('li[data-plan="2026-11-23__iac-dns-trust-remove-factory"] button.approve');
  await pg.waitForSelector("text=no longer trusts");
  await pg.waitForSelector('#plans-done li[data-plan="2026-11-23__iac-dns-trust-remove-factory"]', { state: "attached" });
  const left = policy.Statement[0].Condition["ForAnyValue:StringEquals"][K];
  if (typeof left !== "string" || !left.includes("SovereignWebsite__IaC")) throw new Error("after removal " + JSON.stringify(left));
  // The stack plan: diff, change set, execute.
  await pg.click('li[data-plan="2026-11-23__platform-template-v2"] button:has-text("Show the plan")');
  await pg.click("text=1. Approve: ask AWS what this will change");
  await pg.waitForSelector("text=Modify PlatformRead (AWS::IAM::Role)");
  if (seen.cs["Capabilities.member.1"] !== "CAPABILITY_NAMED_IAM" || seen.cs["Parameters.member.2.UsePreviousValue"] !== "true" || !seen.cs.TemplateBody.includes("s3-browse")) throw new Error("change set request " + JSON.stringify(seen.cs).slice(0, 300));
  await pg.click("text=2. Approve: execute the change set");
  await pg.waitForSelector("text=Applied and checked: sws-aws-platform is UPDATE_COMPLETE.");
  // The S3 browser: list buckets, add the CORS rule on Approve, list, open JSON formatted (and never run it).
  await pg.click("#tab-s3");
  await pg.click("#s3-list-buckets");
  await pg.click("#s3-buckets button:has-text('my-bucket')");
  await pg.click("text=Approve and add the rule to my-bucket");
  await pg.waitForSelector("#s3-list >> text=data.json");
  if (JSON.stringify(seen.patch) !== JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [{ Id: "sws-aws-platform", AllowedOrigins: [`http://localhost:${port}`], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], ExposedHeaders: ["ETag", "Content-Type", "Content-Length", "Last-Modified"], MaxAge: 3000 }] } }])) throw new Error("patch " + JSON.stringify(seen.patch));
  await pg.click("#s3-list >> text=data.json");
  await pg.waitForSelector("pre.json .j-key");
  const shown = await pg.textContent("pre.json");
  if (!shown.includes('"b": [\n    1,\n    2\n  ]') || await pg.$("#s3-file img")) throw new Error("json view " + shown);
  // YAML: colour coded.
  await pg.click("#s3-list >> text=stack.yaml");
  await pg.waitForSelector("#s3-file pre.code.lang-yaml .t-key");

  // json.gz: unzipped in the browser and shown formatted.
  await pg.click("#s3-list >> text=trail.json.gz");
  await pg.waitForSelector("#s3-file pre.json >> text=GetObject");
  // A zip: listed and one file opened by byte ranges, without downloading the zip.
  await pg.click("#s3-list >> text=pkg.zip");
  await pg.waitForSelector("#s3-file >> text=folder/data.json");
  await pg.click("#s3-file button:has-text('folder/data.json')");
  await pg.waitForSelector('#s3-file .viewer pre.json .j-key');
  if (zipServed > 100000) throw new Error("zip: served " + zipServed + " of " + zipf.length + " bytes");
  await pg.click("#s3-list >> text=logs/");
  await pg.waitForSelector(".crumbs >> text=logs");
  // Screenshot mode: email, Google ID, account IDs and costs hidden everywhere; off restores them.
  await pg.click("#tab-accounts");
  await pg.click("#screenshot-toggle");
  await pg.click("text=Read this account");
  await pg.waitForSelector("text=Cost this month so far");
  const visible = await pg.textContent("main");
  if (/owner@example\.com|111222333444555|000000000000|12\.35/.test(visible)) throw new Error("screenshot mode left: " + (visible.match(/owner@example\.com|111222333444555|000000000000|12\.35/) || [])[0]);
  if (process.argv[4]) await pg.screenshot({ path: process.argv[4] });
  await pg.click("#screenshot-toggle");
  if (!(await pg.textContent("main")).includes("owner@example.com")) throw new Error("screenshot mode off did not restore");
  // Signed in with another Google account than the one that set the account up: the page says so.
  await pg.click("#tab-accounts");
  await pg.click("text=Read this account");
  await pg.waitForSelector("text=Cost this month so far");
  const jwt2 = b64({ alg: "none" }) + "." + b64({ sub: "999888777666555", email: "other@example.com", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";
  await pg.evaluate((t) => window.__cb({ credential: t }), jwt2);
  await pg.waitForSelector("#identity-warning:not([hidden])");
  if (!(await pg.textContent("#identity-warning")).includes("ending 444555")) throw new Error("warning text " + await pg.textContent("#identity-warning"));
  await pg.click("#forget-device");
  await pg.waitForSelector("text=This device's key and everything sealed with it are deleted.");
  await pg.reload(); await pg.waitForTimeout(500);
  if (!(await pg.$eval("#step1-done", (e) => e.hidden))) throw new Error("still signed in after Forget this device");
  if (errors.length) throw new Error("page errors: " + errors.join(" | "));
  await pg.setViewportSize({ width: 375, height: 800 });
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 375) { const wide = await pg.evaluate(() => [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > 380).slice(0, 6).map(e => e.tagName + "." + e.className).join(", ")); throw new Error("horizontal scroll at phone width: " + sw + " " + wide); }
  await pg.screenshot({ path: process.argv[2] || "/dev/null", fullPage: true });
  console.log("OK (page e2e) " + calls.join(" "));
  await br.close(); srv.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
