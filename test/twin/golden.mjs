// The twin's golden output, per demo pack: every bucket, and every object's key, size, ETag, content type and
// LastModified, read through the twin's own public surface (Cloud Control ListResources, then S3 ListObjectsV2
// pages and a GET per object), plus the IAM roles' trust policies. Design 02 (architect.aws.a), migration steps 1
// and 2: the journal and the packs as JSON must give byte-for-byte this output.
//   node test/twin/golden.mjs write   writes test/fixtures/twin-golden/<pack>.json from site/twin.js as it is
//   (imported by golden.test.mjs, which compares)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, "..", "..");
export const FIXTURES = path.join(ROOT, "test", "fixtures", "twin-golden");
export const PACKS = ["baseline", "attack", "surge"];

// Load the twin in a fresh context, as the page would with ?pack=<name>: its own globals, no network.
export function loadTwin(pack) {
  const win = {
    location: { search: "?pack=" + pack, origin: "http://localhost" },
    URLSearchParams, URL, TextEncoder, TextDecoder, Response, Blob, CompressionStream, DecompressionStream,
    // The twin waits 60 to 180 ms per answer to feel like a network; here the wait is skipped (the order is kept).
    Promise, setTimeout: (f) => setImmediate(f), Uint8Array, Uint32Array, ArrayBuffer, DataView, Math, JSON, Date, Object, Array, String, Number, RegExp, Error, TypeError,
  };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of ["site/twin.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  return win.AwsTwin;
}

const AUTH = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261122/eu-west-2/s3/aws4_request, SignedHeaders=host, Signature=twin" };

async function text(r) { return r.text(); }
function all(re, s) { const out = []; let m; while ((m = re.exec(s))) out.push(m); return out; }

export async function snapshot(pack) {
  const twin = loadTwin(pack);
  const h = (url, init) => twin.handle(url, Object.assign({ headers: {} }, init));
  const list = JSON.parse(await text(await h("https://cloudcontrolapi.eu-west-2.amazonaws.com/", {
    method: "POST", headers: Object.assign({ "x-amz-target": "CloudApiService.ListResources" }, AUTH), body: JSON.stringify({ TypeName: "AWS::S3::Bucket" }) })));
  const buckets = list.ResourceDescriptions.map((r) => r.Identifier).sort();
  const out = { pack, buckets: {}, roles: {} };
  const cc = async (target, q) => JSON.parse(await text(await h("https://cloudcontrolapi.eu-west-2.amazonaws.com/", {
    method: "POST", headers: Object.assign({ "x-amz-target": "CloudApiService." + target }, AUTH), body: JSON.stringify(q) })));
  out.bucketProps = {};
  for (const b of buckets) {
    // The bucket as Cloud Control reports it first (region, CORS as seeded), then the CORS rule the page would add,
    // so S3 answers for every bucket.
    out.bucketProps[b] = JSON.parse((await cc("GetResource", { TypeName: "AWS::S3::Bucket", Identifier: b })).ResourceDescription.Properties);
    if (!out.bucketProps[b].CorsConfiguration)
      await cc("UpdateResource", { TypeName: "AWS::S3::Bucket", Identifier: b, PatchDocument: JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [{ Id: "sws-aws-platform", AllowedOrigins: ["http://localhost"], AllowedMethods: ["GET", "HEAD"] }] } }]) });
  }
  for (const b of buckets) {
    const base = b.includes(".") ? "https://s3.eu-west-2.amazonaws.com/" + b + "/" : "https://" + b + ".s3.eu-west-2.amazonaws.com/";
    const objects = [];
    let token = null;
    do {
      const q = "?list-type=2&max-keys=1000" + (token ? "&continuation-token=" + encodeURIComponent(token) : "");
      const r = await h(base + q, { headers: AUTH });
      const t = await text(r);
      if (r.status === 200) {
        for (const m of all(/<Contents><Key>([^<]*)<\/Key><LastModified>([^<]*)<\/LastModified><ETag>&quot;([0-9a-f]+)&quot;<\/ETag><Size>(\d+)<\/Size>/g, t))
          objects.push({ key: m[1].replace(/&amp;/g, "&"), modified: m[2], etag: m[3], size: +m[4] });
        const nt = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(t);
        token = nt ? nt[1] : null;
      } else { out.buckets[b] = { status: r.status }; token = null; }
    } while (token);
    if (out.buckets[b]) continue;
    // Content type per object, from a GET (the listing does not carry it); the body's length must match Size.
    for (const o of objects) {
      const r = await h(base + o.key.split("/").map(encodeURIComponent).join("/"), { headers: AUTH });
      const bytes = new Uint8Array(await r.arrayBuffer());
      o.type = r.headers.get("content-type");
      if (bytes.length !== o.size) throw new Error(pack + ": " + b + "/" + o.key + " GET gives " + bytes.length + " bytes, the listing " + o.size);
    }
    out.buckets[b] = objects;
  }
  for (const role of ["sws-aws-platform-read", "sws-aws-platform-change", "sovereignwebsite-factory-dns"]) {
    const t = await text(await h("https://iam.amazonaws.com/", { method: "POST", headers: AUTH, body: "Action=GetRole&RoleName=" + role }));
    const m = /<AssumeRolePolicyDocument>([^<]*)<\/AssumeRolePolicyDocument>/.exec(t);
    out.roles[role] = m ? JSON.parse(decodeURIComponent(m[1])) : null;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "write") {
  fs.mkdirSync(FIXTURES, { recursive: true });
  for (const p of PACKS) {
    const s = await snapshot(p);
    fs.writeFileSync(path.join(FIXTURES, p + ".json"), JSON.stringify(s, null, 1) + "\n");
    const n = Object.values(s.buckets).reduce((a, x) => a + (Array.isArray(x) ? x.length : 0), 0);
    console.log("wrote " + p + ": " + Object.keys(s.buckets).length + " buckets, " + n + " objects");
  }
}
