// Decode (site/api/decode.js), in Node, no network: sniffing, gzip with its cap, JSON errors with line and
// column, JSON Lines and CSV as tables with errors as data, tables from CloudTrail's { Records }, limits, and
// hostile values returned as they are (never run, never HTML). Run: node test/api/decode.test.mjs
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../../site/api/decode.js", import.meta.url), "utf8");
const ctx = { TextDecoder, Uint8Array, Blob, DecompressionStream, Response, Promise, Error, JSON, Object, Array, String, Number, RegExp };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: "decode.js" });
const D = ctx.Decode;
const enc = (s) => new TextEncoder().encode(s);
const plain = (v) => JSON.parse(JSON.stringify(v)); // across the vm boundary, for deepEqual
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };

await test("sniff: magic bytes first, then names and types, then content", () => {
  assert.equal(D.sniff(new Uint8Array(gzipSync("x"))), "gzip");
  assert.equal(D.sniff(new Uint8Array(readFileSync(new URL("../fixtures/plain.zip", import.meta.url)))), "zip");
  assert.equal(D.sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])), "binary");
  assert.equal(D.sniff(enc('{"a":1}\n{"a":2}\n')), "jsonl");
  assert.equal(D.sniff(enc('{\n  "a": 1\n}\n')), "json");
  assert.equal(D.sniff(enc('[1,2]')), "json");
  assert.equal(D.sniff(enc('{"a":1}')), "json");
  assert.equal(D.sniff(enc("a,b\n1,2\n"), { name: "x.CSV" }), "csv");
  assert.equal(D.sniff(enc("a\tb\n"), { contentType: "text/tab-separated-values" }), "csv");
  assert.equal(D.sniff(enc('{"a":1}'), { name: "one.ndjson" }), "jsonl");
  assert.equal(D.sniff(enc("hello\n")), "text");
});

await test("gunzip: round trip, and the unpacked cap stops a bomb", async () => {
  const body = "line\n".repeat(1000);
  assert.equal(D.text(await D.gunzip(new Uint8Array(gzipSync(body)))), body);
  const bomb = new Uint8Array(gzipSync(Buffer.alloc(2 * 1024 * 1024)));
  await assert.rejects(D.gunzip(bomb, { maxBytes: 1024 * 1024 }), (e) => e.code === "TooLarge");
});

await test("the twin-style CloudTrail fixture: gunzip, sniff, json, table", async () => {
  const gz = new Uint8Array(readFileSync(new URL("../fixtures/trail.json.gz", import.meta.url)));
  assert.equal(D.sniff(gz, { name: "trail.json.gz" }), "gzip");
  const raw = await D.gunzip(gz);
  assert.equal(D.sniff(raw), "json");
  const t = D.table(D.json(D.text(raw)));
  assert.ok(t.rows.length > 0 && t.columns.includes("eventName"), JSON.stringify(t.columns));
});

await test("text: UTF-8, BOM dropped", () => {
  assert.equal(D.text(new Uint8Array([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9])), "café");
});

await test("json: a value, or an Error with line and column", () => {
  assert.deepEqual(plain(D.json('{"a":[1,2]}')), { a: [1, 2] });
  assert.throws(() => D.json('{\n  "a": 1,\n  "b": ]\n}'), (e) => e.code === "BadJSON" && e.line === 3 && e.column === 8 && /line 3, column 8/.test(e.message));
});

await test("json: error positions for trailing commas, bad literals, trailing text, open strings", () => {
  const at = (t) => { try { D.json(t); } catch (e) { return [e.line, e.column]; } return null; };
  assert.deepEqual(plain(at("[1,]")), [1, 4]);
  assert.deepEqual(plain(at('{"a":tru}')), [1, 6]);
  assert.deepEqual(plain(at("1 2")), [1, 3]);
  assert.deepEqual(plain(at('"abc')), [1, 5]);
  assert.deepEqual(plain(at('{"a":\n "b\u0001"}')), [2, 4]);
  assert.equal(at("[]"), null);
});

await test("jsonLines: columns in first-seen order, aligned rows, bad lines as errors, CRLF", () => {
  const t = D.jsonLines('{"a":1,"b":"x"}\r\n\r\n{"c":true,"a":2}\nnot json\n42\n');
  assert.deepEqual(plain(t.columns), ["a", "b", "c", "value"]);
  assert.deepEqual(plain(t.rows), [[1, "x", null, null], [2, null, true, null], [null, null, null, 42]].map((r) => r.map((v) => v === null ? undefined : v)).map((r) => plain(r)));
  assert.equal(t.errors.length, 1); assert.equal(t.errors[0].line, 4);
  assert.equal(t.truncated, false);
});

await test("jsonLines: max rows, then truncated", () => {
  const t = D.jsonLines('{"n":1}\n{"n":2}\n{"n":3}\n', { max: 2 });
  assert.equal(t.rows.length, 2); assert.equal(t.truncated, true);
});

await test("csv: RFC 4180 quotes, embedded delimiter, \"\" and newlines, CRLF, BOM", () => {
  const t = D.csv('﻿name,note,n\r\n"Smith, J","said ""hi""",1\r\nplain,"two\nlines",2\r\n');
  assert.deepEqual(plain(t.columns), ["name", "note", "n"]);
  assert.deepEqual(plain(t.rows), [["Smith, J", 'said "hi"', "1"], ["plain", "two\nlines", "2"]]);
  assert.deepEqual(plain(t.errors), []);
});

await test("csv: ragged rows and an open quote are errors with the line where the record starts", () => {
  const t = D.csv('a,b\n1\n2,3,4\n"open,5\n');
  assert.deepEqual(plain(t.errors.map((e) => e.line)), [2, 3, 4, 4]); // line 4: open quote, and so one field short
  assert.ok(/not closed/.test(t.errors.find((e) => e.line === 4 && /quote/.test(e.message)).message));
  assert.equal(t.rows.length, 3);
});

await test("csv: tab delimiter, max rows", () => {
  const t = D.csv("a\tb\n1\t2\n3\t4\n5\t6\n", { delimiter: "\t", max: 2 });
  assert.deepEqual(plain(t.rows), [["1", "2"], ["3", "4"]]); assert.equal(t.truncated, true);
});

await test("table: an array of objects, CloudTrail's { Records }, scalars", () => {
  const ct = D.table({ Records: [{ eventName: "GetObject", awsRegion: "eu-west-2" }, { eventName: "PutBucketCors", errorCode: "AccessDenied" }] });
  assert.deepEqual(plain(ct.columns), ["eventName", "awsRegion", "errorCode"]);
  assert.equal(ct.rows[1][2], "AccessDenied");
  assert.deepEqual(plain(D.table([1, 2]).columns), ["value"]);
  assert.equal(D.table([{ a: 1 }, { a: 2 }, { a: 3 }], { max: 2 }).truncated, true);
});

await test("limits: over the byte cap is TooLarge before any decoding", () => {
  for (const f of ["json", "jsonLines", "csv"]) assert.throws(() => D[f]("x".repeat(2048), { maxBytes: 1024 }), (e) => e.code === "TooLarge", f);
  assert.equal(D.limits.rows, 50000); assert.equal(D.limits.bytes, 50 * 1024 * 1024);
});

await test("hostile values come back as they are, and decode.js has no eval, Function or HTML", () => {
  const evil = '<script>alert(1)</script>';
  assert.equal(D.jsonLines(JSON.stringify({ path: evil }) + "\n").rows[0][0], evil);
  assert.equal(D.csv("path\n" + evil + "\n").rows[0][0], evil);
  assert.equal(D.json(JSON.stringify(evil)), evil);
  assert.ok(!/\beval\s*\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\./.test(src));
});

console.log(passed + " passed");
