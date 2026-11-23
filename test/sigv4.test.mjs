// AWS's published SigV4 test vector "get-vanilla" (example credentials from AWS's documentation).
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = { crypto: globalThis.crypto, TextEncoder, URL, globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(new URL("../site/sigv4.js", import.meta.url), "utf8"), ctx);
const h = await ctx.SigV4.sign(
  { method: "GET", url: "https://example.amazonaws.com/", headers: {}, body: "" },
  { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
  "us-east-1", "service", "20150830T123600Z");
const want = "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31";
if (!h.authorization.endsWith("Signature=" + want)) { console.error("FAIL", h.authorization); process.exit(1); }
console.log("OK (sigv4 get-vanilla)");
// S3: AWS's documented GET Object example (examplebucket, test.txt, Range bytes=0-9, 20130524T000000Z).
const s3 = await ctx.SigV4.sign(
  { method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" }, body: "" },
  { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  "us-east-1", "s3", "20130524T000000Z");
const want3 = "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41";
if (!s3.authorization.endsWith("Signature=" + want3)) { console.error("FAIL s3", s3.authorization); process.exit(1); }
console.log("OK (sigv4 s3 get-object)");
