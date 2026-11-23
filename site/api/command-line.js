// CommandLine: the Command console's parser (ux.aws.a design 09), over the generated table site/api/commands.json. A
// fixed grammar and nothing else: no eval, no expressions, no templating, no repeat or wildcard, so one line is one
// bounded read through the API layer. No DOM, no network: it only turns a line into a call for the page to make.
//
//   CommandLine.parse(line, table, { previewCap }) -> { ok: true, row, params, options, call: { global, method, args } }
//       The page resolves call.global and call.method through its own fixed map of API objects, never window[...]
//       (security.aws.a; R-010).
//                                                   | { ok: false, code, message }
//   CommandLine.usage(row)                         -> "s3 listObjects <bucket> <region> [--prefix value] ..."
//   CommandLine.complete(text, table)              -> rows whose command starts with text (for completion)
//   CommandLine.expand(line, table, { region, bucketRegions })   design 09's alias table (ux.aws.a, land/ux.aws.a):
//       -> { ok: true, kind: "commands", steps: [{ words }] }   each step goes through parseWords; who gives two
//        | { ok: true, kind: "switch", console, bucket?, path? } | { ok: true, kind: "help", command? }
//        | { ok: true, kind: "plan", message }                   Command never runs a plan
//        | { ok: false, code: "needs-bucket-region", bucket, lookup: { words } }   run the lookup (s3 getBucket),
//          then expand again with bucketRegions[bucket] set to its region; a region is never guessed
//        | { ok: false, code: "needs-region", message: "Which region?" } | { ok: false, code, message }
//       A line whose first two words are a command is that command (kind "commands", one step), alias or not.
//   CommandLine.parseWords(words, table, opts)     -> as parse, for a step's words (no re-quoting)
//   CommandLine.ALIASES                            -> [{ alias, usage, expands: [command...] | [], summary }]
//
// Grammar: <service> <operationId> then the row's path parameters as words in order (all required, each checked
// against the contract's pattern where it gives one), then options "--name value" for the query parameters the row
// lists (booleans as "--name" alone; integers as whole numbers; each at most once). Words are split on spaces; "double
// quotes" keep spaces, with no escapes inside. s3 getObject's range is typed "--bytes start-end" (whole numbers, start
// not after end), its length capped at the S3 browser's preview size (security.aws.a R-017; site/s3.js LIMITS.preview,
// 256 KiB), passed as getObject's one range argument [start, end]; with no --bytes the range is [0, cap - 1], so one
// line can never pull a whole large object: "That range is over the preview limit. Use Files to read it
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
  function split(line) {
    line = String(line === undefined || line === null ? "" : line);
    if (line.length > MAX_LINE) return no("too-long", "That line is too long.");
    var w = words(line);
    if (w === null) return no("quote", "A quote is not closed, or not at the end of a word.");
    if (!w.length) return no("empty", "Type a command. Try help.");
    return w;
  }
  function parse(line, table, opts) {
    var w = split(line);
    return Array.isArray(w) ? parseWords(w, table, opts) : w;
  }
  function parseWords(w, table, opts) {
    var cap = (opts && opts.previewCap) || PREVIEW_CAP, rows = rowsOf(table);
    if (!Array.isArray(w) || !w.length || !w.every(function (x) { return typeof x === "string"; })) return no("empty", "Type a command. Try help.");
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
    // S3Api.getObject(bucket, region, key, range) takes range as one [start, end]. With no --bytes the range is the
    // first previewCap bytes, so no line fetches a whole object (security.aws.a, R-017).
    if (row.command === "s3 getObject") args.push(range || [0, cap - 1]);
    else if (row.options.length) args.push(options);
    return { ok: true, row: row, params: params, options: options, call: { global: row.global, method: row.operationId, args: args } };
  }
  function complete(text, table) {
    var t = String(text || "");
    return rowsOf(table).filter(function (r) { return r.command.indexOf(t) === 0; });
  }

  // ---- design 09's alias table (v1, fixed in code) ----
  // Each alias is one row of commands.json (who: two), a console switch, or help; it never loops, never takes a
  // wildcard (a bucket is a bucket name, S3's rules) and never spans accounts or regions (security.aws.a). A region comes from the thing itself (a bucket's,
  // from s3 getBucket), else the crumb's, else the page asks; never guessed.
  var REGION = /^[a-z]{2}(-[a-z]+)+-\d$/, BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, CONSOLES = { files: 1, map: 1, timeline: 1, desk: 1 };
  var ALIASES = [
    { alias: "help", usage: "help [<command>]", expands: [], summary: "The commands and aliases, or one command's usage" },
    { alias: "ls", usage: "ls [<bucket>[/<prefix>]]", expands: ["s3 listBuckets", "s3 listObjects"], summary: "The account's buckets, or one level of a bucket (region from s3 getBucket)" },
    { alias: "cat", usage: "cat <bucket>/<key>", expands: ["s3 getObject"], summary: "The first 256 KiB of an object (region from s3 getBucket)" },
    { alias: "open", usage: "open <bucket>[/<path>]", expands: [], summary: "Files at that place; no AWS call of its own" },
    { alias: "who", usage: "who <role>", expands: ["iam role", "iam attached"], summary: "A role and its attached policies (two reads, one card)" },
    { alias: "roles", usage: "roles", expands: ["iam roles"], summary: "One page of the account's roles" },
    { alias: "stacks", usage: "stacks", expands: ["cfn stacks"], summary: "One page of the region's stacks" },
    { alias: "stack", usage: "stack <name>", expands: ["cfn stack"], summary: "One stack with its parameters and outputs" },
    { alias: "events", usage: "events <name>", expands: ["cfn events"], summary: "One page of a stack's events" },
    { alias: "fns", usage: "fns", expands: ["lambda functions"], summary: "One page of the region's functions" },
    { alias: "streams", usage: "streams", expands: ["firehose streams"], summary: "One page of the region's delivery streams" },
    { alias: "cdn", usage: "cdn", expands: ["cloudfront distributions"], summary: "One page of the account's distributions (global)" },
    { alias: "logs", usage: "logs <group> [options of logs events]", expands: ["logs events"], summary: "The newest events of a log group" },
    { alias: "files", usage: "files", expands: [], summary: "Switch to Files" }, { alias: "map", usage: "map", expands: [], summary: "Switch to Map" },
    { alias: "timeline", usage: "timeline", expands: [], summary: "Switch to Timeline" }, { alias: "desk", usage: "desk", expands: [], summary: "Switch to Desk" }
  ];
  function own(map, k) { return map && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined; }
  function expand(line, table, ctx) {
    ctx = ctx || {};
    var w = split(line);
    if (!Array.isArray(w)) return w;
    var rows = rowsOf(table), head = w[0], rest = w.slice(1);
    if (w.length >= 2 && rows.some(function (r) { return r.command === w[0] + " " + w[1]; })) return { ok: true, kind: "commands", steps: [{ words: w }] };
    var crumb = typeof ctx.region === "string" && REGION.test(ctx.region) ? ctx.region : null;
    var a = ALIASES.filter(function (x) { return x.alias === head; })[0];
    var usageOf = function () { return no("arity", "Usage: " + a.usage); };
    var regional = function (command, more) {
      if (!crumb) return no("needs-region", "Which region?");
      return { ok: true, kind: "commands", steps: [{ words: command.split(" ").concat([crumb], more || []) }] };
    };
    // <bucket>[/<rest>]: the bucket is everything before the first "/"; its region only from s3 getBucket.
    var place = function (word) {
      var i = word.indexOf("/"), b = i < 0 ? word : word.slice(0, i);
      return BUCKET.test(b) ? { bucket: b, path: i < 0 ? "" : word.slice(i + 1) } : null;
    };
    var bucketRegion = function (b) {
      var r = own(ctx.bucketRegions, b);
      return typeof r === "string" && REGION.test(r) ? r : null;
    };
    var needBucket = function (b) { return { ok: false, code: "needs-bucket-region", bucket: b, lookup: { words: ["s3", "getBucket", b] }, message: "Looking up " + b + "'s region." }; };
    if (head === "plan") return { ok: true, kind: "plan", message: "No plan for that yet. Plans are written by aws.c and approved in Desk." };
    if (!a) return no("unknown-command", "Not a command. Try help.");
    switch (head) {
      case "help":
        if (rest.length > 2) return usageOf();
        return { ok: true, kind: "help", command: rest.length ? rest.join(" ") : null };
      case "files": case "map": case "timeline": case "desk":
        return rest.length ? usageOf() : { ok: true, kind: "switch", console: head };
      case "open": {
        var o = rest.length === 1 && place(rest[0]);
        return o ? { ok: true, kind: "switch", console: "files", bucket: o.bucket, path: o.path } : usageOf();
      }
      case "ls": {
        if (!rest.length) return { ok: true, kind: "commands", steps: [{ words: ["s3", "listBuckets"] }] };
        var l = rest.length === 1 && place(rest[0]);
        if (!l) return usageOf();
        var lr = bucketRegion(l.bucket);
        if (!lr) return needBucket(l.bucket);
        return { ok: true, kind: "commands", steps: [{ words: ["s3", "listObjects", l.bucket, lr].concat(l.path ? ["--prefix", l.path] : [], ["--delimiter", "/"]) }] };
      }
      case "cat": {
        var c = rest.length === 1 && place(rest[0]);
        if (!c || !c.path) return usageOf();
        var cr = bucketRegion(c.bucket);
        if (!cr) return needBucket(c.bucket);
        return { ok: true, kind: "commands", steps: [{ words: ["s3", "getObject", c.bucket, cr, c.path] }] };
      }
      case "who":
        return rest.length === 1 ? { ok: true, kind: "commands", steps: [{ words: ["iam", "role", rest[0]] }, { words: ["iam", "attached", rest[0]] }] } : usageOf();
      case "roles": return rest.length ? usageOf() : { ok: true, kind: "commands", steps: [{ words: ["iam", "roles"] }] };
      case "cdn": return rest.length ? usageOf() : { ok: true, kind: "commands", steps: [{ words: ["cloudfront", "distributions"] }] };
      case "stacks": return rest.length ? usageOf() : regional("cfn stacks");
      case "fns": return rest.length ? usageOf() : regional("lambda functions");
      case "streams": return rest.length ? usageOf() : regional("firehose streams");
      case "stack": return rest.length === 1 ? regional("cfn stack", rest) : usageOf();
      case "events": return rest.length === 1 ? regional("cfn events", rest) : usageOf();
      case "logs": {
        if (!rest.length || rest[0].indexOf("--") === 0) return usageOf();
        var opts = rest.slice(1);
        return regional("logs events", [rest[0]].concat(opts.indexOf("--newest") < 0 ? ["--newest"] : [], opts));
      }
    }
    return no("unknown-command", "Not a command. Try help.");
  }
  function completeAlias(text) {
    var t = String(text || "");
    return ALIASES.filter(function (x) { return x.alias.indexOf(t) === 0; });
  }
  root.CommandLine = { parse: parse, parseWords: parseWords, usage: usage, complete: complete, expand: expand, completeAlias: completeAlias,
    ALIASES: ALIASES, CONSOLES: Object.keys(CONSOLES), PREVIEW_CAP: PREVIEW_CAP };
})(typeof window !== "undefined" ? window : globalThis);
