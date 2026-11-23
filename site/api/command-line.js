// CommandLine: the Command console's parser (ux.aws.a design 09), over the generated table site/api/commands.json. A
// fixed grammar and nothing else: no eval, no expressions, no templating, no repeat or wildcard, so one line is one
// bounded read through the API layer. No DOM, no network: it only turns a line into a call for the page to make.
//
//   CommandLine.parse(line, table, { previewCap }) -> { ok: true, row, params, options, call: { global, method, args } }
//                                                   | { ok: false, code, message }
//   CommandLine.usage(row)                         -> "s3 listObjects <bucket> <region> [--prefix value] ..."
//   CommandLine.complete(text, table)              -> rows whose command starts with text (for completion)
//
// Grammar: <service> <operationId> then the row's path parameters as words in order (all required, each checked
// against the contract's pattern where it gives one), then options "--name value" for the query parameters the row
// lists (booleans as "--name" alone; integers as whole numbers; each at most once). Words are split on spaces; "double
// quotes" keep spaces, with no escapes inside. s3 getObject's range is typed "--bytes start-end" (whole numbers, start
// not after end), its length capped at the S3 browser's preview size (security.aws.a R-017; site/s3.js LIMITS.preview,
// 256 KiB), so one line cannot pull a whole large object: "That range is over the preview limit. Use Files to read it
// in parts." table is the parsed commands.json ({ commands }) or its array. Values are passed as given; the API layer
// encodes them into the request and checks them again.
(function (root) {
  "use strict";
  var MAX_LINE = 2000, PREVIEW_CAP = 256 * 1024;
  function no(code, message) { return { ok: false, code: code, message: message }; }
  function rowsOf(table) { return Array.isArray(table) ? table : table && Array.isArray(table.commands) ? table.commands : []; }
  function words(line) {
    var out = [], i = 0, n = line.length;
    while (i < n) {
      while (i < n && /\s/.test(line[i])) i++;
      if (i >= n) break;
      if (line[i] === "\"") {
        var j = line.indexOf("\"", i + 1);
        if (j < 0) return null;
        out.push(line.slice(i + 1, j)); i = j + 1;
        if (i < n && !/\s/.test(line[i])) return null; // a quote must end a word
      } else {
        var k = i; while (k < n && !/\s/.test(line[k])) { if (line[k] === "\"") return null; k++; }
        out.push(line.slice(i, k)); i = k;
      }
    }
    return out;
  }
  function usage(row) {
    var u = row.command + row.params.map(function (p) { return " <" + p.name + ">"; }).join("");
    row.options.forEach(function (o) {
      if (row.command === "s3 getObject" && o.name === "range") u += " [--bytes start-end]";
      else u += " [--" + o.name + (o.type === "boolean" ? "" : " value") + "]";
    });
    return u;
  }
  function parse(line, table, opts) {
    var cap = (opts && opts.previewCap) || PREVIEW_CAP, rows = rowsOf(table);
    line = String(line === undefined || line === null ? "" : line);
    if (line.length > MAX_LINE) return no("too-long", "That line is too long.");
    var w = words(line);
    if (w === null) return no("quote", "A quote is not closed, or not at the end of a word.");
    if (!w.length) return no("empty", "Type a command. Try help.");
    var row = w.length >= 2 ? rows.filter(function (r) { return r.command === w[0] + " " + w[1]; })[0] : null;
    if (!row) return no("unknown-command", "Not a command. Try help.");
    var rest = w.slice(2), params = [], options = {}, range = null;
    while (rest.length && rest[0].indexOf("--") !== 0) params.push(rest.shift());
    if (params.length !== row.params.length) return no("arity", "Usage: " + usage(row));
    for (var i = 0; i < row.params.length; i++) {
      var p = row.params[i];
      if (!params[i]) return no("bad-param", "<" + p.name + "> is empty. Usage: " + usage(row));
      if (p.pattern && !new RegExp(p.pattern).test(params[i])) return no("bad-param", "<" + p.name + "> is not in the form the API takes.");
    }
    while (rest.length) {
      var flag = rest.shift();
      if (!/^--[A-Za-z][A-Za-z0-9]*$/.test(flag)) return no("bad-option", "Options are --name value, after the parameters. Usage: " + usage(row));
      var name = flag.slice(2);
      if (row.command === "s3 getObject" && name === "bytes") {
        if (range) return no("duplicate-option", "--bytes is given twice.");
        var v = rest.shift(), m = /^(\d{1,15})-(\d{1,15})$/.exec(v || "");
        if (!m) return no("bad-range", "--bytes takes start-end, two whole numbers.");
        var s = +m[1], e = +m[2];
        if (s > e) return no("bad-range", "In --bytes start-end, start must not be after end.");
        if (e - s + 1 > cap) return no("range-over-cap", "That range is over the preview limit. Use Files to read it in parts.");
        range = [s, e]; continue;
      }
      var o = row.options.filter(function (x) { return x.name === name && !(row.command === "s3 getObject" && x.name === "range"); })[0];
      if (!o) return no("unknown-option", "--" + name + " is not an option of " + row.command + ". Usage: " + usage(row));
      if (Object.prototype.hasOwnProperty.call(options, name)) return no("duplicate-option", "--" + name + " is given twice.");
      if (o.type === "boolean") { options[name] = true; continue; }
      var val = rest.shift();
      if (val === undefined || val.indexOf("--") === 0) return no("missing-value", "--" + name + " needs a value.");
      if (o.type === "integer") { if (!/^\d{1,9}$/.test(val)) return no("bad-number", "--" + name + " takes a whole number."); options[name] = +val; }
      else options[name] = val;
    }
    var args = params.slice();
    if (row.command === "s3 getObject") { if (range) args.push(range[0], range[1]); }
    else if (row.options.length) args.push(options);
    return { ok: true, row: row, params: params, options: options, call: { global: row.global, method: row.operationId, args: args } };
  }
  function complete(text, table) {
    var t = String(text || "");
    return rowsOf(table).filter(function (r) { return r.command.indexOf(t) === 0; });
  }
  root.CommandLine = { parse: parse, usage: usage, complete: complete, PREVIEW_CAP: PREVIEW_CAP };
})(typeof window !== "undefined" ? window : globalThis);
