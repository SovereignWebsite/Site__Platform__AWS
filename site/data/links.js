// Investigation mode (memo part 4, section 22): from any value in the CloudFront logs, go to the resource it
// refers to, and pivot to what else the same lines share. Built by data.aws.a on the extract (EX-1).
// Pure functions: no DOM, no network. The caller hands in what it already knows (the site bucket's keys, the
// vaults list, the logs bucket); nothing here guesses a resource that is not in that context.
(function (root) {
  "use strict";

  // What a value refers to. ctx: { siteBucket, siteKeys: [..], logsBucket, vaults: [{ id, ... }] }.
  // Returns a list of refs: { kind, label, bucket?, key?, line?, found, detail? }.
  function resolve(field, value, ctx) {
    ctx = ctx || {};
    var v = String(value), refs = [];
    var keys = ctx.siteKeys || [], has = function (k) { return keys.indexOf(k) >= 0; };
    if (field === "path") {
      var key = v.replace(/^\/+/, "");
      if (key === "" || /\/$/.test(key)) key += "index.html";
      var safe = !/(^|\/)\.\.?(\/|$)/.test(key);
      if (safe && ctx.siteBucket) refs.push({ kind: "s3-object", label: "s3://" + ctx.siteBucket + "/" + key, bucket: ctx.siteBucket, key: key, found: has(key) });
      if (!safe) refs.push({ kind: "none", label: "Not a resource: the path climbs out of the site (traversal)", found: false });
      var vm = /^\/vault\/([^\/]+)\//.exec(v);
      if (vm && vm[1] !== ".." && vm[1] !== ".") refs = refs.concat(resolve("vault", vm[1], ctx));
    } else if (field === "vault") {
      var hit = (ctx.vaults || []).filter(function (x) { return x.id === v; })[0];
      refs.push({ kind: "vault", label: "Vault " + v, id: v, found: !!hit, detail: hit || null });
      if (ctx.siteBucket && has("data/vaults.json")) refs.push({ kind: "s3-object", label: "s3://" + ctx.siteBucket + "/data/vaults.json", bucket: ctx.siteBucket, key: "data/vaults.json", found: true });
    } else if (field === "src") {
      var m = /^(.*):(\d+)$/.exec(v);
      if (m && ctx.logsBucket) refs.push({ kind: "s3-object", label: "s3://" + ctx.logsBucket + "/" + m[1] + " line " + m[2], bucket: ctx.logsBucket, key: m[1], line: +m[2], found: true });
    } else if (field === "edge") {
      refs.push({ kind: "edge", label: "CloudFront edge " + v + " (" + v.slice(0, 3) + ")", found: !!v });
    } else if (field === "client") {
      var net = root.LogExtract ? root.LogExtract.network(v) : "";
      refs.push({ kind: "network", label: "Network " + (net || "unknown"), net: net, found: !!net });
    }
    return refs;
  }

  // Pivots: for the lines where field = value, the other fields' values, most frequent first.
  var PIVOT_FIELDS = ["path", "vault", "client", "net", "country", "status", "agent_kind", "agent", "edge", "hour", "method"];
  function pivots(records, field, value, limit) {
    var rows = records.filter(function (r) { return String(r[field]) === String(value); });
    var out = { field: field, value: value, lines: rows.length, first: null, last: null, by: Object.create(null) };
    rows.forEach(function (r) { if (!out.first || r.t < out.first) out.first = r.t; if (!out.last || r.t > out.last) out.last = r.t; });
    PIVOT_FIELDS.forEach(function (f) {
      if (f === field) return;
      var c = Object.create(null); // keyed by log values (R-014)
      rows.forEach(function (r) { var k = r[f]; if (k === "" || k === null || k === undefined) return; c[k] = (c[k] || 0) + 1; });
      var list = Object.keys(c).map(function (k) { return { value: k, lines: c[k] }; })
        .sort(function (a, b) { return b.lines - a.lines || (a.value < b.value ? -1 : 1); });
      if (list.length) out.by[f] = { distinct: list.length, top: list.slice(0, limit || 5) };
    });
    return out;
  }

  root.LogLinks = { resolve: resolve, pivots: pivots, fields: PIVOT_FIELDS };
})(typeof window !== "undefined" ? window : globalThis);
