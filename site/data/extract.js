// The extract workflow (EX-1), steps 1 to 4: Discover, Read, Normalise, Summarise.
// Design: docs/data/2026-11-23__01-extract-workflow-first-design.md (data.aws.c), built by data.aws.a.
// Pure functions: handed key listings and bytes, returns records and small tables. No DOM, no network,
// no storage. The same file runs in the page (window.LogExtract) and in Node for tests (globalThis).
// Every record keeps where it came from (src: object key and line), so any number can link to its lines.
(function (root) {
  "use strict";
  var SCHEMA = "sws-cloudfront-record/v0";

  // ---- 1. Discover: group a listing by hour, before reading anything ----
  // Keys in the Firehose-style hourly prefix: .../YYYY/MM/DD/HH/<name>. Anything else is reported, not dropped.
  var HOUR_KEY = /(?:^|\/)(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\/[^\/]+$/;
  function discover(objects) {
    var hours = {}, other = [], bytes = 0;
    (objects || []).forEach(function (o) {
      var m = HOUR_KEY.exec(o.Key || ""), size = +o.Size || 0;
      bytes += size;
      if (!m) { other.push(o.Key); return; }
      var h = m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4];
      var e = hours[h] || (hours[h] = { hour: h, files: 0, bytes: 0, keys: [] });
      e.files++; e.bytes += size; e.keys.push(o.Key);
    });
    var list = Object.keys(hours).sort().map(function (k) { return hours[k]; });
    var gaps = [];
    for (var i = 1; i < list.length; i++) {
      var a = hourMs(list[i - 1].hour), b = hourMs(list[i].hour), missing = (b - a) / 3600000 - 1;
      if (missing > 0) gaps.push({ after: list[i - 1].hour, before: list[i].hour, hours: missing });
    }
    var days = {};
    list.forEach(function (e) { var d = e.hour.slice(0, 10); days[d] = (days[d] || 0) + e.files; });
    return { files: (objects || []).length, bytes: bytes, hours: list, days: days, gaps: gaps, other: other,
      first: list.length ? list[0].hour : null, last: list.length ? list[list.length - 1].hour : null };
  }
  function hourMs(h) { return Date.parse(h + ":00:00Z"); }

  // ---- 2. Read: bytes or text to raw records, keeping provenance ----
  // Accepts JSON Lines, concatenated JSON objects with no delimiter (}{), and tab-separated lines under a
  // #Fields header (CloudFront standard logs). Lines that cannot be read are counted with the reason.
  function read(text, key) {
    var out = { records: [], skipped: [] };
    if (typeof text !== "string") text = new TextDecoder().decode(text);
    var lines = text.split(/\r?\n/), fields = null;
    for (var n = 0; n < lines.length; n++) {
      var line = lines[n], src = { key: key || "", line: n + 1 };
      if (!line.trim()) continue;
      if (line.charAt(0) === "#") {
        var f = /^#Fields:\s*(.*)$/.exec(line);
        if (f) fields = f[1].trim().split(/\s+/);
        continue;
      }
      if (line.charAt(0) === "{") {
        var objs = splitObjects(line);
        if (!objs) { out.skipped.push({ src: src, why: "not JSON" }); continue; }
        objs.forEach(function (o, i) { out.records.push({ raw: o, src: objs.length > 1 ? { key: src.key, line: src.line, part: i + 1 } : src }); });
        continue;
      }
      if (fields) {
        var v = line.split("\t");
        if (v.length !== fields.length) { out.skipped.push({ src: src, why: "expected " + fields.length + " fields, got " + v.length }); continue; }
        var r = {};
        fields.forEach(function (k, i) { r[k] = v[i] === "-" ? "" : v[i]; });
        out.records.push({ raw: r, src: src });
        continue;
      }
      out.skipped.push({ src: src, why: "unknown format" });
    }
    return out;
  }
  // Split "{...}{...}" into objects by scanning braces outside strings; null if any part is not JSON.
  function splitObjects(s) {
    var parts = [], depth = 0, start = 0, inStr = false, esc = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === "\"") inStr = false; continue; }
      if (c === "\"") inStr = true;
      else if (c === "{") { if (depth++ === 0) start = i; }
      else if (c === "}") { if (--depth === 0) parts.push(s.slice(start, i + 1)); if (depth < 0) return null; }
      else if (depth === 0 && !/\s/.test(c)) return null;
    }
    if (depth !== 0 || inStr) return null;
    try { return parts.map(function (p) { return JSON.parse(p); }); } catch (e) { return null; }
  }

  // Decompress gzip (one or more members) with the platform's DecompressionStream.
  function gunzip(bytes) {
    var ds = new DecompressionStream("gzip");
    return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  }

  // ---- 3. Normalise to one record shape (schema v0) ----
  // Field names differ by source: the twin's own (c_ip), CloudFront's header names (c-ip), and a few
  // aliases. One mapping, first match wins; either form works.
  var MAP = {
    t: ["timestamp", "date_time"], date: ["date"], time: ["time"],
    client: ["c_ip", "c-ip"], method: ["cs_method", "cs-method"], path: ["cs_uri_stem", "cs-uri-stem"],
    query: ["cs_uri_query", "cs-uri-query"], status: ["sc_status", "sc-status"], bytes: ["sc_bytes", "sc-bytes"],
    seconds: ["time_taken", "time-taken"], edge: ["x_edge_location", "x-edge-location"],
    agent: ["cs_user_agent", "cs(User-Agent)", "cs-user-agent"], request_id: ["x_edge_request_id", "x-edge-request-id"],
    result: ["x_edge_result_type", "x-edge-result-type"], host: ["cs_host", "cs(Host)", "x-host-header"]
  };
  function pick(raw, names) { for (var i = 0; i < names.length; i++) if (raw[names[i]] !== undefined && raw[names[i]] !== "") return raw[names[i]]; return ""; }
  // Kinds of path, in order; easy to change in one place.
  var KINDS = [
    ["vault", /^\/vault\//], ["data", /\.json$|^\/api\//], ["asset", /\.(css|js|ico|png|jpe?g|svg|webp|woff2?)$/i],
    ["page", /\/$|\.html?$/]
  ];
  function agentKind(a) {
    a = String(a || "");
    if (/sqlmap|nuclei|nikto|zgrab|masscan|bot|crawler|spider/i.test(a)) return "bot";
    if (/^(curl|wget|python|go-http|okhttp|java|node|axios|httpie)/i.test(a)) return "script";
    if (/mozilla|chrome|safari|firefox|edge/i.test(a)) return "browser";
    return a ? "other" : "";
  }
  // Network part of an address: /24 for IPv4, /48 for IPv6 (the design's privacy proposal).
  function network(ip) {
    ip = String(ip || "");
    var v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(ip);
    if (v4) return v4[1] + ".0/24";
    if (ip.indexOf(":") >= 0) {
      var g = expand6(ip);
      return g ? g.slice(0, 3).join(":") + "::/48" : "";
    }
    return "";
  }
  function expand6(ip) {
    var halves = ip.split("::");
    if (halves.length > 2) return null;
    var a = halves[0] ? halves[0].split(":") : [], b = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    var fill = halves.length === 2 ? 8 - a.length - b.length : 0;
    var all = a.concat(new Array(Math.max(fill, 0)).fill("0"), b);
    return all.length === 8 ? all.map(function (x) { return (x || "0").toLowerCase().replace(/^0+(?=.)/, ""); }) : null;
  }
  function normalise(item) {
    var raw = item.raw || item, src = item.src || null;
    var t = pick(raw, MAP.t);
    if (!t && raw.date && raw.time) t = raw.date + "T" + raw.time + "Z";
    var ms = Date.parse(t), iso = isNaN(ms) ? "" : new Date(ms).toISOString();
    var stem = String(pick(raw, MAP.path)), query = String(pick(raw, MAP.query)), q = stem.indexOf("?");
    if (q >= 0) { if (!query) query = stem.slice(q + 1); stem = stem.slice(0, q); }
    var path = stem, kind = "other";
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(path)) { kind = KINDS[i][0]; break; }
    var vm = /^\/vault\/([^\/?#]+)\//.exec(path);
    var edge = String(pick(raw, MAP.edge)), sec = parseFloat(pick(raw, MAP.seconds));
    var client = String(pick(raw, MAP.client)), status = parseInt(pick(raw, MAP.status), 10);
    return {
      t: iso, hour: iso ? iso.slice(0, 13) : "",
      client: client, net: network(client),
      method: String(pick(raw, MAP.method)).toUpperCase(), path: path, query: query,
      status: isNaN(status) ? null : status, bytes: parseInt(pick(raw, MAP.bytes), 10) || 0,
      ms: isNaN(sec) ? null : Math.round(sec * 1000),
      edge: edge, edge_city: (/^[A-Z]{3}/.exec(edge) || [""])[0],
      agent: String(pick(raw, MAP.agent)), agent_kind: agentKind(pick(raw, MAP.agent)),
      kind: kind, vault: vm && vm[1] !== ".." && vm[1] !== "." ? decodeSafe(vm[1]) : "",
      request_id: String(pick(raw, MAP.request_id)), result: String(pick(raw, MAP.result)), host: String(pick(raw, MAP.host)),
      src: src
    };
  }
  function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // ---- 4. Summarise into the small tables the page draws ----
  function quantile(sorted, p) { if (!sorted.length) return null; return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }
  function summarise(records) {
    records = (records || []).slice().sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    var by = { hour: {}, path: {}, status: {}, edge: {}, agent_kind: {}, kind: {}, vault: {}, net: {} };
    var clients = {}, bytes = 0, errors = 0;
    function bump(table, k, r) {
      var e = table[k] || (table[k] = { key: k, requests: 0, bytes: 0, errors: 0, clients: {}, first: r.t, last: r.t, ms: [] });
      e.requests++; e.bytes += r.bytes; if (r.status >= 400) e.errors++;
      e.clients[r.client] = 1; if (r.t < e.first) e.first = r.t; if (r.t > e.last) e.last = r.t;
      if (r.ms !== null) e.ms.push(r.ms);
      return e;
    }
    records.forEach(function (r) {
      bytes += r.bytes; if (r.status >= 400) errors++; clients[r.client] = 1;
      bump(by.hour, r.hour, r); bump(by.path, r.path, r); bump(by.status, r.status === null ? "?" : Math.floor(r.status / 100) + "xx", r);
      bump(by.edge, r.edge, r); bump(by.agent_kind, r.agent_kind, r); bump(by.kind, r.kind, r); bump(by.net, r.net, r);
      if (r.vault) { var v = bump(by.vault, r.vault, r); var d = r.t.slice(0, 10); (v.days = v.days || {})[d] = (v.days[d] || 0) + 1; (v.edges = v.edges || {})[r.edge] = 1; }
    });
    function finish(table, order) {
      return Object.keys(table).map(function (k) {
        var e = table[k], ms = e.ms.sort(function (a, b) { return a - b; });
        var o = { key: e.key, requests: e.requests, bytes: e.bytes, errors: e.errors, clients: Object.keys(e.clients).length,
          first: e.first, last: e.last, p50_ms: quantile(ms, 0.5), p95_ms: quantile(ms, 0.95) };
        if (e.days) o.days = e.days;
        if (e.edges) o.edges = Object.keys(e.edges).sort();
        return o;
      }).sort(order || function (a, b) { return b.requests - a.requests || (a.key < b.key ? -1 : 1); });
    }
    var byKey = function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; };
    return {
      schema: SCHEMA, requests: records.length, bytes: bytes, errors: errors, clients: Object.keys(clients).length,
      first: records.length ? records[0].t : null, last: records.length ? records[records.length - 1].t : null,
      hours: finish(by.hour, byKey), paths: finish(by.path), status: finish(by.status, byKey), edges: finish(by.edge),
      agent_kinds: finish(by.agent_kind), kinds: finish(by.kind), vaults: finish(by.vault), networks: finish(by.net)
    };
  }

  // A line in words first, for the first-time user.
  function headline(s, d) {
    if (!s.requests) return "No requests in what was read.";
    var hours = s.hours.length, failed = s.errors;
    var top404 = s.paths.filter(function (p) { return p.errors; });
    var parts = [s.requests + " request" + (s.requests === 1 ? "" : "s") + " over " + hours + " hour" + (hours === 1 ? "" : "s") +
      ", " + day(s.first) + (day(s.first) !== day(s.last) ? " to " + day(s.last) : "")];
    if (failed) parts.push(failed + " failed" + (top404.length === 1 ? " (all " + top404[0].key + ")" : " on " + top404.length + " paths"));
    else parts.push("none failed");
    parts.push(s.vaults.length + " vault" + (s.vaults.length === 1 ? "" : "s") + " used");
    if (d && d.gaps.length) parts.push(d.gaps.length + " gap" + (d.gaps.length === 1 ? "" : "s") + " in the hours");
    return parts.join("; ") + ".";
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function day(t) { return t ? +t.slice(8, 10) + " " + MONTHS[+t.slice(5, 7) - 1] : ""; }

  root.LogExtract = { schema: SCHEMA, discover: discover, read: read, gunzip: gunzip, normalise: normalise,
    summarise: summarise, headline: headline, network: network, agentKind: agentKind };
})(typeof window !== "undefined" ? window : globalThis);
