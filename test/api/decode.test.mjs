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
const names = (t) => plain(t.columns.map((c) => c.name));
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

await test("gunzip: round trip with sizes, and the unpacked cap stops a bomb and says so", async () => {
  const body = "line\n".repeat(1000);
  const gz = new Uint8Array(gzipSync(body)), g = await D.gunzip(gz);
  assert.equal(D.text(g.bytes), body);
  assert.equal(g.packed, gz.length); assert.equal(g.unpacked, body.length); assert.equal(g.truncated.bytes, false);
  // A bomb: 2 MB of zeros packs to a few KB; with a 1 MB cap it stops at exactly 1 MB and says so.
  const bomb = new Uint8Array(gzipSync(Buffer.alloc(2 * 1024 * 1024))), b = await D.gunzip(bomb, { maxBytes: 1024 * 1024 });
  assert.equal(b.bytes.length, 1024 * 1024); assert.equal(b.unpacked, 1024 * 1024); assert.equal(b.truncated.bytes, true);
});

await test("the twin-style CloudTrail fixture: gunzip, sniff, json, table", async () => {
  const gz = new Uint8Array(readFileSync(new URL("../fixtures/trail.json.gz", import.meta.url)));
  assert.equal(D.sniff(gz, { name: "trail.json.gz" }), "gzip");
  const raw = (await D.gunzip(gz)).bytes;
  assert.equal(D.sniff(raw), "json");
  const t = D.table(D.json(D.text(raw)));
  assert.ok(t.rows.length > 0 && names(t).includes("eventName"), JSON.stringify(t.columns));
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
  assert.deepEqual(names(t), ["a", "b", "c", "value"]);
  assert.deepEqual(plain(t.rows), [[1, "x", null, null], [2, null, true, null], [null, null, null, 42]].map((r) => r.map((v) => v === null ? undefined : v)).map((r) => plain(r)));
  assert.equal(t.errors.length, 1); assert.equal(t.errors[0].line, 4);
  assert.deepEqual(plain(t.truncated), { rows: false, bytes: false, columns: false }); assert.equal(t.rowsRead, 4);
});

await test("jsonLines: max rows, then truncated", () => {
  const t = D.jsonLines('{"n":1}\n{"n":2}\n{"n":3}\n', { max: 2 });
  assert.equal(t.rows.length, 2); assert.deepEqual(plain(t.truncated), { rows: true, bytes: false, columns: false }); assert.equal(t.rowsRead, 2);
});

await test("csv: RFC 4180 quotes, embedded delimiter, \"\" and newlines, CRLF, BOM", () => {
  const t = D.csv('﻿name,note,n\r\n"Smith, J","said ""hi""",1\r\nplain,"two\nlines",2\r\n');
  assert.deepEqual(names(t), ["name", "note", "n"]);
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
  assert.deepEqual(plain(t.rows), [["1", "2"], ["3", "4"]]); assert.deepEqual(plain(t.truncated), { rows: true, bytes: false, columns: false });
  assert.equal(D.csv("a\n1\n2\n", { max: 2 }).truncated.rows, false, "exactly max rows is not truncated");
});

await test("table: an array of objects, CloudTrail's { Records }, scalars", () => {
  const ct = D.table({ Records: [{ eventName: "GetObject", awsRegion: "eu-west-2" }, { eventName: "PutBucketCors", errorCode: "AccessDenied" }] });
  assert.deepEqual(names(ct), ["eventName", "awsRegion", "errorCode"]);
  assert.equal(ct.rows[1][2], "AccessDenied");
  assert.deepEqual(names(D.table([1, 2])), ["value"]);
  assert.equal(D.table([{ a: 1 }, { a: 2 }, { a: 3 }], { max: 2 }).truncated.rows, true);
});

await test("limits: json() over the cap throws TooLarge; jsonLines and csv stop at the last whole line and say so", () => {
  assert.throws(() => D.json("x".repeat(2048), { maxBytes: 1024 }), (e) => e.code === "TooLarge");
  const jl = D.jsonLines('{"n":1}\n'.repeat(300), { maxBytes: 1000 });
  assert.equal(jl.rows.length, 125); assert.deepEqual(plain(jl.errors), []); assert.deepEqual(plain(jl.truncated), { rows: false, bytes: true, columns: false });
  const c = D.csv("a,b\n" + "1,2\n".repeat(300), { maxBytes: 100 });
  assert.equal(c.rows.length, 24); assert.deepEqual(plain(c.errors), []); assert.equal(c.truncated.bytes, true);
  // The cap falls inside a quoted field: that record is partial, not malformed, and is dropped quietly.
  const q = D.csv('a,b\n1,"x\ny"\n2,"' + "z".repeat(200) + '"\n', { maxBytes: 60 });
  assert.deepEqual(plain(q.rows), [["1", "x\ny"]]); assert.deepEqual(plain(q.errors), []); assert.equal(q.truncated.bytes, true);
  assert.equal(D.limits.rows, 50000); assert.equal(D.limits.bytes, 50 * 1024 * 1024);
});

await test("partial: gunzip cut mid-line, the last line is dropped as cut, not reported as bad data", async () => {
  const body = '{"n":1}\n'.repeat(200), g = await D.gunzip(new Uint8Array(gzipSync(body)), { maxBytes: 1003 });
  assert.equal(g.truncated.bytes, true);
  const noisy = D.jsonLines(D.text(g.bytes));
  assert.equal(noisy.errors.length, 1, "without partial the cut line reads as an error");
  const t = D.jsonLines(D.text(g.bytes), { partial: g.truncated.bytes });
  assert.equal(t.rows.length, 125); assert.deepEqual(plain(t.errors), []); assert.equal(t.truncated.bytes, true);
  const c = D.csv("a,b\n1,2\n3,", { partial: true });
  assert.deepEqual(plain(c.rows), [["1", "2"]]); assert.deepEqual(plain(c.errors), []); assert.equal(c.truncated.bytes, true);
  assert.equal(D.jsonLines('{"n":1}\n', { partial: true }).rows.length, 1, "a whole last line is kept");
});

await test("column hints from the first 200 rows: number, time, text", () => {
  const t = D.csv("n,t,s,mixed,empty\n1,2026-11-22T10:01:02Z,a,1,\n2.5,2026-11-22,b,x,\n-3e2,2026-11-22 10:01:02.123+01:00,c,2,\n");
  assert.deepEqual(plain(t.columns.map((c) => c.hint)), ["number", "time", "text", "text", "text"]);
  const j = D.jsonLines('{"bytes":10,"when":"2026-11-22T10:01:02Z","ok":true}\n{"bytes":20}\n');
  assert.deepEqual(plain(j.columns), [{ name: "bytes", hint: "number" }, { name: "when", hint: "time" }, { name: "ok", hint: "text" }]);
  const late = D.csv("v\n" + "1\n".repeat(200) + "word\n");
  assert.equal(late.columns[0].hint, "number", "row 201 is past the hint window");
});

await test("security R-019: __proto__ keys are columns, number hints do not backtrack, columns are capped", () => {
  const t = D.jsonLines('{"__proto__":{"polluted":1},"a":1}\n{"constructor":2}\n');
  assert.deepEqual(names(t), ["__proto__", "a", "constructor"]);
  assert.equal({}.polluted, undefined, "Object.prototype untouched");
  const slow = "1".repeat(20000) + "x", started = Date.now();
  assert.equal(D.csv("v\n" + slow + "\n").columns[0].hint, "text");
  assert.equal(D.jsonLines(JSON.stringify({ v: "1".repeat(5000) + "e" }) + "\n").columns[0].hint, "text");
  assert.ok(Date.now() - started < 200, "hints in " + (Date.now() - started) + " ms");
  const wide = Object.fromEntries(Array.from({ length: 600 }, (_, i) => ["c" + i, i]));
  const w = D.table([wide]);
  assert.equal(w.columns.length, 500); assert.equal(w.rows[0].length, 500); assert.equal(w.truncated.columns, true);
  const wc = D.csv(Array.from({ length: 600 }, (_, i) => "c" + i).join(",") + "\n" + Array.from({ length: 600 }, (_, i) => i).join(",") + "\n");
  assert.equal(wc.columns.length, 500); assert.equal(wc.truncated.columns, true); assert.deepEqual(plain(wc.errors), [], "a full-width row is not ragged");
});

await test("hostile values come back as they are, and decode.js has no eval, Function or HTML", () => {
  const evil = '<script>alert(1)</script>';
  assert.equal(D.jsonLines(JSON.stringify({ path: evil }) + "\n").rows[0][0], evil);
  assert.equal(D.csv("path\n" + evil + "\n").rows[0][0], evil);
  assert.equal(D.json(JSON.stringify(evil)), evil);
  assert.ok(!/\beval\s*\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\./.test(src));
});

console.log(passed + " passed");
