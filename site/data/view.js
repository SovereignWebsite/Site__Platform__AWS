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
  var NAMES = { path: "path", vault: "vault", client: "client", net: "network", country: "country (the enricher's claim)", host: "host asked for", status: "status", status_class: "status", agent_kind: "who asked",
    agent: "user agent", edge: "edge", hour: "hour", method: "method" };
  // Investigation mode: what the value refers to, what the same lines share, and the trail so far.
  function investigate(ctx, field, value, box) {
    var L = root.LogLinks;
    if (!L) return;
    ctx.trail = (ctx.trail || []).filter(function (s) { return !(s.field === field && s.value === String(value)); }).slice(-5);
    ctx.trail.push({ field: field, value: String(value) });
    var trail = el("div", { fontSize: "12px", color: "var(--muted)", margin: "0 0 6px" });
    trail.className = "log-trail";
    trail.appendChild(el("span", null, "Trail: "));
    ctx.trail.forEach(function (s, i) {
      if (i) trail.appendChild(el("span", null, " > "));
      trail.appendChild(i === ctx.trail.length - 1 ? el("span", null, (NAMES[s.field] || s.field) + " " + s.value) : linkTo((NAMES[s.field] || s.field) + " " + s.value, s.field, s.value, ctx));
    });
    box.appendChild(trail);
    var refs = L.resolve(field, value, ctx.context);
    if (refs.length) {
      var r = el("div", { margin: "0 0 6px" });
      r.className = "log-refs";
      r.appendChild(el("span", { fontWeight: "600" }, "Refers to: "));
      refs.forEach(function (ref, i) {
        if (i) r.appendChild(el("span", null, "; "));
        if (ref.found && ctx.open && ref.kind === "s3-object") {
          var b = el("button", LINK, ref.label); b.type = "button"; b.setAttribute("data-ref", ref.kind);
          b.onclick = function () { ctx.open(ref); };
          r.appendChild(b);
        } else {
          r.appendChild(el("span", ref.found ? null : { color: "var(--muted)" }, ref.label + (ref.found || ref.kind === "none" ? "" : " (not found)") +
            (ref.kind === "vault" && ref.detail ? " (" + Object.keys(ref.detail).filter(function (k) { return k !== "id"; }).map(function (k) { return k + " " + ref.detail[k]; }).join(", ") + ")" : "")));
        }
      });
      box.appendChild(r);
    }
    var p = L.pivots(ctx.records, field, value, 5), grid = el("div", { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "6px", margin: "0 0 10px" });
    grid.className = "log-pivots";
    Object.keys(p.by).forEach(function (f) {
      var c = el("div", { border: "1px solid var(--line)", borderRadius: "8px", padding: "6px 8px", fontSize: "12px" });
      c.appendChild(el("div", { color: "var(--muted)" }, (NAMES[f] || f) + " (" + p.by[f].distinct + ")"));
      p.by[f].top.forEach(function (t) {
        var row = el("div", { display: "flex", justifyContent: "space-between", gap: "6px" });
        var cell = el("span", { wordBreak: "break-all" }); cell.appendChild(linkTo(t.value, f, t.value, ctx));
        row.appendChild(cell); row.appendChild(el("span", null, t.lines));
        c.appendChild(row);
      });
      grid.appendChild(c);
    });
    if (p.lines) box.appendChild(el("div", { fontSize: "12px", color: "var(--muted)", margin: "0 0 4px" }, "These lines also share (" + p.first.slice(0, 16).replace("T", " ") + " to " + p.last.slice(0, 16).replace("T", " ") + " UTC):"));
    box.appendChild(grid);
  }
  function showLines(ctx, field, value) {
    var rows = ctx.records.filter(function (r) { return String(r[field]) === String(value); });
    var box = ctx.lines; box.textContent = "";
    box.appendChild(el("h4", { margin: "0 0 8px" }, rows.length + " line" + (rows.length === 1 ? "" : "s") + " where " + (NAMES[field] || field) + " is " + value));
    investigate(ctx, field, value, box);
    var t = el("table", { width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: "12px" });
    var head = el("tr");
    ["time", "client", "method", "path", "query", "status", "bytes", "ms", "edge", "agent", "from"].forEach(function (h) { head.appendChild(el("th", { textAlign: "left", borderBottom: "1px solid var(--line)", padding: "2px 6px" }, h)); });
    t.appendChild(head);
    rows.sort(function (a, b) { return a.t < b.t ? -1 : 1; }).slice(0, 500).forEach(function (r) {
      var tr = el("tr");
      [r.t.slice(0, 19).replace("T", " "), r.client, r.method, r.path, r.query, r.status, r.bytes, r.ms, r.edge, r.agent,
        r.src ? r.src.key.split("/").pop() + ":" + r.src.line + (r.src.part ? "." + r.src.part : "") : ""].forEach(function (v, i) {
        var long = i === 3 || i === 4 || i === 9 || i === 10; // path, query, agent, from wrap; the rest stay on one line
        var td = el("td", { padding: "2px 6px", borderBottom: "1px solid var(--soft)", wordBreak: long ? "break-all" : "normal", whiteSpace: long ? "normal" : "nowrap" }, i === 10 || i === 1 || i === 3 ? null : v === null ? "" : v);
        if (i === 1) td.appendChild(linkTo(v, "client", v, ctx));
        if (i === 3) td.appendChild(linkTo(v, "path", v, ctx));
        if (i === 10 && r.src) {
          var srcRef = (root.LogLinks ? root.LogLinks.resolve("src", r.src.key + ":" + r.src.line, ctx.context) : [])[0];
          if (srcRef && ctx.open) { var sb = el("button", LINK, v); sb.type = "button"; sb.setAttribute("data-ref", "src"); sb.onclick = function () { ctx.open(srcRef); }; td.appendChild(sb); }
          else td.textContent = v;
        }
        tr.appendChild(td);
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
    var gapAfter = Object.create(null);
    (d ? d.gaps : []).forEach(function (g) { gapAfter[g.after] = g.hours; });
    s.hours.forEach(function (h) {
      var bar = el("button", { width: "22px", flex: "0 0 22px", height: Math.max(4, Math.round(70 * h.requests / max)) + "px", border: "0", padding: "0", cursor: "pointer",
        borderRadius: "3px 3px 0 0", background: h.errors > h.requests / 2 ? "var(--bad)" : "var(--accent)" });
      bar.type = "button"; bar.className = "log-hour"; bar.title = h.key.replace("T", " ") + ":00 UTC: " + h.requests + " requests, " + h.errors + " failed";
      bar.setAttribute("aria-label", bar.title); bar.setAttribute("data-field", "hour"); bar.setAttribute("data-value", h.key);
      // a press and release on the same bar is a click (its lines); on two bars, no click fires and it is a window
      bar.onclick = function () { showLines(ctx, "hour", h.key); };
      bar.onpointerdown = function (e) { ctx.dragFrom = h.key; if (bar.releasePointerCapture && e.pointerId !== undefined) try { bar.releasePointerCapture(e.pointerId); } catch (x) { /* none */ } };
      bar.onpointerup = function () {
        var from = ctx.dragFrom; ctx.dragFrom = null;
        if (from && from !== h.key) { setWindow(ctx, from < h.key ? from : h.key, from < h.key ? h.key : from); }
      };
      ctx.bars.push({ key: h.key, el: bar });
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
      var used = el("div", null, v.ok + " served to " + v.ok_clients + " client" + (v.ok_clients === 1 ? "" : "s"));
      used.className = "log-vault-ok";
      c.appendChild(used);
      if (v.refused) {
        var ref = el("div", { color: "var(--bad)" }, v.refused + " refused: probes or errors, not access");
        ref.className = "log-vault-refused";
        c.appendChild(ref);
      }
      c.appendChild(el("div", { color: "var(--muted)", fontSize: "12px" }, "By day: " + Object.keys(v.days).sort().map(function (d) { return d.slice(5) + " " + v.days[d]; }).join(", ")));
      c.appendChild(el("div", { color: "var(--muted)", fontSize: "12px" }, "Last seen " + v.last.slice(0, 16).replace("T", " ") + " UTC, via " + v.edges.join(", ")));
      grid.appendChild(c);
    });
    return grid;
  }

  // Draw a finished result into box.
  // opts.context: what the caller knows for investigation mode ({ siteBucket, siteKeys, logsBucket, vaults });
  // opts.open(ref): go to an S3 object ({ bucket, key, line? }), e.g. open it in the S3 browser.
  // One summary for any set of lines: the whole read, or a window of it.
  function summaryOf(records) {
    records.forEach(function (r) { r.status_class = r.status === null ? "?" : Math.floor(r.status / 100) + "xx"; });
    var s = X.summarise(records);
    // busiest clients by address, for the drill-down only (the raw address stays in the page)
    var by = Object.create(null); // keyed by client address, a log value (R-014)
    records.forEach(function (r) { var e = by[r.client] || (by[r.client] = { key: r.client, requests: 0, errors: 0 }); e.requests++; if (r.status >= 400) e.errors++; });
    s.clients_top = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.requests - a.requests || (a.key < b.key ? -1 : 1); });
    return s;
  }

  // The time window (P5, docs/data/2026-11-23__02-time-lapse-first-design.md): drag across the hours, step, play.
  // Records are sorted by time once; a window is the lines whose hour is in [from, to], and everything below the
  // strip is drawn again for it. Hours are stepped over the hours present (a gap is skipped, not played as empty).
  function setWindow(ctx, from, to) {
    stopPlay(ctx);
    ctx.win = from ? { from: from, to: to } : null;
    ctx.records = from ? ctx.all.filter(function (r) { return r.hour >= from && r.hour <= to; }) : ctx.all;
    var s = from ? summaryOf(ctx.records) : ctx.full;
    var label = from ? "Window " + from.replace("T", " ") + ":00 to " + to.replace("T", " ") + ":59 UTC: " : "";
    ctx.head.textContent = label + X.headline(s, from ? null : ctx.discover);
    ctx.winLabel.textContent = from ? from.replace("T", " ") + ":00 to " + to.replace("T", " ") + ":59 UTC, " + ctx.records.length + " lines" : "All hours";
    ctx.bars.forEach(function (b) { b.el.style.opacity = !from || (b.key >= from && b.key <= to) ? "1" : "0.3"; });
    drawBody(ctx, s);
    ctx.lines.textContent = ""; ctx.trail = [];
  }
  function step(ctx, by) {
    var keys = ctx.bars.map(function (b) { return b.key; }), n = keys.length;
    if (!n) return false;
    var a, z;
    if (!ctx.win) { a = z = by > 0 ? 0 : n - 1; }
    else {
      a = keys.indexOf(ctx.win.from) + by; z = keys.indexOf(ctx.win.to) + by;
      if (a < 0 || z > n - 1) return false;
    }
    var playing = ctx.timer;
    ctx.timer = null; setWindow(ctx, keys[a], keys[z]); ctx.timer = playing;
    return true;
  }
  function stopPlay(ctx) {
    if (ctx.timer) { clearInterval(ctx.timer); ctx.timer = null; if (ctx.playBtn) ctx.playBtn.textContent = "Play"; }
  }
  function windowBar(ctx) {
    var bar = el("div", { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", margin: "4px 0 8px", fontSize: "13px" });
    bar.className = "log-window";
    bar.appendChild(el("span", { color: "var(--muted)" }, "Window:"));
    ctx.winLabel = el("span", { fontWeight: "600" }, "All hours");
    ctx.winLabel.className = "log-window-label";
    bar.appendChild(ctx.winLabel);
    function btn(text, name, fn) {
      var b = el("button", { font: "inherit", padding: "2px 8px", border: "1px solid var(--line)", borderRadius: "6px", background: "var(--panel)", color: "var(--fg)", cursor: "pointer" }, text);
      b.type = "button"; b.setAttribute("data-window", name); b.onclick = fn; bar.appendChild(b); return b;
    }
    btn("All", "all", function () { setWindow(ctx, null); });
    btn("Back an hour", "back", function () { stopPlay(ctx); step(ctx, -1); });
    btn("Forward an hour", "forward", function () { stopPlay(ctx); step(ctx, 1); });
    ctx.playBtn = btn("Play", "play", function () {
      if (ctx.timer) { stopPlay(ctx); return; }
      if (!ctx.win) step(ctx, 1);
      ctx.playBtn.textContent = "Pause";
      ctx.timer = setInterval(function () {
        if (!ctx.playBtn.isConnected || !step(ctx, 1)) stopPlay(ctx);
      }, ctx.playMs);
    });
    bar.appendChild(el("span", { color: "var(--muted)", fontSize: "12px" }, "Drag across the hours to choose a window."));
    return bar;
  }
  function drawBody(ctx, s) {
    var box = ctx.body, d = ctx.discover;
    box.textContent = "";
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
  }
  function render(box, result, opts) {
    opts = opts || {};
    var s = result.summary, d = result.discover;
    box.textContent = "";
    var all = result.records.slice().sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    var ctx = { all: all, records: all, full: s, discover: d, win: null, bars: [], timer: null, playMs: opts.playMs || 800,
      lines: el("div", { marginTop: "12px" }), body: el("div"), context: opts.context || {}, open: opts.open || null };
    ctx.lines.className = "log-lines";
    ctx.head = el("p", { fontSize: "16px", fontWeight: "600", margin: "0 0 8px" }, X.headline(s, d));
    ctx.head.className = "log-headline";
    box.appendChild(ctx.head);
    box.appendChild(hourStrip(s, d, ctx));
    box.appendChild(windowBar(ctx));
    box.appendChild(ctx.body);
    drawBody(ctx, s);
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
    // Ceilings (R-015): bytes per file as fetched and as unzipped, and records per run.
    var maxRecords = opts.maxRecords || 500000, maxFileBytes = opts.maxFileBytes || 32 * 1048576;
    var records = [], skipped = [], bytes = 0, done = 0, stopped = false;
    return keys.reduce(function (p, key) {
      return p.then(function () {
        if (stopped) return;
        // one file at a time; any failure in this file is recorded and the run goes on
        return Promise.resolve().then(function () { return fetchBytes(key); }).then(function (b) {
          if (b.length > maxFileBytes) throw new Error("larger than " + Math.round(maxFileBytes / 1048576) + " MB; not read");
          bytes += b.length;
          var gz = b.length > 1 && b[0] === 0x1f && b[1] === 0x8b;
          return gz ? X.gunzip(b, opts.maxUnzipped) : new TextDecoder().decode(b);
        }).then(function (text) {
          var r = X.read(text, key), room = maxRecords - records.length;
          if (r.records.length > room) { r.records = r.records.slice(0, room); stopped = true; }
          r.records.forEach(function (x) { records.push(X.normalise(x)); });
          skipped.push.apply(skipped, r.skipped);
          if (stopped) skipped.push({ src: { key: key, line: 0 }, why: "stopped at " + maxRecords + " records; later files not read" });
          status.textContent = "Read " + (++done) + " of " + keys.length + " files...";
        }).catch(function (e) {
          skipped.push({ src: { key: key, line: 0 }, why: "could not read: " + (e && e.message || e) });
        });
      });
    }, Promise.resolve()).then(function () {
      var s = summaryOf(records);
      var result = { discover: d, summary: s, records: records, read: { files: keys.length, bytes: bytes, skipped: skipped } };
      render(box, result, opts);
      return result;
    });
  }

  root.LogView = { run: run, render: render, summaryOf: summaryOf };
})(typeof window !== "undefined" ? window : globalThis);
