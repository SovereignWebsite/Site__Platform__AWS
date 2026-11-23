// Drop-in of a user's own CloudTrail dump: files picked or dropped in the page are read in the browser, never
// uploaded. Reference implementation by cloudtrail.aws.a, kept in docs/ until a code path is agreed. It calls no
// network API: it reads File/Blob objects with stream() and DecompressionStream, and hands the parsed JSON to
// CloudTrailReader (ct-reader.js). The page owns the file picker and the drop zone; this is what they call.
//
// Accepts per file: a trail's delivery file (.json.gz or .json, { Records }), a LookupEvents output, a bare array,
// or one record per line; gzip is found by its magic bytes, not by the name. CSV is reported, not read.
// Limits, so a big or hostile file cannot hang or exhaust the tab (all can be lowered by opts):
// at most 2,000 files; 50 MB per file as given; 200 MB per file once unzipped; 1 GB unzipped in all;
// 2,000,000 events in all. A file over a limit is reported and skipped; the others are still read.
(function (root) {
  "use strict";
  var MB = 1024 * 1024;
  var LIMITS = { files: 2000, fileBytes: 50 * MB, unzippedBytes: 200 * MB, totalBytes: 1024 * MB, events: 2000000 };

  function Limit(message) { this.message = message; }
  function fmtSize(n) { return n >= MB ? Math.round(n / MB) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  // Reads a stream to text, stopping once it passes max bytes (counted after unzipping).
  function readCapped(stream, max) {
    var reader = stream.getReader(), chunks = [], size = 0;
    function next() {
      return reader.read().then(function (r) {
        if (r.done) return;
        size += r.value.length;
        if (size > max) { try { reader.cancel(); } catch (e) { /* none */ } throw new Limit("larger than " + fmtSize(max) + " once unzipped"); }
        chunks.push(r.value);
        return next();
      });
    }
    return next().then(function () {
      var all = new Uint8Array(size), off = 0;
      chunks.forEach(function (c) { all.set(c, off); off += c.length; });
      return { text: new TextDecoder("utf-8", { fatal: false }).decode(all), size: size };
    });
  }
  function head(file, n) { return file.slice(0, n).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }

  function parse(text) {
    var t = text.replace(/^﻿/, "").trim();
    if (!t) return { input: [], kind: "empty" };
    if (t[0] === "{" || t[0] === "[") {
      try {
        var j = JSON.parse(t);
        if (j && !Array.isArray(j) && j.eventName && !j.Records && !j.Events) return { input: t, kind: "lines" }; // a single record: one line
        return { input: j, kind: "json" };
      } catch (e) { if (t[0] === "[") throw new Error("not valid JSON: " + e.message); }
    }
    if (/^[^\n{[]*,[^\n]*\n/.test(t) && /eventname|event name|event id/i.test(t.split("\n")[0])) throw new Error("a CSV export; download the JSON instead");
    return { input: t, kind: "lines" }; // one record per line; the reader parses and skips what is not a record
  }

  // files: an array (or FileList) of File/Blob with name and size. Returns a promise of
  // { events, skipped, files: [{ name, size, unzipped, gzip, format, events, skipped, error }], truncated }.
  function readFiles(files, opts) {
    var L = Object.assign({}, LIMITS, opts || {}), list = Array.prototype.slice.call(files || []), report = [], reads = [], total = 0, events = 0, truncated = false;
    var over = list.length > L.files ? list.slice(L.files) : [];
    if (over.length) { truncated = true; list = list.slice(0, L.files); }
    var chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () {
        var r = { name: f.name || "(unnamed)", size: f.size, unzipped: null, gzip: false, format: null, events: 0, skipped: 0, error: null }, unzipping = false;
        report.push(r);
        if (f.size > L.fileBytes) { r.error = "larger than " + fmtSize(L.fileBytes) + "; not read"; return; }
        if (total >= L.totalBytes || events >= L.events) { r.error = "the drop's limit is reached; not read"; truncated = true; return; }
        return head(f, 2).then(function (h) {
          r.gzip = h.length === 2 && h[0] === 0x1f && h[1] === 0x8b;
          var s = f.stream();
          if (r.gzip) { s = s.pipeThrough(new DecompressionStream("gzip")); unzipping = true; }
          return readCapped(s, Math.min(L.unzippedBytes, L.totalBytes - total));
        }).then(function (t) {
          unzipping = false; r.unzipped = t.size; total += t.size;
          var p = parse(t.text);
          var rd = root.CloudTrailReader.read(p.input);
          if (!rd.format && p.kind !== "empty") throw new Error("not a CloudTrail file (no Records, Events or records)");
          r.format = p.kind === "empty" ? "empty" : rd.format; r.skipped = rd.skipped;
          if (events + rd.events.length > L.events) { rd.events = rd.events.slice(0, L.events - events); truncated = true; r.error = "the drop's event limit is reached; the rest of this file is not read"; }
          r.events = rd.events.length; events += rd.events.length;
          reads.push(rd);
        }).catch(function (e) {
          r.error = e instanceof Limit ? e.message + "; not read" : unzipping ? "a damaged gzip file; not read" : String((e && e.message) || e);
        });
      });
    });
    return chain.then(function () {
      over.forEach(function (f) { report.push({ name: f.name, size: f.size, unzipped: null, gzip: false, format: null, events: 0, skipped: 0, error: "over " + L.files + " files; not read" }); }); // the report keeps the order given
      var m = root.CloudTrailReader.merge(reads);
      return { events: m.events, skipped: m.skipped, files: report, truncated: truncated };
    });
  }

  root.CloudTrailDropIn = { readFiles: readFiles, limits: LIMITS };
})(typeof window !== "undefined" ? window : globalThis);
