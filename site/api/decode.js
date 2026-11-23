// Decode: bytes in, typed results out (design 03, docs/architecture/, part 2). No DOM, no network, runs in Node.
// Lifted from site/s3.js (gzip, JSON, JSON Lines) and widened to CSV and tables, so every console reads files
// the same way and the limits are enforced once.
//
//   Decode.sniff(bytes, { name, contentType })  -> "gzip" | "zip" | "json" | "jsonl" | "csv" | "text" | "binary"
//   Decode.gunzip(bytes, { maxBytes })          -> Promise<{ bytes, packed, unpacked, truncated: { bytes } }>
//   Decode.text(bytes)                          -> string (UTF-8, a leading BOM dropped)
//   Decode.json(text)                           -> value; throws an Error with .line and .column
//   Decode.jsonLines(text, { max, maxBytes })   -> table
//   Decode.csv(text, { max, maxBytes, delimiter }) -> table   (RFC 4180)
//   Decode.table(value, { max })                -> table   (an array of objects, or CloudTrail's { Records })
//
//   table = { columns: [{ name, hint: "number" | "time" | "text" }], rows: [[...]], errors: [{ line, message }],
//             truncated: { rows, bytes }, rowsRead }
//
// Rows are arrays aligned to columns (a missing value is undefined); columns in order of first appearance, with
// a hint from the first 200 rows. A bad line is an errors entry, not a stop. Limits (design 03, refinement 5):
// max rows (default 50 000) and a byte cap (default 50 MB, unpacked). At either, gunzip, jsonLines and csv stop
// and return what they have, with truncated saying which, so a page can say "showing the first 50 MB";
// rowsRead counts the input rows looked at (good and bad). json() cannot be partial: over the cap it throws an
// Error with .code "TooLarge". gunzip cut at the cap may end mid-line; a table read from it reports that last
// line as an error. Values are returned as they are: never evaluated, never turned into HTML.
(function (root) {
  "use strict";
  var MAX_ROWS = 50000, MAX_BYTES = 50 * 1024 * 1024, SAMPLE = 65536;

  function fail(code, message, extra) {
    var e = new Error(code + ": " + message); e.code = code;
    for (var k in extra || {}) e[k] = extra[k];
    return e;
  }
  function capBytes(n, max) {
    max = max || MAX_BYTES;
    if (n > max) throw fail("TooLarge", n + " bytes is over the " + max + " byte limit");
  }
  function capText(s, max) { capBytes(s.length, max); } // UTF-16 units: a lower bound on the UTF-8 size, close enough for a cap
  // Text over the cap: keep what fits, up to its last whole line.
  function cut(s, max) {
    max = max || MAX_BYTES;
    if (s.length <= max) return { text: s, cut: false };
    var part = s.slice(0, max), nl = part.lastIndexOf("\n");
    return { text: nl >= 0 ? part.slice(0, nl + 1) : part, cut: true };
  }

  function text(bytes) {
    var s = new TextDecoder("utf-8").decode(bytes);
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  function isGzip(u8) { return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b; }
  function isZip(u8) { return u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 3 || u8[2] === 5) && (u8[3] === 4 || u8[3] === 6); }

  function sniff(bytes, hint) {
    hint = hint || {};
    var name = (hint.name || "").toLowerCase(), type = (hint.contentType || "").toLowerCase();
    if (isGzip(bytes)) return "gzip";
    if (isZip(bytes)) return "zip";
    var head = text(bytes.subarray(0, SAMPLE));
    if (/[\x00-\x08\x0E-\x1F]/.test(head.slice(0, 4096))) return "binary";
    if (/\.(jsonl|ndjson)$/.test(name) || /ndjson|jsonl|json-seq/.test(type)) return "jsonl";
    if (/\.(csv|tsv)$/.test(name) || /text\/(csv|tab-separated-values)/.test(type)) return "csv";
    var t = head.replace(/^\s+/, "");
    if (t[0] === "[") return "json";
    if (t[0] === "{") {
      // One JSON value per line, at least two lines, the first whole on its own: JSON Lines. Otherwise JSON.
      var lines = t.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length > 1) { try { JSON.parse(lines[0]); return "jsonl"; } catch (e) { /* a multi-line JSON value */ } }
      return "json";
    }
    if (/json/.test(type) || /\.(json|geojson)$/.test(name)) return "json";
    return "text";
  }

  function gunzip(bytes, opts) {
    var max = (opts && opts.maxBytes) || MAX_BYTES;
    var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(), parts = [], size = 0;
    function done(truncated) {
      var out = new Uint8Array(size), at = 0;
      parts.forEach(function (p) { out.set(p, at); at += p.length; });
      return { bytes: out, packed: bytes.length, unpacked: size, truncated: { bytes: truncated } };
    }
    function next() {
      return reader.read().then(function (r) {
        if (r.done) return done(false);
        var room = max - size;
        if (r.value.length > room) {
          if (room > 0) { parts.push(r.value.subarray(0, room)); size += room; }
          return reader.cancel().then(function () { return done(true); }, function () { return done(true); });
        }
        parts.push(r.value); size += r.value.length;
        return next();
      });
    }
    return next();
  }

  // Line and column (1-based) of a character offset.
  function where(s, pos) {
    var line = 1, col = 1;
    for (var i = 0; i < pos && i < s.length; i++) { if (s[i] === "\n") { line++; col = 1; } else col++; }
    return { line: line, column: col };
  }
  // Where JSON.parse stopped: not every engine says (V8 in Node 22 often gives only a snippet), so on the error
  // path only, a small scanner walks the grammar and returns the offset of the first character that breaks it.
  function badOffset(s) {
    var i = 0;
    function ws() { while (i < s.length && " \t\n\r".indexOf(s[i]) >= 0) i++; }
    function lit(w) { if (s.substr(i, w.length) !== w) throw i; i += w.length; }
    function str() {
      i++;
      while (i < s.length && s[i] !== "\"") {
        if (s[i] === "\\") { i++; if (s[i] === "u") { if (!/^[0-9a-fA-F]{4}$/.test(s.substr(i + 1, 4))) throw i; i += 4; } else if ("\"\\/bfnrt".indexOf(s[i]) < 0) throw i; }
        else if (s.charCodeAt(i) < 0x20) throw i;
        i++;
      }
      if (i >= s.length) throw i;
      i++;
    }
    function num() { var m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i)); if (!m) throw i; i += m[0].length; }
    function value() {
      ws(); var c = s[i];
      if (c === "{") { i++; ws(); if (s[i] === "}") { i++; return; } for (;;) { ws(); if (s[i] !== "\"") throw i; str(); ws(); if (s[i] !== ":") throw i; i++; value(); ws(); if (s[i] === ",") { i++; continue; } if (s[i] === "}") { i++; return; } throw i; } }
      if (c === "[") { i++; ws(); if (s[i] === "]") { i++; return; } for (;;) { value(); ws(); if (s[i] === ",") { i++; continue; } if (s[i] === "]") { i++; return; } throw i; } }
      if (c === "\"") return str();
      if (c === "t") return lit("true"); if (c === "f") return lit("false"); if (c === "n") return lit("null");
      return num();
    }
    try { value(); ws(); if (i < s.length) throw i; return s.length; } catch (at) { if (typeof at === "number") return at; throw at; }
  }
  function json(s, opts) {
    capText(s, opts && opts.maxBytes);
    try { return JSON.parse(s); }
    catch (e) {
      var m = /position (\d+)/.exec(e.message), lc = /line (\d+) column (\d+)/.exec(e.message);
      var at = lc ? { line: +lc[1], column: +lc[2] } : where(s, m ? +m[1] : badOffset(s));
      throw fail("BadJSON", e.message.replace(/\s*\(line \d+ column \d+\)/, "") + " (line " + at.line + ", column " + at.column + ")", at);
    }
  }

  // A column's hint from its first 200 rows: number, time (ISO 8601 date or date-time), or text.
  var TIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/, NUMBER = /^\s*-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;
  function hints(names, rows) {
    return names.map(function (name, c) {
      var seen = 0, num = 0, time = 0;
      for (var r = 0; r < rows.length && r < 200; r++) {
        var v = rows[r][c];
        if (v === undefined || v === null || v === "") continue;
        seen++;
        if (typeof v === "number" || (typeof v === "string" && NUMBER.test(v))) num++;
        else if (typeof v === "string" && TIME.test(v)) time++;
      }
      return { name: name, hint: seen && num === seen ? "number" : seen && time === seen ? "time" : "text" };
    });
  }
  function result(names, rows, errors, truncRows, truncBytes, rowsRead) {
    errors.sort(function (a, b) { return a.line - b.line; });
    return { columns: hints(names, rows), rows: rows, errors: errors, truncated: { rows: !!truncRows, bytes: !!truncBytes }, rowsRead: rowsRead };
  }

  // Objects to aligned rows; columns in order of first appearance. A value that is not a plain object is one
  // column, "value".
  function tabulate(values) {
    var names = [], index = {};
    function col(k) { if (!(k in index)) { index[k] = names.length; names.push(k); } return index[k]; }
    var keyed = values.map(function (v) {
      if (v && typeof v === "object" && !Array.isArray(v)) { Object.keys(v).forEach(col); return v; }
      col("value"); return { value: v };
    });
    return { names: names, rows: keyed.map(function (v) { var r = new Array(names.length); for (var k in v) r[index[k]] = v[k]; return r; }) };
  }

  function jsonLines(s, opts) {
    opts = opts || {};
    var c = cut(s, opts.maxBytes), max = opts.max || MAX_ROWS, values = [], errors = [], read = 0, truncRows = false, lines = c.text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/\r$/, "");
      if (!l.trim()) continue;
      if (values.length >= max) { truncRows = true; break; }
      read++;
      try { values.push(JSON.parse(l)); } catch (e) { errors.push({ line: i + 1, message: e.message }); }
    }
    var t = tabulate(values);
    return result(t.names, t.rows, errors, truncRows, c.cut, read);
  }

  // RFC 4180: the first record names the columns; quoted fields may hold the delimiter, "" and newlines.
  function csv(s, opts) {
    opts = opts || {};
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    var c = cut(s, opts.maxBytes); s = c.text;
    var d = opts.delimiter || ",", max = opts.max || MAX_ROWS;
    var records = [], errors = [], field = "", rec = [], quoted = false, line = 1, start = 1, i = 0, n = s.length, truncRows = false;
    function endField() { rec.push(field); field = ""; }
    function endRecord() {
      endField();
      if (!(rec.length === 1 && rec[0] === "")) records.push({ line: start, values: rec });
      rec = []; start = line;
    }
    while (i < n) {
      var ch = s[i];
      if (quoted) {
        if (ch === "\"") { if (s[i + 1] === "\"") { field += "\""; i += 2; continue; } quoted = false; i++; continue; }
        if (ch === "\n") line++;
        field += ch; i++; continue;
      }
      if (ch === "\"" && field === "") { quoted = true; i++; continue; }
      if (ch === d) { endField(); i++; continue; }
      if (ch === "\r" && s[i + 1] === "\n") { i++; continue; }
      if (ch === "\n") { line++; endRecord(); i++; if (records.length > max) { truncRows = /\S/.test(s.slice(i)); break; } continue; }
      field += ch; i++;
    }
    if (i >= n) {
      // A record the byte cap cut inside a quoted field is partial, not malformed: drop it quietly.
      if (quoted && c.cut) { rec = []; field = ""; }
      else {
        if (quoted) errors.push({ line: start, message: "a quoted field is not closed" });
        if (field !== "" || rec.length) endRecord();
      }
    }
    if (!records.length) return result([], [], errors, false, c.cut, 0);
    var names = records[0].values, rows = [];
    for (var r = 1; r < records.length && rows.length < max; r++) {
      var v = records[r].values;
      if (v.length !== names.length) errors.push({ line: records[r].line, message: v.length + " fields where the header has " + names.length });
      var row = new Array(names.length);
      for (var k = 0; k < names.length; k++) row[k] = v[k];
      rows.push(row);
    }
    if (records.length - 1 > max) truncRows = true;
    return result(names, rows, errors, truncRows, c.cut, rows.length);
  }

  function table(value, opts) {
    var max = (opts && opts.max) || MAX_ROWS;
    var list = Array.isArray(value) ? value : value && Array.isArray(value.Records) ? value.Records : [value];
    var t = tabulate(list.slice(0, max));
    return result(t.names, t.rows, [], list.length > max, false, t.rows.length);
  }

  root.Decode = { sniff: sniff, gunzip: gunzip, text: text, json: json, jsonLines: jsonLines, csv: csv, table: table,
    limits: { rows: MAX_ROWS, bytes: MAX_BYTES } };
})(typeof window !== "undefined" ? window : globalThis);
