// "Summarise these logs": the view of the extract (EX-1), for a folder of CloudFront log files.
// Design: docs/data/2026-11-23__01-extract-workflow-first-design.md, "What the first-time user sees".
// Built by data.aws.a. Needs site/data/extract.js. Log values are attacker-controlled, so every value is
// set as text (textContent), never as HTML; styles are set through the CSSOM with the page's own colours.
// One call for the S3 browser: LogView.run(box, objects, fetchBytes) where objects are the listing's
// { Key, Size } and fetchBytes(key) resolves to the object's bytes. Nothing leaves the page; nothing is kept.
(function (root) {
  "use strict";
  var X = root.LogExtract;

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) Object.keys(style).forEach(function (k) { e.style[k] = style[k]; });
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function kb(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  var CARD = { border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px", background: "var(--panel)" };
  var LINK = { background: "none", border: "0", padding: "0", color: "var(--accent)", cursor: "pointer", font: "inherit", textAlign: "left", textDecoration: "underline" };

  // Link mode: any value is a button; clicking it shows the lines behind it, each with its file and line.
  function linkTo(text, field, value, ctx) {
    var b = el("button", LINK, text);
    b.type = "button";
    b.setAttribute("data-field", field); b.setAttribute("data-value", value);
    b.onclick = function () { showLines(ctx, field, value); };
    return b;
  }
  function showLines(ctx, field, value) {
    var rows = ctx.records.filter(function (r) { return String(r[field]) === String(value); });
    var box = ctx.lines; box.textContent = "";
    box.appendChild(el("h4", { margin: "0 0 8px" }, rows.length + " line" + (rows.length === 1 ? "" : "s") + " where " + field + " is " + value));
    var t = el("table", { width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: "12px" });
    var head = el("tr");
    ["time", "client", "method", "path", "query", "status", "bytes", "ms", "edge", "agent", "from"].forEach(function (h) { head.appendChild(el("th", { textAlign: "left", borderBottom: "1px solid var(--line)", padding: "2px 6px" }, h)); });
    t.appendChild(head);
    rows.sort(function (a, b) { return a.t < b.t ? -1 : 1; }).slice(0, 500).forEach(function (r) {
      var tr = el("tr");
      [r.t.slice(0, 19).replace("T", " "), r.client, r.method, r.path, r.query, r.status, r.bytes, r.ms, r.edge, r.agent,
        r.src ? r.src.key.split("/").pop() + ":" + r.src.line + (r.src.part ? "." + r.src.part : "") : ""].forEach(function (v, i) {
        var long = i === 3 || i === 4 || i === 9 || i === 10; // path, query, agent, from wrap; the rest stay on one line
        tr.appendChild(el("td", { padding: "2px 6px", borderBottom: "1px solid var(--soft)", wordBreak: long ? "break-all" : "normal", whiteSpace: long ? "normal" : "nowrap" }, v === null ? "" : v));
      });
      t.appendChild(tr);
    });
    box.appendChild(t);
    if (rows.length > 500) box.appendChild(el("p", { color: "var(--muted)" }, "First 500 of " + rows.length + " shown."));
    box.scrollIntoView && box.scrollIntoView({ block: "nearest" });
  }

  // The hours as bars, gaps shown as gaps (a labelled space), not hidden.
  function hourStrip(s, d, ctx) {
    var wrap = el("div", { display: "flex", alignItems: "flex-end", gap: "2px", height: "90px", overflowX: "auto", padding: "4px 0" });
    var max = Math.max.apply(null, s.hours.map(function (h) { return h.requests; }).concat([1]));
    var gapAfter = {};
    (d ? d.gaps : []).forEach(function (g) { gapAfter[g.after] = g.hours; });
    s.hours.forEach(function (h) {
      var bar = el("button", { width: "22px", flex: "0 0 22px", height: Math.max(4, Math.round(70 * h.requests / max)) + "px", border: "0", padding: "0", cursor: "pointer",
        borderRadius: "3px 3px 0 0", background: h.errors > h.requests / 2 ? "var(--bad)" : "var(--accent)" });
      bar.type = "button"; bar.title = h.key.replace("T", " ") + ":00 UTC: " + h.requests + " requests, " + h.errors + " failed";
      bar.setAttribute("aria-label", bar.title); bar.setAttribute("data-field", "hour"); bar.setAttribute("data-value", h.key);
      bar.onclick = function () { showLines(ctx, "hour", h.key); };
      wrap.appendChild(bar);
      if (gapAfter[h.key]) {
        var g = el("div", { flex: "0 0 auto", alignSelf: "center", color: "var(--muted)", fontSize: "11px", padding: "0 6px", borderLeft: "1px dashed var(--line)", borderRight: "1px dashed var(--line)" }, gapAfter[h.key] + " h gap");
        g.className = "log-gap";
        wrap.appendChild(g);
      }
    });
    return wrap;
  }

  function table(title, rows, field, ctx, cols) {
    var card = el("div", CARD);
    card.appendChild(el("h4", { margin: "0 0 8px" }, title));
    if (!rows.length) { card.appendChild(el("p", { color: "var(--muted)", margin: "0" }, "None.")); return card; }
    var t = el("table", { width: "100%", borderCollapse: "collapse", fontSize: "13px" });
    rows.slice(0, 10).forEach(function (r) {
      var tr = el("tr"), td = el("td", { padding: "2px 4px", wordBreak: "break-all" });
      td.appendChild(linkTo(r.key === "" ? "(none)" : r.key, field, r.key, ctx));
      tr.appendChild(td);
      (cols || [["requests", ""]]).forEach(function (c) { tr.appendChild(el("td", { padding: "2px 4px", textAlign: "right", whiteSpace: "nowrap", color: c[0] === "errors" && r.errors ? "var(--bad)" : "" }, r[c[0]] + c[1])); });
      t.appendChild(tr);
    });
    card.appendChild(t);
    if (rows.length > 10) card.appendChild(el("p", { color: "var(--muted)", margin: "6px 0 0", fontSize: "12px" }, rows.length - 10 + " more"));
    return card;
  }

  function vaultCards(s, ctx) {
    var grid = el("div", { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" });
    if (!s.vaults.length) grid.appendChild(el("p", { color: "var(--muted)" }, "No vault was used in these hours."));
    s.vaults.forEach(function (v) {
      var c = el("div", CARD);
      c.className = "log-vault";
      var h = el("div", { fontWeight: "600" }); h.appendChild(linkTo(v.key, "vault", v.key, ctx)); c.appendChild(h);
      c.appendChild(el("div", null, v.requests + " requests from " + v.clients + " client" + (v.clients === 1 ? "" : "s") + (v.errors ? ", " + v.errors + " failed" : "")));
      c.appendChild(el("div", { color: "var(--muted)", fontSize: "12px" }, "By day: " + Object.keys(v.days).sort().map(function (d) { return d.slice(5) + " " + v.days[d]; }).join(", ")));
      c.appendChild(el("div", { color: "var(--muted)", fontSize: "12px" }, "Last seen " + v.last.slice(0, 16).replace("T", " ") + " UTC, via " + v.edges.join(", ")));
      grid.appendChild(c);
    });
    return grid;
  }

  // Draw a finished result into box.
  function render(box, result) {
    var s = result.summary, d = result.discover;
    box.textContent = "";
    var ctx = { records: result.records, lines: el("div", { marginTop: "12px" }) };
    ctx.lines.className = "log-lines";
    var head = el("p", { fontSize: "16px", fontWeight: "600", margin: "0 0 8px" }, X.headline(s, d));
    head.className = "log-headline";
    box.appendChild(head);
    box.appendChild(hourStrip(s, d, ctx));
    box.appendChild(el("h4", { margin: "12px 0 6px" }, "Vaults"));
    box.appendChild(vaultCards(s, ctx));
    var grid = el("div", { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "8px", marginTop: "12px" });
    grid.appendChild(table("Top paths", s.paths, "path", ctx, [["requests", ""], ["errors", " failed"]]));
    grid.appendChild(table("Failed paths", s.paths.filter(function (p) { return p.errors; }).sort(function (a, b) { return b.errors - a.errors; }), "path", ctx, [["errors", " failed"]]));
    grid.appendChild(table("Status", s.status, "status_class", ctx));
    grid.appendChild(table("Who asked", s.agent_kinds, "agent_kind", ctx));
    grid.appendChild(table("Busiest clients", s.clients_top || [], "client", ctx, [["requests", ""], ["errors", " failed"]]));
    grid.appendChild(table("Edges", s.edges, "edge", ctx, [["requests", ""], ["bytes", " B"]]));
    box.appendChild(grid);
    var note = "Read " + result.read.files + " file" + (result.read.files === 1 ? "" : "s") + " (" + kb(result.read.bytes) + "), " + s.requests + " lines";
    if (result.read.skipped.length) note += "; " + result.read.skipped.length + " skipped (" + result.read.skipped.slice(0, 3).map(function (k) { return k.src.key.split("/").pop() + ":" + k.src.line + " " + k.why; }).join("; ") + ")";
    if (d.other.length) note += "; " + d.other.length + " file" + (d.other.length === 1 ? "" : "s") + " outside the hourly layout not read";
    var p = el("p", { color: "var(--muted)", fontSize: "12px" }, note + ". Nothing was written anywhere.");
    p.className = "log-note";
    box.appendChild(p);
    box.appendChild(ctx.lines);
    return ctx;
  }

  // Discover, read every hourly file (progress per file), normalise, summarise, render.
  function run(box, objects, fetchBytes, opts) {
    opts = opts || {};
    var d = X.discover(objects), keys = [];
    d.hours.forEach(function (h) { keys.push.apply(keys, h.keys); });
    var max = opts.maxFiles || 200;
    box.textContent = "";
    var status = el("p", { color: "var(--muted)" }, d.files + " files, " + d.hours.length + " hours (" + (d.first || "?").replace("T", " ") + " to " + (d.last || "?").replace("T", " ") + " UTC). Reading...");
    box.appendChild(status);
    if (keys.length > max) { status.textContent = keys.length + " hourly files: more than " + max + ". Pick a smaller folder (a day or a month)."; return Promise.resolve(null); }
    var records = [], skipped = [], bytes = 0, done = 0;
    return keys.reduce(function (p, key) {
      return p.then(function () { return fetchBytes(key); }).then(function (b) {
        bytes += b.length;
        var gz = b.length > 1 && b[0] === 0x1f && b[1] === 0x8b;
        return gz ? X.gunzip(b) : new TextDecoder().decode(b);
      }).then(function (text) {
        var r = X.read(text, key);
        r.records.forEach(function (x) { records.push(X.normalise(x)); });
        skipped.push.apply(skipped, r.skipped);
        status.textContent = "Read " + (++done) + " of " + keys.length + " files...";
      }, function (e) {
        skipped.push({ src: { key: key, line: 0 }, why: "could not read: " + (e && e.message || e) });
      });
    }, Promise.resolve()).then(function () {
      records.forEach(function (r) { r.status_class = r.status === null ? "?" : Math.floor(r.status / 100) + "xx"; });
      var s = X.summarise(records);
      // busiest clients by address, for the drill-down only (the raw address stays in the page)
      var by = {};
      records.forEach(function (r) { var e = by[r.client] || (by[r.client] = { key: r.client, requests: 0, errors: 0 }); e.requests++; if (r.status >= 400) e.errors++; });
      s.clients_top = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.requests - a.requests || (a.key < b.key ? -1 : 1); });
      var result = { discover: d, summary: s, records: records, read: { files: keys.length, bytes: bytes, skipped: skipped } };
      render(box, result);
      return result;
    });
  }

  root.LogView = { run: run, render: render };
})(typeof window !== "undefined" ? window : globalThis);
