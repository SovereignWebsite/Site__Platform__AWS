// Tests for docs/cloudtrail/reader/ct-dropin.js with File objects as a browser would hand them over (Node 22 has
// File, Blob.stream and DecompressionStream). Synthetic records only. No network.
// Run from the repository root: node docs/cloudtrail/reader/ct-dropin.test.mjs
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b)); };
globalThis.window = globalThis;
for (const f of ["./ct-reader.js", "./ct-alarms.js", "../scenarios/demo-packs.js", "./ct-dropin.js"]) new Function(readFileSync(new URL(f, import.meta.url), "utf8"))();
const R = globalThis.CloudTrailReader, D = globalThis.CloudTrailDropIn, S = globalThis.CloudTrailScenarios, AL = globalThis.CloudTrailAlarms;
let cases = 0; const check = (a, b, m) => { cases++; eq(a, b, m); };
const file = (name, data) => new File([data], name);
const json = (o) => JSON.stringify(o);

// the attack pack as a real trail delivers it: split into gzip files by region, plus a duplicate file
const atk = S.demoPack("attack").Records;
const byRegion = (r) => atk.filter((x) => x.awsRegion === r);
const files = [
  file("111122223333_CloudTrail_eu-west-2_20261122T1000Z_a.json.gz", gzipSync(json({ Records: byRegion("eu-west-2") }))),
  file("111122223333_CloudTrail_us-east-1_20261122T1000Z_b.json.gz", gzipSync(json({ Records: byRegion("us-east-1") }))),
  file("copy-of-b.json.gz", gzipSync(json({ Records: byRegion("us-east-1") })))
];
let out = await D.readFiles(files);
check(out.events.length, atk.length, "every event once across files");
check(out.skipped, byRegion("us-east-1").length, "the copied file's events are duplicates");
check(out.files.map((f) => [f.gzip, f.format, f.error]), [[true, "records", null], [true, "records", null], [true, "records", null]], "per-file report");
check(AL.run(out.events).map((a) => a.rule), S.demoPackAlarms.attack, "the dropped trail gives the attack's alarms");
check(out.events[0].time >= out.events[out.events.length - 1].time, true, "newest first");

// other shapes: plain JSON with a .gz name and no gzip, LookupEvents, one record per line, a bare array, empty
const one = atk.slice(0, 3);
out = await D.readFiles([
  file("misnamed.json.gz", json({ Records: one.slice(0, 1) })),
  file("lookup.json", json({ Events: one.slice(1, 2).map((r) => ({ EventId: r.eventID, CloudTrailEvent: json(r) })) })),
  file("lines.jsonl", one.slice(2, 3).map(json).join("\n") + "\n"),
  file("array.json", json([])),
  file("empty.json", "")
]);
check(out.files.map((f) => [f.gzip, f.format, f.events]), [[false, "records", 1], [false, "lookup-events", 1], [false, "lines", 1], [false, "array", 0], [false, "empty", 0]], "shapes found by content, not name");
check(out.events.length, 3, "three events");

// refusals: CSV, not CloudTrail, damaged gzip, over the size limits, too many files; the good file is still read
const good = file("good.json", json({ Records: one.slice(0, 1) }));
out = await D.readFiles([
  file("event-history.csv", "Event ID,Event time,User name,Event name,Resource type\nabc,2026-11-22T10:00:00Z,x,GetRole,\n"),
  file("other.json", json({ hello: "world" })),
  file("damaged.json.gz", gzipSync(json({ Records: one })).subarray(0, 40)),
  file("huge.json", "x".repeat(2048)),
  good
], { fileBytes: 1024 });
check(out.files.map((f) => f.error === null), [false, false, false, false, true], "only the good file is read");
check(/CSV/.test(out.files[0].error) && /not a CloudTrail/.test(out.files[1].error) && /damaged gzip/.test(out.files[2].error) && /larger than 1 KB/.test(out.files[3].error), true, "each refusal says why");
check(out.events.length, 1, "the good file's event");
// a gzip bomb: small as given, large once unzipped
out = await D.readFiles([file("bomb.json.gz", gzipSync(" ".repeat(5 * 1024 * 1024)))], { unzippedBytes: 1024 * 1024 });
check(/once unzipped/.test(out.files[0].error), true, "unzipped size is capped while reading");
out = await D.readFiles([good, good, good], { files: 2 });
check([out.files.length, out.truncated, !!out.files[2].error], [3, true, true], "file count limit");
out = await D.readFiles([file("big.json", json({ Records: atk }))], { events: 10 });
check([out.events.length, out.truncated], [10, true], "event limit");

// privacy: nothing in the drop-in calls the network
const src = readFileSync(new URL("./ct-dropin.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
check(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|navigator\.|localStorage|indexedDB/.test(src), false, "no network or storage calls in the code");
console.log("ok ct-dropin: " + cases + " cases (gzip by content, 4 shapes, duplicates across files, CSV, damaged gzip, size, unzipped size, file and event limits, no network)");
