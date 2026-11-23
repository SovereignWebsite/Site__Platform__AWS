// VaultDeploy (site/api/vault-deploy.js): the Vault deploy page's logic (ux.aws.a design 06) with no DOM and no AWS
// call: the Vault id, the quick-create links for both paths (one stack; least-privilege mode's -access stack), the
// pasted endpoint, and the /health check under security.aws.a's untrusted-answer rules. Node 22, no network.
// Run: node test/api/vault-deploy.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Response, Headers, URL, URLSearchParams, Promise, Error, TypeError, JSON,
  Math, Number, String, RegExp, Object, Array, setTimeout, clearTimeout, AbortController, ReadableStream, crypto: globalThis.crypto, encodeURIComponent, decodeURIComponent,
  fetch: () => { throw new Error("a request left the page"); } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../../site/api/vault-deploy.js", import.meta.url), "utf8"), ctx, { filename: "api/vault-deploy.js" });
const V = ctx.VaultDeploy;
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const throws = (f, m) => { try { f(); ok(false, m + ": did not throw"); } catch (e) { ok(e instanceof ctx.TypeError || e instanceof TypeError, m + ": " + e.message); } };

// ---- the Vault id ----
const ids = new Set(Array.from({ length: 200 }, () => V.newVaultId()));
ok([...ids].every((x) => /^[0-9a-f]{12}$/.test(x)) && ids.size === 200, "newVaultId: 12 hex digits, random");
ok(V.newVaultId({ getRandomValues: (a) => a.fill(0x0a) }) === "0a0a0a0a0a0a", "newVaultId: leading zeros kept");
throws(() => V.newVaultId({}), "newVaultId needs getRandomValues");

// ---- the quick-create link (AWS's documented form: templateURL, stackName, param_<Name>) ----
const SHA = "9c1e" + "0".repeat(60), SHA3 = "ab".repeat(32);
const TPL = "https://sws-templates-eu-west-2.s3.eu-west-2.amazonaws.com/templates/vault/0.4.4-draft/vault-" + SHA.slice(0, 12) + ".yaml";
const index = { "0.4.4-draft": { url: TPL, sha256: SHA }, "0.4.3": { url: "https://s3.eu-west-2.amazonaws.com/sws-templates/templates/vault/0.4.3/vault-" + SHA3.slice(0, 12) + ".yaml", sha256: SHA3 } };
const good = { region: "eu-west-2", vaultId: "3f9a0c21b7d4", index, version: "0.4.4-draft",
  imageUri: "123456789012.dkr.ecr.eu-west-2.amazonaws.com/sgraph-send@sha256:" + "a".repeat(64), deployPageOrigin: "https://deploy.example.com" };
const parse = (u) => { const url = new URL(u), [path, q] = url.hash.slice(1).split("?"); return { host: url.host, region: url.searchParams.get("region"), path, q: new URLSearchParams(q), raw: q }; };
const one = parse(V.vaultStackUrl(good));
ok(one.host === "eu-west-2.console.aws.amazon.com" && one.region === "eu-west-2" && one.path === "/stacks/create/review", "the console's quick-create page, in the chosen region");
ok(one.q.get("templateURL") === TPL && one.q.get("stackName") === "sws-vault-3f9a0c21b7d4", "templateURL and stackName");
ok(JSON.stringify([...one.q.keys()]) === JSON.stringify(["templateURL", "stackName", "param_VaultId", "param_DeployMode", "param_ImageUri", "param_DeployPageOrigin"]), "only documented parameters: " + [...one.q.keys()]);
ok(one.q.get("param_VaultId") === "3f9a0c21b7d4" && one.q.get("param_DeployMode") === "one-stack" && one.q.get("param_ImageUri") === good.imageUri && one.q.get("param_DeployPageOrigin") === good.deployPageOrigin, "parameters: VaultId, DeployMode one-stack by default, ImageUri, DeployPageOrigin");
ok(!/param_(DomainName|HostedZoneId|CertificateArn)/.test(one.raw), "domain parameters stay empty on the first deploy");
ok(/templateURL=https%3A%2F%2F/.test(one.raw) && /%40sha256%3A/.test(one.raw), "values are URL-encoded");
ok(parse(V.vaultStackUrl({ ...good, mode: "access-stack" })).q.get("param_DeployMode") === "access-stack", "least-privilege mode: DeployMode access-stack");
ok(parse(V.vaultStackUrl({ ...good, version: "0.4.3" })).q.get("templateURL") === index["0.4.3"].url, "the template URL comes from the index entry; the path style is accepted too");
ok(!("templateUrl" in good) && parse(V.vaultStackUrl({ ...good, templateUrl: "https://evil.s3.eu-west-2.amazonaws.com/x.yaml" })).q.get("templateURL") === TPL, "a templateUrl given by the caller is ignored: only the index decides");
const badIdx = (url, sha) => ({ ...good, index: { "0.4.4-draft": { url, sha256: sha === undefined ? SHA : sha } } });
const key = "/templates/vault/0.4.4-draft/vault-" + SHA.slice(0, 12) + ".yaml";
for (const [what, o] of [["a version not in the index", { ...good, version: "9.9.9" }], ["an inherited key", { ...good, version: "__proto__" }], ["no index", { ...good, index: undefined }],
  ["an index url that is not S3", badIdx("https://example.com" + key)], ["an http index url", badIdx("http://b.s3.eu-west-2.amazonaws.com" + key)],
  ["an S3 look-alike host", badIdx("https://b.s3.eu-west-2.amazonaws.com.evil.example" + key)], ["a query", badIdx("https://b.s3.eu-west-2.amazonaws.com" + key + "?versionId=abc")],
  ["a key not in the per-version form", badIdx("https://b.s3.eu-west-2.amazonaws.com/vault/0.4.4/vault.yaml")],
  ["a key for another version", badIdx("https://b.s3.eu-west-2.amazonaws.com/templates/vault/0.4.3/vault-" + SHA.slice(0, 12) + ".yaml")],
  ["a key whose hash prefix is not the index sha256's", badIdx("https://b.s3.eu-west-2.amazonaws.com/templates/vault/0.4.4-draft/vault-" + SHA3.slice(0, 12) + ".yaml")],
  ["a key for another template", badIdx("https://b.s3.eu-west-2.amazonaws.com/templates/vault-access/0.4.4-draft/vault-access-" + SHA.slice(0, 12) + ".yaml")],
  ["a key with a prefix before templates/", badIdx("https://b.s3.eu-west-2.amazonaws.com/x/templates/vault/0.4.4-draft/vault-" + SHA.slice(0, 12) + ".yaml")],
  ["a bad sha256", badIdx(TPL, "9C1E")]])
  throws(() => V.vaultStackUrl(o), "refused: " + what);
ok(parse(V.vaultStackUrl({ ...good, deployPageOrigin: "https://deploy.example.com:8443" })).q.get("param_DeployPageOrigin").endsWith(":8443"), "an origin with a port");
for (const [field, bad] of [["region", "eu-west-2.evil.example/x"], ["region", "EU-WEST-2"], ["vaultId", "3F9A0C21B7D4"], ["vaultId", "3f9a0c21b7d"], ["vaultId", "3f9a0c21b7d4&param_X=1"],
  ["imageUri", "docker.io/library/nginx:latest"], ["imageUri", "123456789012.dkr.ecr.eu-west-2.amazonaws.com/sgraph-send:latest"],
  ["deployPageOrigin", "https://*.example.com"], ["deployPageOrigin", "https://deploy.example.com/"], ["deployPageOrigin", "http://deploy.example.com"], ["deployPageOrigin", "https://192.0.2.1"], ["mode", "two-stacks"]])
  throws(() => V.vaultStackUrl({ ...good, [field]: bad }), "refused " + field + " " + bad);
throws(() => V.vaultStackUrl(), "no options");

// ---- least-privilege mode, screen 2-alt ----
const accessIndex = { "0.2.0": { url: "https://sws-templates-eu-west-2.s3.eu-west-2.amazonaws.com/templates/vault-access/0.2.0/vault-access-" + "cd".repeat(6) + ".yaml", sha256: "cd".repeat(32) } };
const acc = parse(V.accessStackUrl({ region: "eu-west-2", vaultId: "3f9a0c21b7d4", index: accessIndex, version: "0.2.0",
  params: { VaultId: "000000000000", Extra: "a&b=c", Skipped: undefined } }));
ok(acc.q.get("templateURL") === accessIndex["0.2.0"].url && acc.q.get("stackName") === "sws-vault-3f9a0c21b7d4-access" && acc.q.get("param_VaultId") === "3f9a0c21b7d4" && acc.q.getAll("param_VaultId").length === 1, "the -access stack, VaultId always this page's");
ok(acc.q.get("param_Extra") === "a&b=c" && !acc.q.has("param_Skipped"), "the access template's own parameters passed as given, encoded; undefined left out");
throws(() => V.accessStackUrl({ region: "eu-west-2", vaultId: "3f9a0c21b7d4", index: accessIndex, version: "0.2.0", params: { "X&Y": "1" } }), "a bad parameter name");
throws(() => V.accessStackUrl({ region: "eu-west-2", vaultId: "3f9a0c21b7d4", index: accessIndex, version: "0.1.0" }), "the access template's version must be in its index");
throws(() => V.accessStackUrl({ region: "eu-west-2", vaultId: "3f9a0c21b7d4", index, version: "0.4.4-draft" }), "the vault template's index is not the access template's");
ok(V.deployRoleName("3f9a0c21b7d4") === "sws-vault-3f9a0c21b7d4-deploy", "the role named under B");
throws(() => V.deployRoleName("nope"), "deployRoleName checks the id");

// ---- the pasted endpoint ----
const ce = (s) => JSON.stringify(V.cleanEndpoint(s));
ok(ce("  https://d1a2b3c4d5e6f7.cloudfront.net/  ") === JSON.stringify({ ok: true, endpoint: "https://d1a2b3c4d5e6f7.cloudfront.net" }), "spaces and a trailing slash");
ok(ce("d1a2b3c4d5e6f7.cloudfront.net") === ce("HTTPS://D1A2B3C4D5E6F7.CLOUDFRONT.NET//"), "without https:// and in capitals: the same");
for (const [s, r] of [["", "empty"], ["   ", "empty"], [null, "empty"], ["https://d1.cloudfront.net/health", "not-url"], ["https://user@d1.cloudfront.net", "not-url"], ["https://d1.cloudfront.net?x=1", "not-url"],
  ["http://d1.cloudfront.net", "not-cloudfront"], ["https://vault.example.com", "not-cloudfront"], ["https://d1.cloudfront.net.evil.example", "not-cloudfront"], ["https://d1.cloudfront.net:443", "not-cloudfront"], ["javascript:alert(1)", "not-url"], ["https://d1 a.cloudfront.net", "not-url"]])
  ok(V.cleanEndpoint(s).ok === false && V.cleanEndpoint(s).reason === r, "endpoint " + JSON.stringify(s) + ": " + r + " (got " + ce(s) + ")");

// ---- /health ----
const answer = (body, init) => async (url, opts) => { answer.last = { url, opts }; return typeof body === "function" ? body(url, opts) : new Response(body, init); };
const chk = (f, e, o) => V.checkHealth(f, e === undefined ? "d1a2b3c4d5e6f7.cloudfront.net/" : e, { vaultId: "3f9a0c21b7d4", index, version: "0.4.4-draft", ...o });
let r = await chk(answer(JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.4.4-draft" })));
ok(r.ok && r.vaultId === "3f9a0c21b7d4" && r.version === "0.4.4-draft" && r.sha256 === index["0.4.4-draft"].sha256, "a matching Vault: id, version, sha256 from the page's index");
ok(answer.last.url === "https://d1a2b3c4d5e6f7.cloudfront.net/health", "fetches <endpoint>/health on the cleaned address");
ok(answer.last.opts.credentials === "omit" && answer.last.opts.redirect === "error" && answer.last.opts.cache === "no-store" && answer.last.opts.method === "GET" && answer.last.opts.referrerPolicy === "no-referrer", "untrusted: no credentials, no redirects, no cache, no referrer");
const cases = [
  [JSON.stringify({ vault_id: "aaaaaaaaaaaa", template_version: "0.4.4-draft" }), { reason: "other-vault", vaultId: "aaaaaaaaaaaa" }],
  [JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.3.2" }), { reason: "old-template", version: "0.3.2" }],
  [JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.4.3" }), { reason: "other-template", version: "0.4.3" }],
  [JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.4.4-draft", template_sha256: "ab".repeat(32) }), { reason: "template-mismatch", version: "0.4.4-draft" }],
  [JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.4.4-draft", template_sha256: null }), { reason: "template-mismatch", version: "0.4.4-draft" }],
  [JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.4.3", template_sha256: SHA }), { reason: "template-mismatch", version: "0.4.3" }],
  [JSON.stringify({ vault_id: "3f9a0c21b7d4" }), { reason: "old-template", version: "" }],
  [JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "__proto__" }), { reason: "old-template", version: "__proto__" }],
  [JSON.stringify({ vault_id: "<img src=x onerror=1>", template_version: "0.4.4-draft" }), { reason: "not-a-vault" }],
  [JSON.stringify({ status: "ok" }), { reason: "not-a-vault" }],
  ["<html>hello</html>", { reason: "not-a-vault" }],
  [JSON.stringify([1, 2]), { reason: "not-a-vault" }],
  ["null", { reason: "not-a-vault" }]
];
for (const [body, want] of cases) {
  r = await chk(answer(body));
  ok(!r.ok && Object.entries(want).every(([k, v]) => r[k] === v), "health " + body.slice(0, 50) + " -> " + JSON.stringify(r));
}
r = await chk(answer(JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.4.4-draft" }), { status: 403 }));
ok(!r.ok && r.reason === "not-a-vault", "a non-2xx answer is not a Vault");
r = await chk(async () => { throw new TypeError("Failed to fetch"); });
ok(!r.ok && r.reason === "no-answer", "network, DNS, CORS or a redirect: no answer");
r = await chk(answer(JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.4.4-draft", pad: "x".repeat(10000) })));
ok(!r.ok && r.reason === "too-large", "more than 4 KB is refused");
let cancelled = false;
const endless = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
r = await chk(answer(() => new Response(endless)));
ok(!r.ok && r.reason === "too-large" && cancelled, "an endless body is cut at the cap and cancelled");
let aborted = false;
const t0 = Date.now();
r = await chk(async (u, o) => new Promise((res, rej) => { o.signal.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); }); }), undefined, { timeoutMs: 50 });
ok(!r.ok && r.reason === "no-answer" && aborted && Date.now() - t0 < 1000, "no answer within the limit: aborted, no-answer");
r = await chk(answer("{}"), "https://vault.example.com");
ok(!r.ok && r.reason === "not-cloudfront" && answer.last.url !== "https://vault.example.com/health", "a pasted address that is not CloudFront is not fetched");
r = await chk(answer("{}"), "");
ok(!r.ok && r.reason === "not-url", "nothing pasted: not fetched");
let threw = 0;
try { await V.checkHealth(answer("{}"), "d1.cloudfront.net", { vaultId: "bad", index, version: "0.4.4-draft" }); } catch (e) { threw++; }
try { await V.checkHealth(null, "d1.cloudfront.net", { vaultId: "3f9a0c21b7d4", index, version: "0.4.4-draft" }); } catch (e) { threw++; }
try { await V.checkHealth(answer("{}"), "d1.cloudfront.net", { vaultId: "3f9a0c21b7d4", index }); } catch (e) { threw++; }
ok(threw === 3, "checkHealth needs fetch, this page's vault id and the linked version");
r = await chk(answer(JSON.stringify({ vault_id: "3f9a0c21b7d4", template_version: "0.4.4-draft", template_sha256: index["0.4.4-draft"].sha256 })));
ok(r.ok && r.sha256 === index["0.4.4-draft"].sha256, "a template_sha256 that agrees with the index is fine");

// ---- the source ----
const src = readFileSync(new URL("../../site/api/vault-deploy.js", import.meta.url), "utf8");
ok(!/\beval\(|new Function|innerHTML|localStorage|sessionStorage|document\.cookie|setInterval/.test(src), "no eval, HTML, storage, cookies or timers that repeat");
ok(!/sts\.amazonaws|cloudformation\.[a-z0-9-]+\.amazonaws\.com|SigV4|accessKeyId/i.test(src), "no AWS API call and no credential handling");

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (vault-deploy: " + passed + " checks; vault id, quick-create links, endpoint, /health)");
