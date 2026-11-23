// The zip reader against real zips made by Python (deflate, stored, UTF-8 names, a comment, zip64),
// reading only byte ranges, as the page does from S3.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = { TextDecoder, DataView, Uint8Array, Blob, Response, DecompressionStream, Promise, Error };
ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(new URL("../site/zip.js", import.meta.url), "utf8"), ctx);
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
async function check(file) {
  const buf = readFileSync(new URL("./fixtures/" + file, import.meta.url)); let reqs = 0, bytes = 0;
  const fetchRange = (a, b) => { reqs++; bytes += b - a + 1; const s = buf.subarray(a, b + 1); return Promise.resolve(s.buffer.slice(s.byteOffset, s.byteOffset + s.length)); };
  const entries = await ctx.Zip.list(fetchRange, buf.length);
  return { entries, fetchRange, stats: () => ({ reqs, bytes, size: buf.length }) };
}
const p = await check("plain.zip");
const names = p.entries.map((e) => e.name);
for (const n of ["folder/", "folder/data.json", "stored.txt", "naïve-ünïcode.txt", "big.txt"]) if (!names.includes(n)) fail("missing " + n + " in " + names);
const listed = p.stats(); if (listed.reqs > 1 || listed.bytes > 70000) fail("listing read too much " + JSON.stringify(listed));
const dec = (u) => new TextDecoder().decode(u);
const get = async (z, n) => dec(await ctx.Zip.read(z.fetchRange, z.entries.find((e) => e.name === n)));
if (JSON.parse(await get(p, "folder/data.json")).b[1] !== 2) fail("deflate");
if (await get(p, "stored.txt") !== "hello stored") fail("stored");
if ((await get(p, "big.txt")).length !== 13 * 50000) fail("big");
if (p.entries.find((e) => e.name === "big.txt").compressed >= 650000) fail("big not compressed");
const z = await check("z64.zip");
if (await get(z, "forced64.txt") !== "zip64 body" || JSON.parse(await get(z, "second.json")).ok !== true) fail("zip64");
try { await ctx.Zip.list(() => Promise.resolve(new ArrayBuffer(100)), 100); fail("not-a-zip accepted"); } catch (e) { if (!/Not a zip/.test(e.message)) throw e; }
console.log("OK (zip: list in " + listed.reqs + " requests, " + listed.bytes + " of " + listed.size + " bytes; deflate, stored, UTF-8, zip64)");
