// The twin: a synthetic AWS that answers the same endpoints, in the same wire formats, inside the page.
// Dinis Cruz, 23 Nov 2026: "the code either hits the AWS from the browser ... or it hits the twin, but the code
// should not know the difference"; "let's create a whole AWS environment that is fully synthetic using the
// digital twins ... even good for demos ... And then we'll wire up the real data."
// Everything here is made up: account 111122223333 is the example account AWS uses in its own documentation.
// It checks that calls are signed (an Authorization header with a twin access key), as AWS would.
(function (root) {
  "use strict";
  var ACCOUNT = "111122223333", REGION = "eu-west-2";
  // Demo packs: each is a whole synthetic world; loading one changes what every view shows.
  // Dinis, 23 Nov 2026: "imagine like you can have multiple twins data sets"; "here's the attack ... or this
  // some extra traffic flying around".
  // Design 02 step 2: a pack is data, not code, in the shape of site/twin/packs/<id>.json (a test keeps the two equal
  // until the page loads the files): a seed, the generators to run in order with their parameters, and where it
  // shows. The generators are code (G, in build()); a pack only names them, and an unknown name is an error.
  var PACKS = {
    baseline: { id: "baseline", title: "Normal day", about: "A small site behind CloudFront, its logs written by Firehose, two vaults in use.", seed: 20261123,
      generate: [
      {"gen": "s3.cors"},
      {"gen": "site.static"},
      {"gen": "cloudfront.traffic", "days": [20, 21, 22], "hours": [9, 10, 11], "perHour": 25},
      {"gen": "lambda.dependencies"},
      {"gen": "cloudtrail.demo"},
      {"gen": "site.archive", "pages": 1203},
      {"gen": "site.dotted"},
      {"gen": "iam.roles"}
      ] },
    attack: { id: "attack", title: "Attack in progress", about: "One address scanning for secrets and admin pages, then trying path traversal on the vault API, among normal visitors.", seed: 20261123, see: {"label": "the CloudFront logs of 22 Nov, 11:00", "bucket": "logs", "prefix": "cloudfront/2026/11/22/11/"},
      generate: [
      {"gen": "s3.cors"},
      {"gen": "site.static"},
      {"gen": "cloudfront.traffic", "days": [20, 21, 22], "hours": [9, 10, 11], "perHour": 25, "probe": {"day": 22, "ip": "203.0.113.66", "perHourStep": 15}},
      {"gen": "lambda.dependencies"},
      {"gen": "cloudtrail.demo"},
      {"gen": "site.archive", "pages": 1203},
      {"gen": "site.dotted"},
      {"gen": "iam.roles"}
      ] },
    surge: { id: "surge", title: "Traffic surge", about: "Ten times the usual visitors, most of them on one vault's files.", seed: 20261123, see: {"label": "the CloudFront logs of 22 Nov, 11:00", "bucket": "logs", "prefix": "cloudfront/2026/11/22/11/"},
      generate: [
      {"gen": "s3.cors"},
      {"gen": "site.static"},
      {"gen": "cloudfront.traffic", "days": [20, 21, 22], "hours": [9, 10, 11], "perHour": 250, "hot": "/vault/vault-demo-001/files", "hotShare": 0.7},
      {"gen": "lambda.dependencies"},
      {"gen": "cloudtrail.demo"},
      {"gen": "site.archive", "pages": 1203},
      {"gen": "site.dotted"},
      {"gen": "iam.roles"}
      ] }
  };
  var pack = "baseline";
  try { var qp = new URLSearchParams(root.location.search).get("pack"); if (qp && own(PACKS, qp)) pack = qp; else { var sp = localStorage.getItem("sws-aws-twin-pack"); if (sp && own(PACKS, sp)) pack = sp; } } catch (e) { /* none */ }
  var enc = new TextEncoder();
  // Who is where (design 03's split, architect.aws.a 23 Nov): every address is in the RFC 5737 documentation ranges,
  // one /24 per kind of client, so a filter on one network (or the graph's actor-net node) is one kind of client.
  //   visitors: 198.51.100.1 to .239 (198.51.100.240/28 is kept for EC2 public addresses); one rnd() per visitor
  //   attacker: 203.0.113.0/24 (the probe's address is in the attack pack)
  //   operator: 192.0.2.0/24, its calls in CloudTrail from 192.0.2.7
  var OPERATOR_IP = "192.0.2.7", EC2_PUBLIC = "198.51.100.240/28";
  var VISITOR_IPS = (function () {
    var out = [], i;
    for (i = 1; i < 240; i++) out.push("198.51.100." + i);
    return out;
  })();

  // ---- deterministic synthetic data: named random streams (design 02) ----
  // Each consumer draws from its own stream, so adding one never shifts the numbers another one gets. v0's data is
  // the "v0" stream with v0's seed, so step 1 gives byte-for-byte v0's output; latency has its own, as before, so the
  // data never depends on how many calls came first.
  var streams = {};
  function rng(name, seed) {
    if (streams[name]) return streams[name];
    var s = seed;
    return (streams[name] = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; });
  }
  function rnd() { return rng("v0", thePack().seed)(); } // one stream for v0's generators, as before
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function lag() { return rng("latency", 7)(); }
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; }

  // What the stream's processor (demo-log-enricher) adds to each line: the country (from the edge here; a real
  // enricher would use the client address) and the vault id named in the path. No randomness, so the data is unchanged.
  var COUNTRY = { LHR: "GB", DUB: "IE", AMS: "NL" };
  function enrich(l) { l.country = COUNTRY[l.x_edge_location.slice(0, 3)] || ""; var v = /^\/vault\/([^/]+)\//.exec(l.cs_uri_stem); l.vault_id = v ? v[1] : ""; return l; }
  function gzip(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function deflateRaw(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xffffffff; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // Entry times in DOS form: 18 Nov 2026 16:50, just before the object's own LastModified.
  var DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 18, DOS_TIME = (16 << 11) | (50 << 5);
  // A real zip (deflate entries, central directory at the end), so the page reads it by byte ranges.
  function makeZip(files) {
    return Promise.all(files.map(function (f) { var raw = enc.encode(f[1]); return deflateRaw(raw).then(function (d) { return { name: enc.encode(f[0]), raw: raw, data: d, crc: crc32(raw) }; }); }))
      .then(function (es) {
        var parts = [], central = [], off = 0;
        es.forEach(function (e) {
          var h = new DataView(new ArrayBuffer(30));
          h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, 8, true);
          h.setUint16(10, DOS_TIME, true); h.setUint16(12, DOS_DATE, true); h.setUint32(14, e.crc, true);
          h.setUint32(18, e.data.length, true); h.setUint32(22, e.raw.length, true); h.setUint16(26, e.name.length, true);
          parts.push(new Uint8Array(h.buffer), e.name, e.data);
          var c = new DataView(new ArrayBuffer(46));
          c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, 8, true);
          c.setUint16(12, DOS_TIME, true); c.setUint16(14, DOS_DATE, true); c.setUint32(16, e.crc, true); c.setUint32(20, e.data.length, true);
          c.setUint32(24, e.raw.length, true); c.setUint16(28, e.name.length, true); c.setUint32(42, off, true);
          central.push(new Uint8Array(c.buffer), e.name);
          off += 30 + e.name.length + e.data.length;
        });
        var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, es.length, true); end.setUint16(10, es.length, true);
        end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
        return new Response(new Blob(parts.concat(central, [new Uint8Array(end.buffer)]))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
      });
  }

  // ---- design 02, step 1: a journal folded into a world ----
  // Every fact in the synthetic account is an entry in one append-only journal, and the world the services answer
  // from is the entries applied in order (design 02, docs/architecture/, architect.aws.a). A pack appends entries;
  // later, generators, scenarios, actors, edits and feeds will too. Services read the world and turn every write
  // into an entry, with the caller as its actor. An entry: { seq, t, actor, op, target, data, why, source }.
  // Bodies stay lazy: data.body is a recipe ({ text }, { gzipText } or { zip: [[name, text], ...] }), made into
  // bytes the first time something reads it, then kept, as v0 kept its promises.
  var journal = [];
  // Maps keyed by request values (bucket, key, role, change set names) have no prototype, so a name such as
  // "__proto__" or "constructor" is only ever a missing entry (security.aws.a's note on 88831eb).
  function map() { return Object.create(null); }
  function emptyWorld() { return { objects: map(), cors: map(), roles: map(), iam: map(), template: null, stackStatus: "CREATE_COMPLETE", stackUpdated: null, stackEvents: [], changeSets: map(), requests: map(), pending: [], marks: [], accounts: map() }; }
  function bodyOf(spec) {
    if (spec.gzipText != null) return gzip(enc.encode(spec.gzipText));
    if (spec.zip) return makeZip(spec.zip);
    return Promise.resolve(enc.encode(spec.text));
  }
  function lazyObject(d) {
    var o = { type: d.type, modified: d.modified, spec: d.body }, made = null;
    Object.defineProperty(o, "body", { enumerable: false, get: function () { return made || (made = bodyOf(o.spec)); } });
    return o;
  }
  // One small function per operation on the world: (world, entry) -> world changed in place.
  var OPS = {
    "s3.putObject": function (w, e) { var d = e.data; (w.objects[d.bucket] = w.objects[d.bucket] || map())[d.key] = lazyObject(d); if (d.bucket === B.logs) { delete w._hours; delete w._lambdaLogs; } },
    "s3.putBucketCors": function (w, e) { w.cors[e.data.bucket] = JSON.parse(JSON.stringify(e.data.cors)); },
    "s3.addCorsRule": function (w, e) { w.cors[e.data.bucket].CorsRules.push(JSON.parse(JSON.stringify(e.data.rule))); },
    "iam.createRole": function (w, e) { w.roles[e.data.name] = JSON.parse(JSON.stringify(e.data.trust)); if (e.data.details) w.iam[e.data.name] = JSON.parse(JSON.stringify(e.data.details)); },
    "iam.updateAssumeRolePolicy": function (w, e) { w.roles[e.data.name] = JSON.parse(JSON.stringify(e.data.trust)); },
    "cloudformation.loadTemplate": function (w, e) { w.template = e.data.body; },
    "cloudformation.createChangeSet": function (w, e) { w.changeSets[e.data.name] = e.data.body; },
    // The hub stack's update: status, last-updated time and two events, newest first (cloudformation.aws.a's patch 01).
    "cloudformation.executeChangeSet": function (w, e) {
      var t = e.data.t || e.t.replace(/\.\d+Z$/, "Z");
      w.template = w.changeSets[e.data.name]; w.stackStatus = "UPDATE_COMPLETE"; w.stackUpdated = t;
      w.stackEvents = [[t, "sws-aws-platform", "AWS::CloudFormation::Stack", "UPDATE_COMPLETE"], [t, "sws-aws-platform", "AWS::CloudFormation::Stack", "UPDATE_IN_PROGRESS", "User Initiated"]].concat(w.stackEvents || []);
    },
    "cloudcontrol.requestFailed": function (w, e) { w.requests[e.data.token] = e.data.message; },
    // ---- Customer accounts (deploy plan step 4): stacks in another account, keyed account -> "region/name" ----
    "cloudformation.createStack": function (w, e) {
      var d = e.data, a = w.accounts[d.account] || (w.accounts[d.account] = { stacks: map() });
      a.stacks[d.region + "/" + d.name] = { name: d.name, kind: d.kind, mode: d.mode || null, region: d.region, account: d.account, stackId: d.stackId, roleArn: d.roleArn || null,
        params: d.params, created: e.t, status: "CREATE_IN_PROGRESS", resources: map(), outputs: [], ids: d.ids,
        events: [{ id: d.stackId.split("/").pop() + "-" + e.seq, t: e.t, logical: d.name, physical: d.stackId, type: "AWS::CloudFormation::Stack", status: "CREATE_IN_PROGRESS", reason: "User Initiated" }] };
    },
    "cloudformation.deleteStack": function (w, e) {
      var d = e.data, acc = w.accounts[d.account], st = acc && acc.stacks[d.region + "/" + d.name];
      if (!st) return;
      st.status = "DELETE_IN_PROGRESS";
      st.events.unshift({ id: st.stackId.split("/").pop() + "-" + e.seq, t: e.t, logical: d.name, physical: st.stackId, type: "AWS::CloudFormation::Stack", status: "DELETE_IN_PROGRESS", reason: "User Initiated" });
    },
    // One resource's (or the stack's own) step, emitted by the clock: newest first in events, as AWS lists them.
    "cloudformation.stackEvent": function (w, e) {
      var d = e.data, acc = w.accounts[d.account], st = acc && acc.stacks[d.region + "/" + d.name];
      if (!st) return; // a stack step with no stack (a journal cut before its create): nothing to apply
      st.events.unshift({ id: st.stackId.split("/").pop() + "-" + e.seq, t: e.t, logical: d.logical, physical: d.physical || "", type: d.type, status: d.status, reason: d.reason || "" });
      if (d.logical === d.name) { st.status = d.status; if (d.outputs) st.outputs = d.outputs; }
      else st.resources[d.logical] = { type: d.type, physical: d.physical || (st.resources[d.logical] || {}).physical || "", status: d.status, t: e.t, reason: d.reason || "" };
      // What a delete leaves behind stays in the account (the retained bucket, policy and log group), by name.
      if (d.status === "DELETE_SKIPPED" && st.resources[d.logical].physical) (acc.retained || (acc.retained = map()))[d.type + " " + st.resources[d.logical].physical] = true;
    },
    // A marker a scenario or test can schedule (the clock's own op): the world keeps the labels in order.
    "clock.mark": function (w, e) { w.marks.push(e.data.label); }
  };
  // An entry may schedule later entries (e.schedule: [{ at, op, target, data, actor, why }]); they wait in the world's
  // pending list, so a refold rebuilds the list, and leave it when the clock emits them (e.settles: { from, i }).
  function apply(w, e) {
    var f = OPS[e.op]; if (!f) throw new Error("twin: no operation " + e.op); f(w, e);
    if (e.settles) w.pending = w.pending.filter(function (p) { return !(p.from === e.settles.from && p.i === e.settles.i); });
    if (e.schedule) e.schedule.forEach(function (x, i) { w.pending.push({ at: x.at, from: e.seq, i: i, entry: x }); });
    return w;
  }
  function fold(entries) { return entries.reduce(apply, emptyWorld()); }
  // ---- The twin's clock (design 02 step 5, brought forward for deploy step 4; architect.aws.a's rules, 23 Nov) ----
  // now() is the twin's time: real time plus an offset, or frozen while paused; tick(ms) moves it on. Scheduled entries
  // are emitted by catch-up only, each with t = its own at, in at order (ties: the scheduling entry's seq, then its
  // place in that entry's list), so the journal depends on the clock alone, never on who read the twin or when.
  // Catch-up runs on tick, before any new entry is recorded, and on a read while the clock runs.
  var clock = { offset: 0, frozen: null };
  function nowMs() { return clock.frozen != null ? clock.frozen : Date.now() + clock.offset; }
  function nowIso() { return new Date(nowMs()).toISOString(); }
  var settling = false;
  function settle() {
    if (settling || !state) return;
    settling = true;
    try {
      var upTo = nowMs();
      for (;;) {
        var due = state.pending.filter(function (p) { return Date.parse(p.at) <= upTo; });
        if (!due.length) break;
        due.sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at) || a.from - b.from || a.i - b.i; });
        var p = due[0], x = p.entry;
        append({ t: p.at, actor: x.actor || "twin", op: x.op, target: x.target, data: x.data, why: x.why || "clock.settle", source: "clock",
          settles: { from: p.from, i: p.i }, schedule: x.schedule });
      }
    } finally { settling = false; }
  }
  // A schedule tree is checked whole before anything is appended (architect.aws.a's review of 4aca0ee): every op known,
  // every at a time and never before the entry (or step) that schedules it. Otherwise refused, journal unchanged.
  function checkSchedule(list, notBefore, depth) {
    if (!Array.isArray(list) || depth > 16) throw new Error("twin: a schedule is a list, at most 16 deep");
    return list.map(function (x) {
      if (!x || !own(OPS, x.op)) throw new Error("twin: no operation " + (x && x.op));
      var at = Date.parse(x.at);
      if (!isFinite(at)) throw new Error("twin: a scheduled step needs a time");
      if (at < notBefore) throw new Error("twin: a step cannot be scheduled before the entry that schedules it (" + new Date(at).toISOString() + " < " + new Date(notBefore).toISOString() + ")");
      return { at: new Date(at).toISOString(), op: x.op, target: x.target || null, data: x.data, actor: x.actor || null, why: x.why || null,
        schedule: x.schedule ? checkSchedule(x.schedule, at, depth + 1) : undefined };
    });
  }
  function append(e) {
    var full = { seq: journal.length + 1, t: e.t || nowIso(), actor: e.actor || "twin", op: e.op, target: e.target || null,
      data: e.data, why: e.why || null, source: e.source || "twin" };
    if (e.settles) full.settles = e.settles;
    if (e.schedule) full.schedule = checkSchedule(e.schedule, Date.parse(full.t), 0);
    journal.push(full);
    if (state) apply(state, full);
    return full;
  }
  // Append an entry to the journal and apply it to the live world; anything the clock owes is emitted first.
  function record(e) { settle(); return append(e); }
  // Who made a call: the twin's credentials name the role (ASIATWINREAD, ASIATWINCHANGE).
  function actorOf(init) { var m = /Credential=ASIATWIN(\w+)/.exec(hdr(init, "authorization") || ""); return m ? "role:sws-aws-platform-" + m[1].toLowerCase() : "anonymous"; }

  // ---- the synthetic account ----
  var B = {
    site: ACCOUNT + "--demo-site--" + REGION,
    logs: ACCOUNT + "--demo-cloudfront-logs--" + REGION,
    deps: ACCOUNT + "--demo-lambda-deps--" + REGION,
    trail: "aws-cloudtrail-logs-" + ACCOUNT + "-demo",
    dotted: "demo.static.example"
  };
  var state = null;
  // A derivation (design 02 step 3): one entry per delivered CloudFront log file, { at: ISO hour, lines: [parsed
  // lines] }, read from the log objects' recipes in the world, in the order they were put. The CloudWatch metrics
  // are built from these (lambda.aws.a's patch). Kept on the world, not enumerable, so a refold makes it afresh.
  var LOG_HOUR = /^cloudfront\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\//;
  function hoursOf(w) {
    if (w._hours) return w._hours;
    var logs = w.objects[B.logs] || map(), out = [];
    Object.keys(logs).forEach(function (k) {
      var m = LOG_HOUR.exec(k), spec = logs[k].spec;
      if (!m || !spec || spec.gzipText == null) return;
      out.push({ at: m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":00:00Z", lines: spec.gzipText.split("\n").filter(Boolean).map(function (l) { return JSON.parse(l); }) });
    });
    Object.defineProperty(w, "_hours", { value: out, enumerable: false, configurable: true });
    return out;
  }
  // ---- Loading the pack (design 02 step 2; architect.aws.a's conditions on 74c254d) ----
  // The pack's JSON comes from, in order: window.AwsTwinPacks set before this file runs ({ <id>: pack }, used by
  // tests that run twin.js alone); in a page served over http(s), twin/packs/<id>.json next to this script; else
  // the in-code PACKS above (until the harnesses and the page menu move over, then PACKS goes). It is parsed with
  // JSON.parse only, at most PACK_MAX bytes, and checked against the generators and their fields before use: an
  // unknown generator or field, or a value out of range, is refused. While it loads, handle() waits; if it fails,
  // every AWS request gets an AWS-shaped 503 and nothing reaches the network (design 01's fail-closed rule).
  var PACK_MAX = 65536, PACK_ID = /^[a-z0-9-]{1,32}$/;
  var NO_PARAMS = {};
  var GEN_FIELDS = {
    "s3.cors": NO_PARAMS, "site.static": NO_PARAMS, "lambda.dependencies": NO_PARAMS, "cloudtrail.demo": NO_PARAMS, "site.dotted": NO_PARAMS, "iam.roles": NO_PARAMS,
    "site.archive": { pages: "int:0:5000" },
    "cloudfront.traffic": { days: "ints:1:28", hours: "ints:0:23", perHour: "int:0:1000", hot: "path?", hotShare: "share?", probe: "probe?" }
  };
  function packError(id, what) { return new Error("twin: pack " + id + ": " + what); }
  function only(id, where, o, allowed) {
    Object.keys(o).forEach(function (k) { if (!own(allowed, k)) throw packError(id, where + " has an unknown field " + k); });
  }
  function checkValue(id, where, kind, v) {
    var opt = /\?$/.test(kind), k = kind.replace(/\?$/, "").split(":");
    if (v === undefined && opt) return;
    var isInt = function (x, lo, hi) { return typeof x === "number" && Math.floor(x) === x && x >= lo && x <= hi; };
    var bad = function () { throw packError(id, where + " is not " + kind); };
    if (k[0] === "int") { if (!isInt(v, +k[1], +k[2])) bad(); }
    else if (k[0] === "ints") { if (!Array.isArray(v) || !v.length || v.length > 31 || !v.every(function (x) { return isInt(x, +k[1], +k[2]); })) bad(); }
    else if (k[0] === "path") { if (typeof v !== "string" || !/^\/[\x21-\x7e]{0,199}$/.test(v)) bad(); }
    else if (k[0] === "share") { if (typeof v !== "number" || !(v >= 0 && v <= 1)) bad(); }
    else if (k[0] === "probe") {
      if (!v || typeof v !== "object" || Array.isArray(v)) bad();
      only(id, where, v, { day: 1, ip: 1, perHourStep: 1 });
      checkValue(id, where + ".day", "int:1:28", v.day); checkValue(id, where + ".perHourStep", "int:0:200", v.perHourStep);
      if (typeof v.ip !== "string" || !/^(\d{1,3}\.){3}\d{1,3}$/.test(v.ip)) throw packError(id, where + ".ip is not an IPv4 address");
    } else bad();
  }
  function checkPack(o, id) {
    if (!o || typeof o !== "object" || Array.isArray(o)) throw packError(id, "not an object");
    only(id, "the pack", o, { id: 1, title: 1, about: 1, seed: 1, see: 1, generate: 1 });
    if (o.id !== id) throw packError(id, "its id is " + JSON.stringify(o.id));
    ["title", "about"].forEach(function (f) { if (typeof o[f] !== "string" || !o[f] || o[f].length > 300) throw packError(id, f + " is not a short text"); });
    checkValue(id, "seed", "int:0:2147483647", o.seed);
    if (o.see !== undefined) {
      if (!o.see || typeof o.see !== "object" || Array.isArray(o.see)) throw packError(id, "see is not an object");
      only(id, "see", o.see, { label: 1, bucket: 1, prefix: 1 });
      if (typeof o.see.label !== "string" || o.see.label.length > 200 || typeof o.see.bucket !== "string" || !own(B, o.see.bucket) ||
        typeof o.see.prefix !== "string" || o.see.prefix.length > 200 || /(^|\/)\.\.(\/|$)/.test(o.see.prefix)) throw packError(id, "see is not { label, bucket, prefix }");
    }
    if (!Array.isArray(o.generate) || !o.generate.length || o.generate.length > 32) throw packError(id, "generate is not a list of 1 to 32 generators");
    var lines = 0;
    o.generate.forEach(function (g, i) {
      var where = "generate[" + i + "]";
      if (!g || typeof g !== "object" || typeof g.gen !== "string" || !own(GEN_FIELDS, g.gen)) throw packError(id, where + " names no generator the twin has");
      var fields = GEN_FIELDS[g.gen], allowed = { gen: 1 };
      Object.keys(fields).forEach(function (f) { allowed[f] = 1; checkValue(id, where + "." + f, fields[f], g[f]); });
      only(id, where, g, allowed);
      if (g.gen === "cloudfront.traffic") {
        if ((g.hot === undefined) !== (g.hotShare === undefined)) throw packError(id, where + ": hot and hotShare go together");
        lines += g.days.length * g.hours.length * g.perHour;
      }
    });
    if (lines > 100000) throw packError(id, "more than 100,000 log lines");
    return o;
  }
  var loaded = null, loadError = null;
  var scriptUrl = (root.document && root.document.currentScript && root.document.currentScript.src) || "";
  var ready = (function () {
    try {
      var pre = root.AwsTwinPacks;
      if (pre && typeof pre === "object") {
        if (!own(pre, pack)) throw packError(pack, "not among the packs given");
        loaded = checkPack(JSON.parse(JSON.stringify(pre[pack])), pack);
        return Promise.resolve();
      }
      if (/^https?:/.test(scriptUrl) && typeof root.fetch === "function" && PACK_ID.test(pack)) {
        return root.fetch(new URL("twin/packs/" + pack + ".json", scriptUrl).href, { credentials: "same-origin" }).then(function (r) {
          if (!r.ok) throw packError(pack, "the file answered " + r.status);
          return r.text();
        }).then(function (t) {
          if (t.length > PACK_MAX) throw packError(pack, "the file is over " + PACK_MAX + " bytes");
          loaded = checkPack(JSON.parse(t), pack);
        }).catch(function (e) { loadError = e; });
      }
      loaded = checkPack(JSON.parse(JSON.stringify(PACKS[pack])), pack);
    } catch (e) { loadError = e; }
    return Promise.resolve();
  })();
  function thePack() { if (!loaded) throw loadError || packError(pack, "not loaded yet"); return loaded; }
  // The pack builds the account by appending entries; nothing else writes the world.
  function build() {
    if (state) return state;
    state = emptyWorld();
    var source = "pack:" + pack;
    // body: a string (text), or a recipe ({ gzipText } or { zip }).
    function put(bucket, key, type, body, when, why) {
      var modified = when || "2026-11-20T09:00:00.000Z";
      record({ t: modified, actor: source, source: source, why: why || "pack.seed", op: "s3.putObject", target: "arn:aws:s3:::" + bucket + "/" + key,
        data: { bucket: bucket, key: key, type: type, modified: modified, body: typeof body === "string" ? { text: body } : body } });
    }
    var G = {};
    G["s3.cors"] = function () {
    var origin = root.location ? root.location.origin : "http://localhost";
    [B.logs, B.deps, B.trail, B.dotted].forEach(function (b) {
      record({ t: "2026-11-18T09:00:00.000Z", actor: source, source: source, why: "pack.seed", op: "s3.putBucketCors", target: "arn:aws:s3:::" + b,
        data: { bucket: b, cors: { CorsRules: [{ Id: "sws-aws-platform", AllowedOrigins: [origin], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], ExposedHeaders: ["ETag", "Content-Type", "Content-Length", "Last-Modified"], MaxAge: 3000 }] } } });
    });
    };
    // a small static site
    G["site.static"] = function () {
    put(B.site, "index.html", "text/html", "<!doctype html>\n<html lang=\"en-GB\">\n<head><title>Demo site</title></head>\n<body><h1>Demo site</h1><p>Served from S3 through CloudFront.</p></body>\n</html>\n");
    put(B.site, "assets/site.css", "text/css", "body { font: 16px/1.5 system-ui; }\nh1 { color: #2456c7; }\n");
    put(B.site, "data/vaults.json", "application/json", JSON.stringify({ vaults: [{ id: "vault-demo-001", files: 42, region: REGION }, { id: "vault-demo-002", files: 7, region: "eu-west-1" }] }));
    put(B.site, "config/site.yaml", "application/x-yaml", "site: demo\nregion: eu-west-2\ncache:\n  ttl: 3600   # seconds\n  enabled: true\nlogs: s3://" + B.logs + "/\n");
    };
    // CloudFront logs delivered by Firehose: one gzip of JSON lines per hour
    G["cloudfront.traffic"] = function (P) {
    var paths = ["/", "/index.html", "/assets/site.css", "/data/vaults.json", "/vault/vault-demo-001/files", "/vault/vault-demo-002/files", "/favicon.ico"];
    P.days.forEach(function (day) { P.hours.forEach(function (hour) {
      var lines = [];
      for (var i = 0; i < P.perHour; i++) {
        var p = P.hot && rnd() < P.hotShare ? P.hot : pick(paths);
        lines.push(JSON.stringify(enrich({ timestamp: "2026-11-" + day + "T" + pad(hour) + ":" + pad(Math.floor(rnd() * 60)) + ":" + pad(Math.floor(rnd() * 60)) + "Z",
          c_ip: VISITOR_IPS[Math.floor(rnd() * VISITOR_IPS.length)], cs_method: "GET", cs_uri_stem: p, sc_status: p === "/favicon.ico" ? 404 : 200,
          sc_bytes: Math.floor(rnd() * 9000 + 300), time_taken: +(rnd() * 0.2).toFixed(3), x_edge_location: pick(["LHR50-C1", "DUB2-C1", "AMS1-C1"]), cs_user_agent: pick(["Mozilla/5.0", "curl/8.5", "python-requests/2.32"]) })));
      }
      if (P.probe && day === P.probe.day) {
        // One address (TEST-NET-3, documentation range) probing, getting louder each hour.
        var probes = ["/.env", "/.git/config", "/wp-admin/", "/admin", "/config.json", "/backup.zip", "/vault/../../etc/passwd", "/vault/vault-demo-001/files?key=../../secrets", "/api/vaults?id=1%27%20OR%20%271%27=%271"];
        for (var a = 0; a < (hour - 8) * P.probe.perHourStep; a++) {
          var pr = pick(probes);
          lines.push(JSON.stringify(enrich({ timestamp: "2026-11-22T" + pad(hour) + ":" + pad(Math.floor(rnd() * 60)) + ":" + pad(Math.floor(rnd() * 60)) + "Z",
            c_ip: P.probe.ip, cs_method: pick(["GET", "GET", "POST"]), cs_uri_stem: pr, sc_status: pick([403, 404, 404, 400]), sc_bytes: Math.floor(rnd() * 400 + 100),
            time_taken: +(rnd() * 0.05).toFixed(3), x_edge_location: "AMS1-C1", cs_user_agent: pick(["sqlmap/1.8", "Nuclei - Open-source project", "curl/8.5"]) })));
        }
        lines.sort();
      }
      put(B.logs, "cloudfront/2026/11/" + day + "/" + pad(hour) + "/demo-distribution-1-2026-11-" + day + "-" + pad(hour) + "-00-00.gz", "application/x-gzip", { gzipText: lines.join("\n") + "\n" }, "2026-11-" + day + "T" + pad(hour) + ":59:00.000Z", "cloudfront.traffic");
    }); });
    };
    // Lambda dependencies as zips
    G["lambda.dependencies"] = function () {
    put(B.deps, "lambdas-dependencies/demo-handler==v1.0.0.zip", "application/zip", { zip: [
      ["demo_handler/__init__.py", "from .handler import run\n"],
      ["demo_handler/handler.py", "import json\n\n\ndef run(event, context):\n    # Return the vault ids in the request\n    body = json.loads(event.get('body') or '{}')\n    return {'statusCode': 200, 'body': json.dumps({'vaults': body.get('vaults', [])})}\n"],
      ["demo_handler-1.0.0.dist-info/METADATA", "Metadata-Version: 2.1\nName: demo-handler\nVersion: 1.0.0\n"],
      ["config.json", JSON.stringify({ timeout: 30, memory: 256, region: REGION })]
    ] }, "2026-11-18T16:54:00.000Z", "lambda.dependencies");
    };
    // CloudTrail log files: one per region and five minutes. IAM is global, so its events are written under us-east-1.
    G["cloudtrail.demo"] = function () {
    function trailEvent(n, e) {
      var role = e.write ? "sws-aws-platform-change" : "sws-aws-platform-read";
      return { eventVersion: "1.09", userIdentity: { type: "AssumedRole", principalId: "AROATWIN" + (e.write ? "CHANGE" : "READ") + ":sws-aws-platform",
          arn: "arn:aws:sts::" + ACCOUNT + ":assumed-role/" + role + "/sws-aws-platform", accountId: ACCOUNT, accessKeyId: "ASIATWIN" + (e.write ? "CHANGE" : "READ"),
          sessionContext: { sessionIssuer: { type: "Role", principalId: "AROATWIN" + (e.write ? "CHANGE" : "READ"), arn: "arn:aws:iam::" + ACCOUNT + ":role/" + role, accountId: ACCOUNT, userName: role },
            webIdFederationData: { federatedProvider: "accounts.google.com" }, attributes: { creationDate: "2026-11-22T10:00:00Z", mfaAuthenticated: "false" } } },
        eventTime: e.time, eventSource: e.source, eventName: e.name, awsRegion: e.region, sourceIPAddress: OPERATOR_IP, userAgent: "Mozilla/5.0",
        requestParameters: e.params, responseElements: null, requestID: "TWIN-REQ-" + pad(n, 4), eventID: "00000000-0000-4000-8000-" + pad(n, 12),
        readOnly: !e.write, eventType: "AwsApiCall", managementEvent: !e.data, recipientAccountId: ACCOUNT, eventCategory: e.data ? "Data" : "Management" };
    }
    function trailFile(region, stamp, events, modified) {
      put(B.trail, "AWSLogs/" + ACCOUNT + "/CloudTrail/" + region + "/2026/11/22/" + ACCOUNT + "_CloudTrail_" + region + "_" + stamp + "_demo.json.gz", "application/x-gzip",
        { gzipText: JSON.stringify({ Records: events }) }, modified, "cloudtrail.delivery");
    }
    trailFile(REGION, "20261122T1005Z", [trailEvent(1, { time: "2026-11-22T10:01:02Z", source: "s3.amazonaws.com", name: "GetObject", region: REGION, data: true, params: { bucketName: B.site, key: "data/vaults.json" } })], "2026-11-22T10:05:00.000Z");
    trailFile("us-east-1", "20261122T1005Z", [trailEvent(2, { time: "2026-11-22T10:04:40Z", source: "iam.amazonaws.com", name: "UpdateAssumeRolePolicy", region: "us-east-1", write: true, params: { roleName: "sovereignwebsite-factory-dns", policyDocument: "(the new trust policy)" } })], "2026-11-22T10:05:00.000Z");
    };
    // A folder of more than 1000 keys, so listing pages (max-keys, continuation token) as S3 does.
    G["site.archive"] = function (P) {
    for (var a = 1; a <= P.pages; a++) put(B.site, "archive/2026/page-" + pad(a, 4) + ".json", "application/json", "{\"page\":" + a + "}");
    };
    // A bucket with dots in its name: S3 is reached by the path form for these.
    G["site.dotted"] = function () {
    put(B.dotted, "index.html", "text/html", "<!doctype html>\n<html lang=\"en-GB\"><head><title>Dotted bucket</title></head><body><p>A bucket whose name has dots.</p></body></html>\n");
    };
    G["iam.roles"] = function () {
    var K = "token.actions.githubusercontent.com:sub";
    function platformTrust() {
      return { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Federated: "accounts.google.com" }, Action: "sts:AssumeRoleWithWebIdentity",
        Condition: { StringEquals: { "accounts.google.com:aud": "twin-client-id.apps.googleusercontent.com", "accounts.google.com:sub": "000000000000000000001" } } }] };
    }
    var roles = { "sws-aws-platform-read": platformTrust(), "sws-aws-platform-change": platformTrust(), "sovereignwebsite-factory-dns": { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Federated: "arn:aws:iam::" + ACCOUNT + ":oidc-provider/token.actions.githubusercontent.com" }, Action: "sts:AssumeRoleWithWebIdentity",
      Condition: { StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com", [K]: ["repo:SovereignWebsite@358722364/SovereignWebsite__IaC@1464324035:environment:apply", "repo:SovereignWebsite@358722364/SovereignWebsite__Factory@1464324035:environment:apply"] } } }] } };
    // IAM read answers (design 04, dev.2.aws.a): the four demo roles the Lambda and Firehose twins run as, each
    // trusting the service that runs as it, and every role's details, policies and last use (iamSeed).
    function serviceTrust(svc) { return { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: svc }, Action: "sts:AssumeRole" }] }; }
    roles["demo-handler-role"] = serviceTrust("lambda.amazonaws.com");
    roles["demo-log-enricher-role"] = serviceTrust("lambda.amazonaws.com");
    roles["demo-nightly-report-role"] = serviceTrust("lambda.amazonaws.com");
    roles["demo-cloudfront-logs-firehose"] = serviceTrust("firehose.amazonaws.com");
    var details = iamSeed();
    Object.keys(roles).forEach(function (name) {
      record({ t: "2026-11-18T09:00:00.000Z", actor: source, source: source, why: "pack.seed", op: "iam.createRole", target: "arn:aws:iam::" + ACCOUNT + ":role/" + name, data: { name: name, trust: roles[name], details: details[name] } });
    });
    };
    // The pack's generators, in its order (the random stream is shared, so the order is part of the pack).
    thePack().generate.forEach(function (g) {
      if (!own(G, g.gen)) throw new Error("twin: pack " + pack + " names no generator " + g.gen);
      G[g.gen](g);
    });
    return state;
  }

  // ---- wire helpers ----
  function xml(body, status) { return new Response(body, { status: status || 200, headers: { "content-type": "text/xml" } }); }
  function xmlErr(code, msg, status) { return xml("<ErrorResponse><Error><Code>" + code + "</Code><Message>" + esc(msg) + "</Message></Error></ErrorResponse>", status || 400); }
  function json(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/x-amz-json-1.0" } }); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function hdr(init, name) { var h = init.headers || {}; for (var k in h) if (k.toLowerCase() === name) return h[k]; return null; }
  // A stable synthetic ETag: 32 hex digits like S3's (S3's is an MD5 for a single-part upload; this one is not).
  function etag(b) { var h = "", c = crc32(b); for (var i = 0; i < 4; i++) { c = (Math.imul(c ^ (c >>> 15), 2246822507) ^ i) >>> 0; h += ("0000000" + c.toString(16)).slice(-8); } return h; }
  // Continuation tokens are opaque to the caller: here, the last key returned, as hex.
  function toToken(k) { return Array.prototype.map.call(enc.encode(k), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function fromToken(t) { var b = new Uint8Array((t.match(/../g) || []).map(function (h) { return parseInt(h, 16); })); return new TextDecoder().decode(b); }
  function signed(init) { var a = hdr(init, "authorization"); return a && /Credential=ASIATWIN/.test(a); }
  function collapse(v) { return Array.isArray(v) ? (v.length === 1 ? collapse(v[0]) : v.map(collapse)) : v && typeof v === "object" ? Object.keys(v).reduce(function (o, k) { o[k] = collapse(v[k]); return o; }, {}) : v; }

  // ---- services ----
  function sts(form, init) {
    var A = form.get("Action");
    if (A === "AssumeRoleWithWebIdentity") {
      var role = (form.get("RoleArn") || "").split(":role/")[1] || "", exp = new Date(Date.now() + 3600e3).toISOString();
      if (!/^sws-aws-platform-(read|change)$/.test(role)) return xmlErr("AccessDenied", "Not authorized to perform sts:AssumeRoleWithWebIdentity", 403);
      return xml("<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>ASIATWIN" + (role === "sws-aws-platform-change" ? "CHANGE" : "READ") + "</AccessKeyId><SecretAccessKey>twin-secret</SecretAccessKey><SessionToken>twin-session-token</SessionToken><Expiration>" + exp + "</Expiration></Credentials><AssumedRoleUser><Arn>arn:aws:sts::" + ACCOUNT + ":assumed-role/" + role + "/sws-aws-platform</Arn></AssumedRoleUser></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>");
    }
    if (!signed(init)) return xmlErr("MissingAuthenticationToken", "Request is missing Authentication Token", 403);
    if (A === "GetCallerIdentity") {
      var who = /Credential=ASIATWIN(\w+)/.exec(hdr(init, "authorization"))[1] === "CHANGE" ? "sws-aws-platform-change" : "sws-aws-platform-read";
      return xml("<GetCallerIdentityResponse><GetCallerIdentityResult><Arn>arn:aws:sts::" + ACCOUNT + ":assumed-role/" + who + "/sws-aws-platform</Arn><Account>" + ACCOUNT + "</Account></GetCallerIdentityResult></GetCallerIdentityResponse>");
    }
    return xmlErr("InvalidAction", "Not in the twin yet: sts " + A);
  }
  // IAM's read answers (design 04). The platform roles' policies mirror site/cloudformation/bootstrap.yaml (a test
  // checks the names match); the demo roles' policies are synthetic. AWS managed policies are attached by ARN, and
  // their documents are a placeholder marked "TwinPlaceholder": AWS's own text is long and changes, so the twin
  // does not copy it. No permissions boundaries yet: they wait for decision 6 (P-IAM-001 v2.4), as on the real
  // account today. Shapes checked by boto3.aws.a against AWS's IAM API reference (docs/boto3/
  // 2026-11-23__06-iam-read-shapes.md, work/boto3.aws.a a83ea2f), except two it could not settle, marked here:
  // an empty <RoleLastUsed/> for a role not used in 400 days (AWS does not say empty or absent; readers take both),
  // and the error envelope (ErrorResponse > Error > Code, Message).
  // Looked up by request values: no prototype, so __proto__ or constructor is a missing entry (security.aws.a, 852c1fe).
  var AWS_MANAGED = Object.assign(Object.create(null), { "arn:aws:iam::aws:policy/SecurityAudit": "SecurityAudit", "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess": "ViewOnlyAccess" });
  function iamSeed() {
    var stmt = function (sid, action, resource, extra) { var o = { Sid: sid, Effect: "Allow", Action: action, Resource: resource }; for (var k in extra || {}) o[k] = extra[k]; return o; };
    var doc = function () { return { Version: "2012-10-17", Statement: [].slice.call(arguments) }; };
    var role = function (o) { o.path = "/"; o.maxSession = 3600; o.attached = o.attached || []; o.inline = o.inline || {}; return o; };
    var logs = function (fn) { return { "logs-write": doc(stmt("OwnLogGroup", ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "arn:aws:logs:" + REGION + ":" + ACCOUNT + ":log-group:/aws/lambda/" + fn + ":*")) }; };
    var R = "arn:aws:iam::" + ACCOUNT + ":role/";
    return {
      "sws-aws-platform-read": role({ id: 1, created: "2026-11-22T09:58:00Z", description: "Read-only view of this account from the AWS platform site, the owner's Google sign-in only",
        lastUsed: { when: "2026-11-22T10:01:02Z", region: REGION }, attached: ["arn:aws:iam::aws:policy/job-function/ViewOnlyAccess", "arn:aws:iam::aws:policy/SecurityAudit"],
        inline: { "costs-read": doc(stmt("BudgetsAndCostExplorerRead", ["budgets:ViewBudget", "budgets:DescribeBudgetAction", "budgets:DescribeBudgetActionsForAccount", "ce:GetCostAndUsage", "ce:GetCostForecast", "ce:GetDimensionValues"], "*")),
          "s3-browse": doc(stmt("S3ListAndOpen", ["s3:Get*", "s3:List*"], "*"), stmt("CloudControlListBuckets", ["cloudformation:ListResources", "cloudformation:GetResource"], "*")) } }),
      "sws-aws-platform-change": role({ id: 2, created: "2026-11-22T09:58:00Z", description: "The changes the owner approves on the AWS platform site; grows only by a reviewed change to this template",
        lastUsed: { when: "2026-11-22T10:04:40Z", region: "us-east-1" },
        inline: { "dns-role-trust-only": doc(stmt("TheDnsRoleTrustPolicy", ["iam:GetRole", "iam:UpdateAssumeRolePolicy"], R + "sovereignwebsite-factory-dns")),
          "s3-cors": doc(stmt("BucketCorsThroughCloudControl", ["s3:Get*", "s3:List*", "s3:PutBucketCORS", "cloudformation:GetResource", "cloudformation:ListResources", "cloudformation:UpdateResource", "cloudformation:GetResourceRequestStatus"], "*")),
          "self-update": doc(
            stmt("ThisStackOnly", ["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents", "cloudformation:GetTemplate", "cloudformation:GetTemplateSummary", "cloudformation:CreateChangeSet", "cloudformation:DescribeChangeSet", "cloudformation:ExecuteChangeSet", "cloudformation:DeleteChangeSet"], "arn:aws:cloudformation:us-east-1:" + ACCOUNT + ":stack/sws-aws-platform/*"), // ${AWS::Region} of the hub's stack: the page calls CloudFormation in us-east-1
            stmt("ValidateTemplates", "cloudformation:ValidateTemplate", "*"),
            stmt("ThePlatformRolesThroughCloudFormationOnly", ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListRoleTags", "iam:UpdateRole", "iam:UpdateRoleDescription", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:DetachRolePolicy", "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole"], R + "sws-aws-platform-*",
              { Condition: { "ForAnyValue:StringEquals": { "aws:CalledVia": "cloudformation.amazonaws.com" } } }),
            stmt("AttachOnlyTheseManagedPolicies", "iam:AttachRolePolicy", R + "sws-aws-platform-*",
              { Condition: { "ForAnyValue:StringEquals": { "aws:CalledVia": "cloudformation.amazonaws.com" }, ArnEquals: { "iam:PolicyARN": ["arn:aws:iam::aws:policy/job-function/ViewOnlyAccess", "arn:aws:iam::aws:policy/SecurityAudit"] } } })) } }),
      // Made by the IaC repository's own stack, outside this account's platform template: no policies seeded here.
      "sovereignwebsite-factory-dns": role({ id: 3, created: "2026-11-15T09:00:00Z", description: "DNS changes from the Factory and IaC repositories' apply environment", lastUsed: null }),
      "demo-handler-role": role({ id: 4, created: "2026-11-18T16:50:00Z", description: "Lets demo-handler write its logs", lastUsed: null, inline: logs("demo-handler") }),
      "demo-log-enricher-role": role({ id: 5, created: "2026-11-19T10:10:00Z", description: "Lets demo-log-enricher write its logs", lastUsed: null, inline: logs("demo-log-enricher") }),
      "demo-nightly-report-role": role({ id: 6, created: "2026-11-17T22:35:00Z", description: "Lets demo-nightly-report write its logs", lastUsed: null, inline: logs("demo-nightly-report") }),
      "demo-cloudfront-logs-firehose": role({ id: 7, created: "2026-11-19T10:15:00Z", description: "Lets the demo-cloudfront-logs stream write to its bucket and call its processor", lastUsed: null,
        inline: { "deliver-to-s3": doc(stmt("WriteLogs", ["s3:PutObject", "s3:GetBucketLocation", "s3:ListBucket"], ["arn:aws:s3:::" + B.logs, "arn:aws:s3:::" + B.logs + "/*"]),
          stmt("CallProcessor", ["lambda:InvokeFunction", "lambda:GetFunctionConfiguration"], "arn:aws:lambda:" + REGION + ":" + ACCOUNT + ":function:demo-log-enricher:*")) } })
    };
  }
  var IAM_NS = " xmlns=\"https://iam.amazonaws.com/doc/2010-05-08/\"";
  function iamOk(action, inner) {
    return xml("<" + action + "Response" + IAM_NS + "><" + action + "Result>" + inner + "</" + action + "Result><ResponseMetadata><RequestId>00000000-0000-4000-8000-0000000000aa</RequestId></ResponseMetadata></" + action + "Response>");
  }
  function iamPage(list, form, itemXml, cap) {
    // IAM may return fewer than MaxItems even when more exist (AWS's IAM API reference, on IsTruncated); the twin
    // pages roles two at a time so the paging path runs. Marker is opaque: here, the index to start from.
    // A Marker the twin did not issue is a 400 InvalidInput, as IAM answers a bad one (security.aws.a, 852c1fe).
    var max = Math.min(+(form.get("MaxItems") || 100), cap || 1000), from = 0;
    if (form.get("Marker")) { try { from = +atob(form.get("Marker")); } catch (e) { from = NaN; } }
    if (!(from >= 0 && from === Math.floor(from))) return null;
    var page = list.slice(from, from + max), more = from + max < list.length;
    return { items: page.map(itemXml).join(""), tail: "<IsTruncated>" + more + "</IsTruncated>" + (more ? "<Marker>" + btoa(String(from + max)) + "</Marker>" : "") };
  }
  function iamRoleXml(s, name, withLastUsed) {
    var m = s.iam[name] || { path: "/", maxSession: 3600, created: "2026-11-15T09:00:00Z", id: 0 };
    return "<Path>" + m.path + "</Path><RoleName>" + esc(name) + "</RoleName><RoleId>AROATWIN" + ("0000000000000" + m.id).slice(-13) + "</RoleId>" +
      "<Arn>arn:aws:iam::" + ACCOUNT + ":role" + m.path + esc(name) + "</Arn><CreateDate>" + m.created + "</CreateDate>" +
      "<AssumeRolePolicyDocument>" + encodeURIComponent(JSON.stringify(s.roles[name])) + "</AssumeRolePolicyDocument>" +
      (m.description ? "<Description>" + esc(m.description) + "</Description>" : "") + "<MaxSessionDuration>" + m.maxSession + "</MaxSessionDuration>" +
      (withLastUsed ? "<RoleLastUsed>" + (m.lastUsed ? "<LastUsedDate>" + m.lastUsed.when + "</LastUsedDate><Region>" + m.lastUsed.region + "</Region>" : "") + "</RoleLastUsed>" : "");
  }
  function badMarker() { return xmlErr("InvalidInput", "Invalid Marker.", 400); }
  function iam(form, init) {
    if (!signed(init)) return xmlErr("MissingAuthenticationToken", "Request is missing Authentication Token", 403);
    var s = build(), A = form.get("Action"), name = form.get("RoleName"), page;
    if (A === "ListRoles") {
      page = iamPage(Object.keys(s.roles).sort(), form, function (n) { return "<member>" + iamRoleXml(s, n, false) + "</member>"; }, 2);
      if (!page) return badMarker();
      return iamOk("ListRoles", "<Roles>" + page.items + "</Roles>" + page.tail);
    }
    if (A === "GetOpenIDConnectProvider") {
      if (form.get("OpenIDConnectProviderArn") !== "arn:aws:iam::" + ACCOUNT + ":oidc-provider/token.actions.githubusercontent.com") return xmlErr("NoSuchEntity", "OpenIDConnect Provider not found for arn " + form.get("OpenIDConnectProviderArn"), 404);
      return iamOk("GetOpenIDConnectProvider", "<Url>token.actions.githubusercontent.com</Url><ClientIDList><member>sts.amazonaws.com</member></ClientIDList><CreateDate>2026-11-15T08:55:00Z</CreateDate>");
    }
    if (A === "ListOpenIDConnectProviders")
      return iamOk("ListOpenIDConnectProviders", "<OpenIDConnectProviderList><member><Arn>arn:aws:iam::" + ACCOUNT + ":oidc-provider/token.actions.githubusercontent.com</Arn></member></OpenIDConnectProviderList>");
    if (A === "GetPolicy" || A === "GetPolicyVersion") {
      var arn = form.get("PolicyArn"), pn = own(AWS_MANAGED, arn) ? AWS_MANAGED[arn] : null;
      if (!pn) return xmlErr("NoSuchEntity", "Policy " + arn + " does not exist or is not attachable.", 404);
      var path = arn.slice("arn:aws:iam::aws:policy".length, arn.lastIndexOf("/") + 1);
      if (A === "GetPolicy") return iamOk("GetPolicy", "<Policy><PolicyName>" + pn + "</PolicyName><PolicyId>ANPATWIN" + ("0000000000000" + pn.length).slice(-13) + "</PolicyId><Arn>" + arn + "</Arn><Path>" + path + "</Path>" +
        "<DefaultVersionId>v1</DefaultVersionId><AttachmentCount>1</AttachmentCount><IsAttachable>true</IsAttachable><Description>Twin placeholder for an AWS managed policy: its text is in AWS's documentation</Description>" +
        "<CreateDate>2026-11-01T00:00:00Z</CreateDate><UpdateDate>2026-11-01T00:00:00Z</UpdateDate></Policy>");
      if (form.get("VersionId") !== "v1") return xmlErr("NoSuchEntity", "Policy " + arn + " version " + form.get("VersionId") + " does not exist or is not attachable.", 404);
      return iamOk("GetPolicyVersion", "<PolicyVersion><Document>" + encodeURIComponent(JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "TwinPlaceholder", Effect: "Allow", Action: [], Resource: [] }] })) +
        "</Document><VersionId>v1</VersionId><IsDefaultVersion>true</IsDefaultVersion><CreateDate>2026-11-01T00:00:00Z</CreateDate></PolicyVersion>");
    }
    if (!s.roles[name]) return xmlErr("NoSuchEntity", "The role with name " + name + " cannot be found.", 404);
    var info = s.iam[name] || { attached: [], inline: {} };
    if (A === "GetRole") return iamOk("GetRole", "<Role>" + iamRoleXml(s, name, true) + "</Role>");
    if (A === "ListAttachedRolePolicies") {
      page = iamPage(info.attached, form, function (a) { return "<member><PolicyName>" + esc(AWS_MANAGED[a] || a.split("/").pop()) + "</PolicyName><PolicyArn>" + esc(a) + "</PolicyArn></member>"; });
      if (!page) return badMarker();
      return iamOk("ListAttachedRolePolicies", "<AttachedPolicies>" + page.items + "</AttachedPolicies>" + page.tail);
    }
    if (A === "ListRolePolicies") {
      page = iamPage(Object.keys(info.inline).sort(), form, function (n) { return "<member>" + esc(n) + "</member>"; });
      if (!page) return badMarker();
      return iamOk("ListRolePolicies", "<PolicyNames>" + page.items + "</PolicyNames>" + page.tail);
    }
    if (A === "GetRolePolicy") {
      var pol = form.get("PolicyName");
      if (!own(info.inline, pol)) return xmlErr("NoSuchEntity", "The role policy with name " + pol + " cannot be found.", 404);
      return iamOk("GetRolePolicy", "<RoleName>" + esc(name) + "</RoleName><PolicyName>" + esc(pol) + "</PolicyName><PolicyDocument>" + encodeURIComponent(JSON.stringify(info.inline[pol])) + "</PolicyDocument>");
    }
    if (A === "UpdateAssumeRolePolicy") {
      var p = JSON.parse(form.get("PolicyDocument")); p.Statement.forEach(function (st) { st.Condition = collapse(st.Condition); });
      record({ actor: actorOf(init), op: "iam.updateAssumeRolePolicy", target: "arn:aws:iam::" + ACCOUNT + ":role/" + name, data: { name: name, trust: p }, why: "plan.approve" });
      return xml("<UpdateAssumeRolePolicyResponse" + IAM_NS + "><ResponseMetadata><RequestId>00000000-0000-4000-8000-0000000000ab</RequestId></ResponseMetadata></UpdateAssumeRolePolicyResponse>");
    }
    return xmlErr("InvalidAction", "Not in the twin yet: iam " + A);
  }
  // ---- CloudFormation stacks (CF-1: every stack mapped to what it made) ----
  // Synthetic, as docs/cloudformation/seed/cloudformation.json; moves to site/twin/data/ with design 02.
  // sws-aws-platform is the hub's own stack: its status is state.stackStatus, so a plan applied in the twin shows here.
  var STACKS = [
    { name: "sws-aws-platform", region: "us-east-1", id: "00000000-0000-4000-8000-0000000c0001", created: "2026-11-20T09:12:00Z",
      description: "The hub's own stack: the read and change roles.",
      parameters: [["GoogleClientId", "twin-client-id.apps.googleusercontent.com"], ["GoogleSub", "000000000000000000000"]],
      outputs: [["ReadRoleArn", "arn:aws:iam::" + ACCOUNT + ":role/sws-aws-platform-read"], ["ChangeRoleArn", "arn:aws:iam::" + ACCOUNT + ":role/sws-aws-platform-change"]],
      resources: [["PlatformRead", "sws-aws-platform-read", "AWS::IAM::Role"], ["PlatformChange", "sws-aws-platform-change", "AWS::IAM::Role"]],
      events: [["2026-11-20T09:13:10Z", "sws-aws-platform", "AWS::CloudFormation::Stack", "CREATE_COMPLETE"],
        ["2026-11-20T09:13:00Z", "PlatformChange", "AWS::IAM::Role", "CREATE_COMPLETE"], ["2026-11-20T09:12:50Z", "PlatformRead", "AWS::IAM::Role", "CREATE_COMPLETE"],
        ["2026-11-20T09:12:00Z", "sws-aws-platform", "AWS::CloudFormation::Stack", "CREATE_IN_PROGRESS", "User Initiated"]] },
    { name: "demo-site", region: "eu-west-2", id: "00000000-0000-4000-8000-0000000c0002", created: "2026-11-18T14:00:00Z", status: "CREATE_COMPLETE",
      description: "The demo site: its bucket, a CloudFront distribution in front of it, and the distribution's logs bucket.",
      outputs: [["DistributionDomain", "d111111abcdef8.cloudfront.net", "demo-site-distribution-domain"]],
      resources: [["SiteBucket", B.site, "AWS::S3::Bucket"], ["LogsBucket", B.logs, "AWS::S3::Bucket"], ["Distribution", "EDEMOTWIN00001", "AWS::CloudFront::Distribution"]],
      events: [["2026-11-18T14:21:00Z", "demo-site", "AWS::CloudFormation::Stack", "CREATE_COMPLETE"], ["2026-11-18T14:20:30Z", "Distribution", "AWS::CloudFront::Distribution", "CREATE_COMPLETE"],
        ["2026-11-18T14:00:00Z", "demo-site", "AWS::CloudFormation::Stack", "CREATE_IN_PROGRESS", "User Initiated"]] },
    { name: "demo-dns", region: "eu-west-2", id: "00000000-0000-4000-8000-0000000c0003", created: "2026-11-18T15:00:00Z", status: "CREATE_COMPLETE",
      description: "The demo zone and its www alias to the demo site's distribution (imported from demo-site).", imports: ["demo-site-distribution-domain"],
      resources: [["Zone", "Z0DEMOTWIN0001", "AWS::Route53::HostedZone"], ["WwwAlias", "www.example.com", "AWS::Route53::RecordSet"]],
      events: [["2026-11-18T15:02:00Z", "demo-dns", "AWS::CloudFormation::Stack", "CREATE_COMPLETE"], ["2026-11-18T15:00:00Z", "demo-dns", "AWS::CloudFormation::Stack", "CREATE_IN_PROGRESS", "User Initiated"]] },
    { name: "demo-lambda", region: "eu-west-2", id: "00000000-0000-4000-8000-0000000c0004", created: "2026-11-19T11:00:00Z", updated: "2026-11-21T16:40:00Z", status: "UPDATE_ROLLBACK_COMPLETE",
      description: "One function, its role and its dependencies bucket.", parameters: [["HandlerVersion", "v1.0.0"]],
      resources: [["Handler", "demo-handler", "AWS::Lambda::Function", "UPDATE_COMPLETE"], ["HandlerRole", "demo-handler-role", "AWS::IAM::Role"], ["DepsBucket", B.deps, "AWS::S3::Bucket"]],
      events: [["2026-11-21T16:40:00Z", "demo-lambda", "AWS::CloudFormation::Stack", "UPDATE_ROLLBACK_COMPLETE"],
        ["2026-11-21T16:39:30Z", "Handler", "AWS::Lambda::Function", "UPDATE_COMPLETE"],
        ["2026-11-21T16:39:00Z", "demo-lambda", "AWS::CloudFormation::Stack", "UPDATE_ROLLBACK_IN_PROGRESS", "The following resource(s) failed to update: [Handler]."],
        ["2026-11-21T16:38:10Z", "Handler", "AWS::Lambda::Function", "UPDATE_FAILED", "(twin) The dependencies zip for v1.1.0 is not in the bucket."],
        ["2026-11-21T16:38:00Z", "demo-lambda", "AWS::CloudFormation::Stack", "UPDATE_IN_PROGRESS", "User Initiated"]] }
  ];
  function stackArn(st) { return "arn:aws:cloudformation:" + st.region + ":" + ACCOUNT + ":stack/" + st.name + "/" + st.id; }
  function stackStatus(s, st) { return st.name === "sws-aws-platform" ? s.stackStatus : st.status; }
  function stackUpdated(s, st) { return st.name === "sws-aws-platform" ? s.stackUpdated : st.updated; }
  function el(tag, v) { return v === undefined || v === null ? "" : "<" + tag + ">" + esc(v) + "</" + tag + ">"; }
  function members(list, f) { return (list || []).map(function (x) { return "<member>" + f(x) + "</member>"; }).join(""); }
  function stackEvents(s, st) {
    var ev = st.events.slice();
    if (st.name === "sws-aws-platform") ev = (s.stackEvents || []).concat(ev);
    return ev;
  }
  // The read calls. Each answers for the stacks in the region of the endpoint called, as real CloudFormation does.
  function cfnRead(s, A, form, region) {
    var here = STACKS.filter(function (st) { return st.region === region; });
    var find = function () {
      var n = form.get("StackName"), st = here.filter(function (x) { return x.name === n || stackArn(x) === n; })[0];
      return st || null;
    };
    var missing = function () { return xmlErr("ValidationError", "Stack with id " + form.get("StackName") + " does not exist", 400); };
    var wrap = function (name, inner) { return xml("<" + name + "Response><" + name + "Result>" + inner + "</" + name + "Result></" + name + "Response>"); };
    if (A === "ListStacks") return wrap("ListStacks", "<StackSummaries>" + members(here, function (st) {
      return el("StackId", stackArn(st)) + el("StackName", st.name) + el("TemplateDescription", st.description) + el("CreationTime", st.created) + el("LastUpdatedTime", stackUpdated(s, st)) + el("StackStatus", stackStatus(s, st));
    }) + "</StackSummaries>");
    if (A === "DescribeStacks") {
      var list = form.get("StackName") ? [find()] : here;
      if (!list[0] && form.get("StackName")) return missing();
      return wrap("DescribeStacks", "<Stacks>" + members(list, function (st) {
        return el("StackId", stackArn(st)) + el("StackName", st.name) + el("Description", st.description) +
          "<Parameters>" + members(st.parameters, function (p) { return el("ParameterKey", p[0]) + el("ParameterValue", p[1]); }) + "</Parameters>" +
          el("CreationTime", st.created) + el("LastUpdatedTime", stackUpdated(s, st)) + el("StackStatus", stackStatus(s, st)) +
          "<Outputs>" + members(st.outputs, function (o) { return el("OutputKey", o[0]) + el("OutputValue", o[1]) + el("ExportName", o[2]); }) + "</Outputs>";
      }) + "</Stacks>");
    }
    if (A === "ListStackResources") {
      var st = find(); if (!st) return missing();
      return wrap("ListStackResources", "<StackResourceSummaries>" + members(st.resources, function (r) {
        var status = r[3] || (/^UPDATE_COMPLETE$/.test(stackStatus(s, st)) ? "UPDATE_COMPLETE" : "CREATE_COMPLETE");
        return el("LogicalResourceId", r[0]) + el("PhysicalResourceId", r[1]) + el("ResourceType", r[2]) + el("LastUpdatedTimestamp", stackUpdated(s, st) || st.created) + el("ResourceStatus", status);
      }) + "</StackResourceSummaries>");
    }
    if (A === "DescribeStackEvents") {
      var se = find(); if (!se) return missing();
      return wrap("DescribeStackEvents", "<StackEvents>" + members(stackEvents(s, se).map(function (e, i) { return [e, i]; }), function (x) {
        var e = x[0], phys = e[1] === se.name ? stackArn(se) : (se.resources.filter(function (r) { return r[0] === e[1]; })[0] || [])[1];
        return el("StackId", stackArn(se)) + el("EventId", se.id + "-" + pad(x[1], 4)) + el("StackName", se.name) + el("LogicalResourceId", e[1]) + el("PhysicalResourceId", phys) +
          el("ResourceType", e[2]) + el("Timestamp", e[0]) + el("ResourceStatus", e[3]) + el("ResourceStatusReason", e[4]);
      }) + "</StackEvents>");
    }
    if (A === "ListExports") {
      var ex = []; here.forEach(function (st) { (st.outputs || []).forEach(function (o) { if (o[2]) ex.push([stackArn(st), o[2], o[1]]); }); });
      return wrap("ListExports", "<Exports>" + members(ex, function (e) { return el("ExportingStackId", e[0]) + el("Name", e[1]) + el("Value", e[2]); }) + "</Exports>");
    }
    if (A === "ListImports") {
      // An export can only be imported in its own region, so both lists are per region.
      var name = form.get("ExportName"), by = here.filter(function (st) { return (st.imports || []).indexOf(name) >= 0; });
      if (!by.length) return xmlErr("ValidationError", "Export '" + name + "' is not imported by any stack.", 400);
      return wrap("ListImports", "<Imports>" + members(by, function (st) { return esc(st.name); }) + "</Imports>");
    }
    return null;
  }
  // ---- Deploy plan step 4: a customer's account, where the Vault's stacks are created ----
  // The customer is a second account in the same journal (AWS's documentation example id). The twin credential
  // ASIATWINCUSTOMER calls as the customer's own administrator, as D3's recommended path has them do in their console.
  // Stacks follow cloudformation.aws.a's Vault stack 0.4.4 and iam.aws.a's vault-access 0.1.1. DeployMode one-stack
  // (the default): no RoleARN, the stack runs as the caller and makes its own boundary (VaultBoundary, wave 1);
  // access-stack: the -access stack makes the deploy role and boundary, and sws-vault-<id> is created with that role.
  // Resources appear wave by wave on
  // the twin clock (the distribution takes minutes), then the stack completes with its outputs. Not yet here: the
  // -edge stack, DNS and the health address answering, DeleteStack, and the CloudTrail records derived from these.
  var CUSTOMER = "444455556666", VAULT_TEMPLATE = "0.4.7-draft";
  // DeletionPolicy per vault.yaml 0.4.7: all three RetainExceptOnCreate, so kept on a later DeleteStack
  // (DELETE_SKIPPED) and deleted when the first create rolls back (AWS's DeletionPolicy page). Retain, kept on any
  // delete, is handled too, for templates that use it.
  var DELETION = { VaultBucket: "RetainExceptOnCreate", VaultLogs: "RetainExceptOnCreate", VaultBucketPolicy: "RetainExceptOnCreate" };
  // The function's image the twin treats as published and reachable from the customer's account. Any other ImageUri
  // fails VaultFunction in wave 3, the likeliest real failure (cloudformation.aws.a, O1: a cross-account repository
  // whose policy does not list the account yet, or a digest not in the region).
  var TWIN_IMAGE = "111122223333.dkr.ecr.eu-west-2.amazonaws.com/sws-vault@sha256:" + "0123456789abcdef".repeat(4);
  var IMAGE_PATTERN = /^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9._\/-]+@sha256:[0-9a-f]{64}$/, CUSTOMER_STACKS = 8;
  function customerOf(init) { return /Credential=ASIATWINCUSTOMER\//.test(hdr(init, "authorization") || "") ? CUSTOMER : null; }
  // [logical id, type, seconds to create], wave by wave; each wave starts a second after the last one ends.
  var VAULT_WAVES = {
    access: [[["VaultBoundary", "AWS::IAM::ManagedPolicy", 3]], [["DeployRole", "AWS::IAM::Role", 12]]],
    vault: [
      [["VaultBucket", "AWS::S3::Bucket", 3], ["AccessToken", "AWS::SecretsManager::Secret", 2], ["VaultLogs", "AWS::Logs::LogGroup", 1], ["HealthFunction", "AWS::CloudFront::Function", 4], ["VaultBoundary", "AWS::IAM::ManagedPolicy", 3]],
      [["VaultBucketPolicy", "AWS::S3::BucketPolicy", 2], ["VaultFunctionRole", "AWS::IAM::Role", 12]],
      [["VaultFunction", "AWS::Lambda::Function", 8]],
      [["VaultFunctionUrl", "AWS::Lambda::Url", 2], ["VaultFunctionUrlPermission", "AWS::Lambda::Permission", 1], ["VaultFunctionInvokePermission", "AWS::Lambda::Permission", 1]],
      [["VaultDistribution", "AWS::CloudFront::Distribution", 240]],
      [["VaultRecordA", "AWS::Route53::RecordSet", 35], ["VaultRecordAAAA", "AWS::Route53::RecordSet", 35]]
    ]
  };
  function vaultIds(account, region, name) {
    // Each stack its own stream, seeded from its name, so two stacks do not share ids (R-025 (d)).
    var seed = 20261124 + journal.length; for (var c = 0; c < name.length; c++) seed = (seed * 31 + name.charCodeAt(c)) & 0x7fffffff;
    // Its own stream per create (name and the journal position), so a stack made again under the same name gets new ids.
    var r = rng("vault.ids:" + account + "/" + region + "/" + name + "@" + journal.length, seed), pick = function (abc, n) { var o = ""; for (var i = 0; i < n; i++) o += abc[Math.floor(r() * abc.length)]; return o; };
    var lower = "abcdefghijklmnopqrstuvwxyz0123456789", upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return { stack: pick("0123456789abcdef", 8) + "-" + pick("0123456789abcdef", 4) + "-11ef-" + pick("0123456789abcdef", 4) + "-" + pick("0123456789abcdef", 12),
      url: pick(lower, 32), distribution: "E" + pick(upper, 13), cfDomain: "d" + pick(lower, 13) + ".cloudfront.net", secret: pick("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 6) };
  }
  function physicalOf(st, logical) {
    var id = st.params.VaultId, a = st.account, rg = st.region, x = st.ids;
    return { VaultBoundary: "arn:aws:iam::" + a + ":policy/sws-vault-" + id + "-boundary", DeployRole: "sws-vault-" + id + "-deploy",
      VaultBucket: "sws-vault-" + id + "-data-" + a + "-" + rg, AccessToken: "arn:aws:secretsmanager:" + rg + ":" + a + ":secret:sws-vault-" + id + "-token-" + x.secret,
      VaultLogs: "/aws/lambda/sws-vault-" + id + "-api", HealthFunction: "arn:aws:cloudfront::" + a + ":function/sws-vault-" + id + "-health",
      VaultBucketPolicy: "sws-vault-" + id + "-data-" + a + "-" + rg, VaultFunctionRole: "sws-vault-" + id + "-api", VaultFunction: "sws-vault-" + id + "-api",
      VaultFunctionUrl: "arn:aws:lambda:" + rg + ":" + a + ":function:sws-vault-" + id + "-api", VaultFunctionUrlPermission: "sws-vault-" + id + "-api-url",
      VaultFunctionInvokePermission: "sws-vault-" + id + "-api-invoke", VaultDistribution: x.distribution,
      VaultRecordA: st.params.DomainName || "", VaultRecordAAAA: st.params.DomainName || "" }[logical] || "";
  }
  function stackOutputs(st) {
    var p = st.params, x = st.ids, id = p.VaultId, a = st.account, rg = st.region, kv = function (k, v) { return { OutputKey: k, OutputValue: v }; };
    if (st.kind === "access") return [kv("DeployRoleArn", "arn:aws:iam::" + a + ":role/sws-vault-" + id + "-deploy"), kv("BoundaryArn", "arn:aws:iam::" + a + ":policy/sws-vault-" + id + "-boundary")];
    var base = p.DomainName ? "https://" + p.DomainName : "https://" + x.cfDomain;
    var out = [kv("Endpoint", base), kv("HealthCheck", base + "/api/info/health"), kv("DeployCheck", "https://" + x.cfDomain + "/health"),
      kv("TokenSecretArn", physicalOf(st, "AccessToken")), kv("BucketName", physicalOf(st, "VaultBucket")), kv("DistributionId", x.distribution),
      kv("VaultId", id), kv("AccountId", a), kv("Region", rg), kv("DeployMode", st.mode), kv("TemplateVersion", VAULT_TEMPLATE)];
    if (p.DomainName && !p.HostedZoneId) out.push(kv("DnsRecords", p.DomainName + " CNAME " + x.cfDomain));
    return out;
  }
  // The stack's steps on the clock, from the time it was created.
  function stackSchedule(st, t0) {
    var waves = VAULT_WAVES[st.kind].map(function (wv) {
      return wv.filter(function (r) {
        if (st.kind === "vault" && r[0] === "VaultBoundary") return st.mode === "one-stack";
        return !/^VaultRecordA/.test(r[0]) || (st.params.DomainName && st.params.HostedZoneId);
      });
    }).filter(function (wv) { return wv.length; });
    var out = [], at = Date.parse(t0) + 1000, base = { account: st.account, region: st.region, name: st.name };
    var ev = function (ms, logical, type, status, extra) { var d = Object.assign({ logical: logical, type: type, status: status }, base, extra || {});
      out.push({ at: new Date(ms).toISOString(), op: "cloudformation.stackEvent", target: st.stackId, data: d, actor: "aws:cloudformation", why: "clock.settle" }); };
    // A failure, if there is one: { logical, after (seconds into its wave), reason }. On it: what finished in that wave
    // stays CREATE_COMPLETE, the failing resource is CREATE_FAILED, the rest of the wave is cancelled (CREATE_FAILED),
    // ROLLBACK_IN_PROGRESS, everything touched is undone in reverse creation order (a made resource DELETE_IN_PROGRESS
    // then DELETE_COMPLETE; Retain DELETE_SKIPPED; RetainExceptOnCreate deleted, this being the first create), then
    // ROLLBACK_COMPLETE with no outputs. After boto3.aws.a's note 13 (work/boto3.aws.a 6b96561). The twin's own
    // choices, where AWS does not document them: the wording "Resource creation cancelled", the failure reasons, and
    // what a failed or cancelled resource shows in the rollback (DELETE_COMPLETE, or DELETE_SKIPPED if Retain).
    var fail = st.failure, touched = [];
    for (var wi = 0; wi < waves.length; wi++) {
      var wv = waves[wi], end = at, failing = fail && wv.some(function (r) { return r[0] === fail.logical; });
      var fAt = failing ? at + fail.after * 1000 : Infinity;
      wv.forEach(function (r) {
        ev(at, r[0], r[1], "CREATE_IN_PROGRESS");
        if (at + 400 < fAt) ev(at + 400, r[0], r[1], "CREATE_IN_PROGRESS", { physical: physicalOf(st, r[0]), reason: "Resource creation Initiated" });
        var doneAt = at + r[2] * 1000;
        if (r[0] === (fail || {}).logical && failing) touched.push([r, "failed"]);
        else if (doneAt <= fAt) { ev(doneAt, r[0], r[1], "CREATE_COMPLETE", { physical: physicalOf(st, r[0]) }); touched.push([r, "made"]); }
        else touched.push([r, "cancelled"]);
        end = Math.max(end, doneAt);
      });
      if (failing) {
        var stopped = touched.filter(function (x) { return x[1] !== "made"; });
        ev(fAt, fail.logical, wv.filter(function (r) { return r[0] === fail.logical; })[0][1], "CREATE_FAILED", { reason: fail.reason });
        stopped.forEach(function (x) { if (x[1] === "cancelled") ev(fAt + 100, x[0][0], x[0][1], "CREATE_FAILED", { reason: "Resource creation cancelled" }); });
        ev(fAt + 200, st.name, "AWS::CloudFormation::Stack", "ROLLBACK_IN_PROGRESS", { physical: st.stackId,
          reason: "The following resource(s) failed to create: [" + stopped.map(function (x) { return x[0][0]; }).sort().join(", ") + "]. Rollback requested by user." });
        var t = fAt + 1000;
        touched.slice().reverse().forEach(function (x) {
          var r = x[0], keep = DELETION[r[0]] === "Retain";
          if (keep) { ev(t, r[0], r[1], "DELETE_SKIPPED"); t += 300; return; }
          if (x[1] === "made") { ev(t, r[0], r[1], "DELETE_IN_PROGRESS"); t += 300; }
          ev(t, r[0], r[1], "DELETE_COMPLETE"); t += 300;
        });
        ev(t + 500, st.name, "AWS::CloudFormation::Stack", "ROLLBACK_COMPLETE", { physical: st.stackId });
        return out;
      }
      at = end + 1000;
    }
    ev(at, st.name, "AWS::CloudFormation::Stack", "CREATE_COMPLETE", { physical: st.stackId, outputs: stackOutputs(st) });
    return out;
  }
  function taken(acc, type, physical) { return !!(acc.retained && acc.retained[type + " " + physical]); }
  function cfnErr(code, msg, status) { return xml("<ErrorResponse xmlns=\"http://cloudformation.amazonaws.com/doc/2010-05-15/\"><Error><Type>Sender</Type><Code>" + code + "</Code><Message>" + esc(msg) + "</Message></Error><RequestId>twin</RequestId></ErrorResponse>", status || 400); }
  function formParams(form, prefix) {
    var out = [];
    for (var i = 1; i <= 64; i++) { var k = form.get(prefix + ".member." + i + ".ParameterKey"); if (k == null) break; out.push([k, form.get(prefix + ".member." + i + ".ParameterValue") || ""]); }
    return out;
  }
  function customerCfn(form, init, region, account) {
    var s = build(), A = form.get("Action"), acc = s.accounts[account] || { stacks: map() };
    // By name, a deleted stack is gone; by stack id it is still found (DELETE_COMPLETE), as AWS answers.
    var live = function (x) { return x.status !== "DELETE_COMPLETE"; };
    var find = function (n) { var st = n && acc.stacks[region + "/" + n]; if (st && !live(st)) st = null; if (!st && n) Object.keys(acc.stacks).forEach(function (k) { if (acc.stacks[k].stackId === n && acc.stacks[k].region === region) st = acc.stacks[k]; }); return st || null; };
    var NS = " xmlns=\"http://cloudformation.amazonaws.com/doc/2010-05-15/\"";
    if (A === "CreateStack") {
      var name = form.get("StackName") || "", params = map(), m = /^sws-vault-([0-9a-f]{12})(-access)?$/.exec(name);
      formParams(form, "Parameters").forEach(function (kv) { params[kv[0]] = kv[1]; });
      if (!m) return cfnErr("ValidationError", "The twin's customer account holds Vault stacks only: sws-vault-<12 hex digits> or sws-vault-<12 hex digits>-access.");
      // Bounds (security.aws.a, R-025 (b)): the twin's region only, and at most CUSTOMER_STACKS stacks in the account.
      if (region !== REGION) return cfnErr("ValidationError", "The twin's customer account is in " + REGION + " only.");
      if (Object.keys(acc.stacks).filter(function (k) { return live(acc.stacks[k]); }).length >= CUSTOMER_STACKS && !find(name)) return cfnErr("LimitExceededException", "The twin's customer account holds at most " + CUSTOMER_STACKS + " stacks.");
      // vault.yaml's AllowedPattern, checked before anything is made, as CloudFormation does (R-025 (c)).
      if (params.ImageUri != null && (params.ImageUri.length > 512 || !IMAGE_PATTERN.test(params.ImageUri)))
        return cfnErr("ValidationError", "Parameter 'ImageUri' must match pattern " + IMAGE_PATTERN.source);
      if (params.VaultId !== m[1]) return cfnErr("ValidationError", "Parameter 'VaultId' must be " + m[1] + " for stack " + name + ".");
      if (!form.get("TemplateURL") && !form.get("TemplateBody")) return cfnErr("ValidationError", "Either Template URL or Template Body must be specified.");
      var existing = find(name);
      if (existing && existing.status !== "DELETE_COMPLETE") return cfnErr("AlreadyExistsException", "Stack [" + name + "] already exists");
      var caps = []; for (var c = 1; c <= 8; c++) { var cv = form.get("Capabilities.member." + c); if (cv) caps.push(cv); }
      if (caps.indexOf("CAPABILITY_NAMED_IAM") < 0) return cfnErr("InsufficientCapabilitiesException", "Requires capabilities : [CAPABILITY_NAMED_IAM]");
      var kind = m[2] ? "access" : "vault", roleArn = form.get("RoleARN") || null, mode = null, collides = false;
      if (kind === "vault") {
        mode = params.DeployMode || "one-stack";
        if (mode !== "one-stack" && mode !== "access-stack") return cfnErr("ValidationError", "Parameter 'DeployMode' must be one of AllowedValues");
        var access = find(name + "-access"), want = "arn:aws:iam::" + account + ":role/" + name + "-deploy";
        // A RoleARN, in either mode, must be the completed -access stack's deploy role; access-stack mode needs one.
        if ((mode === "access-stack" || roleArn) && (!access || access.status !== "CREATE_COMPLETE" || roleArn !== want))
          return cfnErr("ValidationError", "Role " + (roleArn || "(none)") + " is invalid or cannot be assumed");
        // One-stack mode makes its own boundary; an -access stack's boundary of the same name makes the create fail.
        collides = mode === "one-stack" && !!access && access.status === "CREATE_COMPLETE";
        params.DeployMode = mode;
      }
      var ids = vaultIds(account, region, name), stackId = "arn:aws:cloudformation:" + region + ":" + account + ":stack/" + name + "/" + ids.stack;
      var plain = {}; Object.keys(params).forEach(function (k) { plain[k] = params[k]; });
      var failure = null;
      if (collides) failure = { logical: "VaultBoundary", after: 0.9,
        reason: "Resource handler returned message: \"A policy called sws-vault-" + m[1] + "-boundary already exists. Duplicate names are not allowed.\" (HandlerErrorCode: AlreadyExists)" };
      else if (kind === "vault" && taken(acc, "AWS::Logs::LogGroup", "/aws/lambda/sws-vault-" + m[1] + "-api")) failure = { logical: "VaultLogs", after: 0.8,
        // A VaultId used before: its retained log group (and bucket) are still in the account (cloudformation.aws.a). The
        // log group, the quicker resource, fails first; the page must always make a fresh id.
        reason: "Resource handler returned message: \"Resource of type 'AWS::Logs::LogGroup' with identifier '/aws/lambda/sws-vault-" + m[1] + "-api' already exists.\" (HandlerErrorCode: AlreadyExists)" };
      else if (kind === "vault" && plain.ImageUri && plain.ImageUri !== TWIN_IMAGE) failure = { logical: "VaultFunction", after: 3,
        reason: "Resource handler returned message: \"Lambda can't access the image " + plain.ImageUri + ". Check the repository's policy lists this account and the digest is in " + region + ".\" (twin's wording)" };
      var st = { name: name, kind: kind, region: region, account: account, stackId: stackId, params: plain, ids: ids, mode: mode, failure: failure };
      var t = nowIso();
      record({ t: t, actor: "user:customer-admin@" + account, op: "cloudformation.createStack", target: stackId, why: "deploy.create",
        data: { account: account, region: region, name: name, kind: kind, mode: mode, params: plain, roleArn: roleArn, stackId: stackId, ids: ids }, schedule: stackSchedule(st, t) });
      return xml("<CreateStackResponse" + NS + "><CreateStackResult><StackId>" + esc(stackId) + "</StackId></CreateStackResult></CreateStackResponse>");
    }
    if (A === "DescribeStacks") {
      var one = form.get("StackName"), list = one ? [find(one)] : Object.keys(acc.stacks).map(function (k) { return acc.stacks[k]; }).filter(function (x) { return x.region === region && live(x); });
      if (one && !list[0]) return cfnErr("ValidationError", "Stack with id " + one + " does not exist");
      return xml("<DescribeStacksResponse" + NS + "><DescribeStacksResult><Stacks>" + list.map(function (x) {
        return "<member><StackId>" + esc(x.stackId) + "</StackId><StackName>" + esc(x.name) + "</StackName><CreationTime>" + x.created + "</CreationTime><StackStatus>" + x.status + "</StackStatus>" +
          (x.roleArn ? "<RoleARN>" + esc(x.roleArn) + "</RoleARN>" : "") + "<Capabilities><member>CAPABILITY_NAMED_IAM</member></Capabilities><Parameters>" +
          Object.keys(x.params).map(function (k) { return "<member><ParameterKey>" + esc(k) + "</ParameterKey><ParameterValue>" + esc(x.params[k]) + "</ParameterValue></member>"; }).join("") +
          "</Parameters><Outputs>" + x.outputs.map(function (o) { return "<member><OutputKey>" + esc(o.OutputKey) + "</OutputKey><OutputValue>" + esc(o.OutputValue) + "</OutputValue></member>"; }).join("") +
          "</Outputs><Tags><member><Key>sws-vault</Key><Value>" + esc(x.params.VaultId) + "</Value></member></Tags></member>";
      }).join("") + "</Stacks></DescribeStacksResult></DescribeStacksResponse>");
    }
    if (A === "DescribeStackEvents") {
      var st2 = find(form.get("StackName"));
      if (!st2) return cfnErr("ValidationError", "Stack [" + (form.get("StackName") || "") + "] does not exist");
      return xml("<DescribeStackEventsResponse" + NS + "><DescribeStackEventsResult><StackEvents>" + st2.events.map(function (ev) {
        return "<member><StackId>" + esc(st2.stackId) + "</StackId><EventId>" + esc(ev.id) + "</EventId><StackName>" + esc(st2.name) + "</StackName><LogicalResourceId>" + esc(ev.logical) +
          "</LogicalResourceId><PhysicalResourceId>" + esc(ev.physical) + "</PhysicalResourceId><ResourceType>" + ev.type + "</ResourceType><Timestamp>" + ev.t +
          "</Timestamp><ResourceStatus>" + ev.status + "</ResourceStatus>" + (ev.reason ? "<ResourceStatusReason>" + esc(ev.reason) + "</ResourceStatusReason>" : "") + "</member>";
      }).join("") + "</StackEvents></DescribeStackEventsResult></DescribeStackEventsResponse>");
    }
    if (A === "DeleteStack") {
      // Teardown (cloudformation.aws.a's stack notes): resources in reverse creation order, so the DNS records go before
      // the distribution and nothing goes while something that refers to it remains; Retain and RetainExceptOnCreate
      // resources are DELETE_SKIPPED (the bucket, its policy, the log group stay with the customer); then
      // DELETE_COMPLETE. AWS answers a DeleteStack for a missing, already-deleting or deleted stack with success, and so does the
      // twin. The twin's own choice: a stack still being created or rolled back refuses the delete until it settles.
      var sd = find(form.get("StackName"));
      var ok = xml("<DeleteStackResponse" + NS + "><ResponseMetadata><RequestId>twin</RequestId></ResponseMetadata></DeleteStackResponse>");
      // A stack already deleted (found by its id) deletes quietly too, and stays DELETE_COMPLETE (security.aws.a, 5dc4519).
      if (!sd || sd.status === "DELETE_IN_PROGRESS" || sd.status === "DELETE_COMPLETE") return ok;
      if (/_IN_PROGRESS$/.test(sd.status)) return cfnErr("ValidationError", "Stack [" + sd.name + "] is in " + sd.status + " state and can not be deleted until it settles (the twin's rule).");
      var t0 = nowIso(), at = Date.parse(t0) + 1000, sched = [], base = { account: account, region: region, name: sd.name };
      var ev = function (ms, logical, type, status, extra) { sched.push({ at: new Date(ms).toISOString(), op: "cloudformation.stackEvent", target: sd.stackId,
        data: Object.assign({ logical: logical, type: type, status: status }, base, extra || {}), actor: "aws:cloudformation", why: "clock.settle" }); };
      var roleGone = sd.kind === "vault" && sd.mode === "access-stack" && (!find(sd.name + "-access") || find(sd.name + "-access").status !== "CREATE_COMPLETE");
      if (roleGone) {
        ev(at, sd.name, "AWS::CloudFormation::Stack", "DELETE_FAILED", { physical: sd.stackId, reason: "Role " + sd.roleArn + " is invalid or cannot be assumed" });
      } else {
        var made = sd.events.slice().reverse().map(function (x) { return x.logical; })
          .filter(function (l, i, a) { return l !== sd.name && a.indexOf(l) === i && sd.resources[l] && sd.resources[l].status === "CREATE_COMPLETE"; });
        var took = { "AWS::CloudFront::Distribution": 300, "AWS::Route53::RecordSet": 35, "AWS::IAM::Role": 5 };
        made.reverse().forEach(function (l) {
          var rs = sd.resources[l], keep = /^Retain/.test(DELETION[l] || "");
          ev(at, l, rs.type, "DELETE_IN_PROGRESS", { physical: rs.physical });
          at += keep ? 300 : (took[rs.type] || 2) * 1000;
          ev(at, l, rs.type, keep ? "DELETE_SKIPPED" : "DELETE_COMPLETE", { physical: rs.physical });
          at += 300;
        });
        ev(at + 500, sd.name, "AWS::CloudFormation::Stack", "DELETE_COMPLETE", { physical: sd.stackId });
      }
      record({ t: t0, actor: "user:customer-admin@" + account, op: "cloudformation.deleteStack", target: sd.stackId, why: "deploy.delete",
        data: { account: account, region: region, name: sd.name }, schedule: sched });
      return ok;
    }
    if (A === "ListStacks") {
      // Every stack in the region, newest first, filtered by StackStatusFilter.member.N if given (as AWS does).
      var want = []; for (var f = 1; f <= 32; f++) { var fv = form.get("StackStatusFilter.member." + f); if (fv) want.push(fv); }
      var rows = Object.keys(acc.stacks).map(function (k) { return acc.stacks[k]; }).filter(function (x) { return x.region === region && (!want.length || want.indexOf(x.status) >= 0); })
        .sort(function (a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : 0; });
      return xml("<ListStacksResponse" + NS + "><ListStacksResult><StackSummaries>" + rows.map(function (x) {
        return "<member><StackId>" + esc(x.stackId) + "</StackId><StackName>" + esc(x.name) + "</StackName><CreationTime>" + x.created + "</CreationTime><StackStatus>" + x.status +
          "</StackStatus><DriftInformation><StackDriftStatus>NOT_CHECKED</StackDriftStatus></DriftInformation></member>";
      }).join("") + "</StackSummaries></ListStacksResult></ListStacksResponse>");
    }
    if (A === "ListStackResources") {
      var st3 = find(form.get("StackName"));
      if (!st3) return cfnErr("ValidationError", "Stack with id " + (form.get("StackName") || "") + " does not exist");
      // In creation order (the order the clock first touched them), as the stack's template lists them.
      var order = st3.events.slice().reverse().map(function (ev) { return ev.logical; }).filter(function (l, i, a) { return l !== st3.name && a.indexOf(l) === i; });
      return xml("<ListStackResourcesResponse" + NS + "><ListStackResourcesResult><StackResourceSummaries>" + order.map(function (l) {
        var rs = st3.resources[l];
        return "<member><LogicalResourceId>" + esc(l) + "</LogicalResourceId><PhysicalResourceId>" + esc(rs.physical) + "</PhysicalResourceId><ResourceType>" + rs.type +
          "</ResourceType><LastUpdatedTimestamp>" + rs.t + "</LastUpdatedTimestamp><ResourceStatus>" + rs.status + "</ResourceStatus>" +
          (rs.reason ? "<ResourceStatusReason>" + esc(rs.reason) + "</ResourceStatusReason>" : "") + "</member>";
      }).join("") + "</StackResourceSummaries></ListStackResourcesResult></ListStackResourcesResponse>");
    }
    return cfnErr("InvalidAction", "Not in the twin's customer account yet: cloudformation " + A);
  }
  function cloudformation(form, init, host) {
    if (!signed(init)) return xmlErr("MissingAuthenticationToken", "Request is missing Authentication Token", 403);
    var cust = customerOf(init);
    if (cust) return customerCfn(form, init, host.split(".")[1], cust);
    var s = build(), A = form.get("Action");
    var read = cfnRead(s, A, form, host.split(".")[1]);
    if (read) return read;
    var ready = s.template ? Promise.resolve(s.template) : fetch(new URL("cloudformation/bootstrap.yaml", document.baseURI)).then(function (r) { return r.text(); })
      .then(function (t) { record({ op: "cloudformation.loadTemplate", target: "arn:aws:cloudformation:us-east-1:" + ACCOUNT + ":stack/sws-aws-platform", data: { body: t.replace("Description: >-\n", "Description: >-\n  (twin: an older version)\n") } }); return s.template; });
    return ready.then(function () {
      if (A === "GetTemplate") return xml("<GetTemplateResponse><GetTemplateResult><TemplateBody>" + esc(s.template) + "</TemplateBody></GetTemplateResult></GetTemplateResponse>");
      if (A === "CreateChangeSet") { record({ actor: actorOf(init), op: "cloudformation.createChangeSet", target: "arn:aws:cloudformation:us-east-1:" + ACCOUNT + ":stack/sws-aws-platform", data: { name: form.get("ChangeSetName"), body: form.get("TemplateBody") }, why: "plan.approve" }); return xml("<CreateChangeSetResponse><CreateChangeSetResult><Id>twin</Id></CreateChangeSetResult></CreateChangeSetResponse>"); }
      if (A === "DescribeChangeSet") return xml("<DescribeChangeSetResponse><DescribeChangeSetResult><Status>CREATE_COMPLETE</Status><Changes><member><ResourceChange><Action>Modify</Action><LogicalResourceId>PlatformRead</LogicalResourceId><ResourceType>AWS::IAM::Role</ResourceType><Replacement>False</Replacement></ResourceChange></member><member><ResourceChange><Action>Modify</Action><LogicalResourceId>PlatformChange</LogicalResourceId><ResourceType>AWS::IAM::Role</ResourceType><Replacement>False</Replacement></ResourceChange></member></Changes></DescribeChangeSetResult></DescribeChangeSetResponse>");
      if (A === "ExecuteChangeSet") { record({ actor: actorOf(init), op: "cloudformation.executeChangeSet", target: "arn:aws:cloudformation:us-east-1:" + ACCOUNT + ":stack/sws-aws-platform", data: { name: form.get("ChangeSetName"), t: new Date().toISOString().replace(/\.\d+Z$/, "Z") }, why: "plan.approve" }); return xml("<ExecuteChangeSetResponse/>"); }
      return xmlErr("InvalidAction", "Not in the twin yet: cloudformation " + A);
    });
  }
  // ---- CloudFront reads (architect.aws.a's design 06, section 4; boto3.aws.a's note 18 for the API's shape) ----
  // One global endpoint, REST with XML answers: ListDistributions (GET /2020-05-31/distribution), GetDistribution
  // (GET /2020-05-31/distribution/<id>) and ListFunctions (GET /2020-05-31/function), each from the caller's account's
  // world. The platform account has the demo site's distribution; a customer account has each Vault stack's, from
  // when its create settles until its delete settles, with the Function URL origin and the -health function on
  // viewer-request for /health (as vault.yaml's VaultDistribution and HealthFunction). Members given are the ones a
  // reader needs, not every required member of AWS's shapes. The twin's own choices, where AWS's documentation does
  // not say: MaxItems from 1 to 1000 (default 100), the next item's key as NextMarker, the error wording, and
  // ListFunctions without Stage listing both stages of a published function.
  var CF_NS = " xmlns=\"http://cloudfront.amazonaws.com/doc/2020-05-31/\"";
  function cfErr(code, msg, status) { return xml("<?xml version=\"1.0\"?><ErrorResponse" + CF_NS + "><Error><Type>Sender</Type><Code>" + code + "</Code><Message>" + esc(msg) + "</Message></Error><RequestId>twin</RequestId></ErrorResponse>", status || 400); }
  function cfDistributions(s, account) {
    if (account === ACCOUNT) return [{ id: "EDEMOTWIN00001", domain: "d111111abcdef8.cloudfront.net", aliases: ["www.example.com"], status: "Deployed", enabled: true,
      modified: "2026-11-18T14:20:30.000Z", comment: "demo-site", priceClass: "PriceClass_100", httpVersion: "http2", defaultRoot: "index.html",
      origins: [{ id: "demo-site", domain: B.site + ".s3." + REGION + ".amazonaws.com", s3: true }], behaviours: [] }];
    var acc = s.accounts[account], out = [];
    if (!acc) return out;
    Object.keys(acc.stacks).forEach(function (k) {
      var st = acc.stacks[k], r = st.kind === "vault" && st.resources.VaultDistribution;
      if (!r || !(r.status === "CREATE_COMPLETE" || r.status === "DELETE_IN_PROGRESS" || r.status === "DELETE_FAILED")) return;
      var done = r.status === "CREATE_COMPLETE", p = st.params;
      out.push({ id: st.ids.distribution, domain: st.ids.cfDomain, aliases: p.DomainName ? [p.DomainName] : [], status: done ? "Deployed" : "InProgress", enabled: done,
        modified: r.t, comment: "sws-vault-" + p.VaultId, priceClass: "PriceClass_100", httpVersion: "http2and3", defaultRoot: "", webAcl: p.WebAclArn || "",
        origins: [{ id: "vault-api", domain: st.ids.url + ".lambda-url." + st.region + ".on.aws", s3: false }],
        behaviours: [{ path: "/health", fn: physicalOf(st, "HealthFunction"), event: "viewer-request" }] });
    });
    return out;
  }
  function cfFunctions(s, account) {
    var acc = account !== ACCOUNT && s.accounts[account], out = [];
    if (!acc) return out;
    Object.keys(acc.stacks).forEach(function (k) {
      var st = acc.stacks[k], r = st.kind === "vault" && st.resources.HealthFunction;
      if (!r || !(r.status === "CREATE_COMPLETE" || r.status === "DELETE_IN_PROGRESS" || r.status === "DELETE_FAILED")) return;
      var d = st.resources.VaultDistribution, live = d && (d.status === "CREATE_COMPLETE" || d.status === "DELETE_IN_PROGRESS");
      ["DEVELOPMENT", "LIVE"].forEach(function (stage) {
        out.push({ name: "sws-vault-" + st.params.VaultId + "-health", arn: physicalOf(st, "HealthFunction"), stage: stage, runtime: "cloudfront-js-2.0",
          comment: "Answers /health with the Vault id and template version; never reaches the server.",
          status: stage === "LIVE" && live ? "DEPLOYED" : "UNASSOCIATED", created: r.t, modified: r.t });
      });
    });
    return out;
  }
  function cfPage(items, key, q) {
    var max = q.has("MaxItems") ? q.get("MaxItems") : "100";
    if (!/^[0-9]{1,4}$/.test(max) || +max < 1 || +max > 1000) return { err: cfErr("InvalidArgument", "MaxItems must be a whole number from 1 to 1000 (the twin's bound).") };
    var start = 0, marker = q.get("Marker");
    if (marker) { start = items.map(key).indexOf(marker); if (start < 0) return { err: cfErr("InvalidArgument", "The marker is not valid.") }; }
    var page = items.slice(start, start + +max);
    return { page: page, max: +max, marker: marker || "", next: start + +max < items.length ? key(items[start + +max]) : null };
  }
  function cfQty(name, inner, items) { return "<" + name + "><Quantity>" + items.length + "</Quantity>" + (items.length ? "<Items>" + items.map(inner).join("") + "</Items>" : "") + "</" + name + ">"; }
  function cfOrigins(d) {
    return cfQty("Origins", function (o) {
      return "<Origin><Id>" + esc(o.id) + "</Id><DomainName>" + esc(o.domain) + "</DomainName><OriginPath></OriginPath><CustomHeaders><Quantity>0</Quantity></CustomHeaders>" +
        (o.s3 ? "<S3OriginConfig><OriginAccessIdentity></OriginAccessIdentity></S3OriginConfig>"
              : "<CustomOriginConfig><HTTPPort>80</HTTPPort><HTTPSPort>443</HTTPSPort><OriginProtocolPolicy>https-only</OriginProtocolPolicy><OriginSslProtocols><Quantity>1</Quantity><Items><SslProtocol>TLSv1.2</SslProtocol></Items></OriginSslProtocols></CustomOriginConfig>") + "</Origin>";
    }, d.origins);
  }
  function cfFns(b) { return cfQty("FunctionAssociations", function (f) { return "<FunctionAssociation><FunctionARN>" + esc(f.fn) + "</FunctionARN><EventType>" + f.event + "</EventType></FunctionAssociation>"; }, b ? [b] : []); }
  function cfBehaviours(d) {
    var target = esc(d.origins[0].id);
    return "<DefaultCacheBehavior><TargetOriginId>" + target + "</TargetOriginId><ViewerProtocolPolicy>redirect-to-https</ViewerProtocolPolicy>" + cfFns(null) + "</DefaultCacheBehavior>" +
      cfQty("CacheBehaviors", function (b) { return "<CacheBehavior><PathPattern>" + esc(b.path) + "</PathPattern><TargetOriginId>" + target + "</TargetOriginId><ViewerProtocolPolicy>redirect-to-https</ViewerProtocolPolicy>" + cfFns(b) + "</CacheBehavior>"; }, d.behaviours);
  }
  function cfAliases(d) { return cfQty("Aliases", function (a) { return "<CNAME>" + esc(a) + "</CNAME>"; }, d.aliases); }
  function cfArn(account, id) { return "arn:aws:cloudfront::" + account + ":distribution/" + id; }
  function cloudfront(url, init, account) {
    var s = build(), u = new URL(url), m = /^\/2020-05-31\/(distribution|function)(?:\/([^\/]+))?$/.exec(u.pathname), q = u.searchParams;
    if (!m || (init.method || "GET").toUpperCase() !== "GET" || (m[1] === "function" && m[2] !== undefined))
      return cfErr("NotImplemented", "The twin answers three CloudFront reads only: ListDistributions, GetDistribution and ListFunctions. Twin mode never calls real AWS.", 501);
    if (m[1] === "function") {
      var stage = q.get("Stage");
      if (stage !== null && stage !== "DEVELOPMENT" && stage !== "LIVE") return cfErr("InvalidArgument", "Stage must be DEVELOPMENT or LIVE.");
      var fns = cfFunctions(s, account).filter(function (f) { return stage === null || f.stage === stage; });
      var fp = cfPage(fns, function (f) { return f.name + ":" + f.stage; }, q);
      if (fp.err) return fp.err;
      return xml("<?xml version=\"1.0\"?><FunctionList" + CF_NS + ">" + (fp.next ? "<NextMarker>" + esc(fp.next) + "</NextMarker>" : "") + "<MaxItems>" + fp.max + "</MaxItems>" +
        "<Quantity>" + fp.page.length + "</Quantity>" + (fp.page.length ? "<Items>" + fp.page.map(function (f) {
          return "<FunctionSummary><Name>" + esc(f.name) + "</Name><Status>" + f.status + "</Status><FunctionConfig><Comment>" + esc(f.comment) + "</Comment><Runtime>" + f.runtime + "</Runtime></FunctionConfig>" +
            "<FunctionMetadata><FunctionARN>" + esc(f.arn) + "</FunctionARN><Stage>" + f.stage + "</Stage><CreatedTime>" + f.created + "</CreatedTime><LastModifiedTime>" + f.modified + "</LastModifiedTime></FunctionMetadata></FunctionSummary>";
        }).join("") + "</Items>" : "") + "</FunctionList>");
    }
    var ds = cfDistributions(s, account);
    if (m[2] !== undefined) {
      var d = ds.filter(function (x) { return x.id === m[2]; })[0];
      if (!d) return cfErr("NoSuchDistribution", "The specified distribution does not exist.", 404);
      var r = xml("<?xml version=\"1.0\"?><Distribution" + CF_NS + "><Id>" + d.id + "</Id><ARN>" + cfArn(account, d.id) + "</ARN><Status>" + d.status + "</Status><LastModifiedTime>" + d.modified + "</LastModifiedTime>" +
        "<InProgressInvalidationBatches>0</InProgressInvalidationBatches><DomainName>" + d.domain + "</DomainName><DistributionConfig><CallerReference>twin-" + d.id + "</CallerReference>" + cfAliases(d) +
        "<DefaultRootObject>" + esc(d.defaultRoot) + "</DefaultRootObject>" + cfOrigins(d) + cfBehaviours(d) + "<Comment>" + esc(d.comment) + "</Comment>" +
        "<Logging><Enabled>false</Enabled><IncludeCookies>false</IncludeCookies><Bucket></Bucket><Prefix></Prefix></Logging><PriceClass>" + d.priceClass + "</PriceClass><Enabled>" + d.enabled + "</Enabled>" +
        "<WebACLId>" + esc(d.webAcl || "") + "</WebACLId><HttpVersion>" + d.httpVersion + "</HttpVersion></DistributionConfig></Distribution>");
      r.headers.set("etag", "E" + d.id.slice(1, 8) + d.modified.replace(/[^0-9]/g, "").slice(0, 6));
      return r;
    }
    var dp = cfPage(ds, function (x) { return x.id; }, q);
    if (dp.err) return dp.err;
    return xml("<?xml version=\"1.0\"?><DistributionList" + CF_NS + "><Marker>" + esc(dp.marker) + "</Marker>" + (dp.next ? "<NextMarker>" + dp.next + "</NextMarker>" : "") +
      "<MaxItems>" + dp.max + "</MaxItems><IsTruncated>" + (dp.next ? "true" : "false") + "</IsTruncated><Quantity>" + dp.page.length + "</Quantity>" + (dp.page.length ? "<Items>" + dp.page.map(function (d) {
        return "<DistributionSummary><Id>" + d.id + "</Id><ARN>" + cfArn(account, d.id) + "</ARN><Status>" + d.status + "</Status><LastModifiedTime>" + d.modified + "</LastModifiedTime><DomainName>" + d.domain + "</DomainName>" +
          cfAliases(d) + cfOrigins(d) + cfBehaviours(d) + "<Comment>" + esc(d.comment) + "</Comment><PriceClass>" + d.priceClass + "</PriceClass><Enabled>" + d.enabled + "</Enabled>" +
          "<WebACLId>" + esc(d.webAcl || "") + "</WebACLId><HttpVersion>" + d.httpVersion + "</HttpVersion><Staging>false</Staging></DistributionSummary>";
      }).join("") + "</Items>" : "") + "</DistributionList>");
  }
  function ce() { return json({ ResultsByTime: [{ Total: { UnblendedCost: { Amount: "42.17", Unit: "USD" } } }] }); }
  function cloudcontrol(target, body, init, host) {
    if (!signed(init)) return json({ __type: "AccessDeniedException", message: "Missing signature" }, 403);
    var s = build(), q = JSON.parse(body || "{}"), region = host.split(".")[1];
    if (target === "ListResources") return json({ ResourceDescriptions: Object.keys(s.objects).map(function (b) { return { Identifier: b }; }) });
    if (target === "GetResource") {
      var bucketRegion = /us-east-1/.test(q.Identifier) ? "us-east-1" : REGION;
      var props = { BucketName: q.Identifier, RegionalDomainName: q.Identifier + ".s3." + bucketRegion + ".amazonaws.com" };
      if (s.cors[q.Identifier]) props.CorsConfiguration = s.cors[q.Identifier];
      return json({ TypeName: q.TypeName, ResourceDescription: { Identifier: q.Identifier, Properties: JSON.stringify(props) } });
    }
    if (target === "UpdateResource") {
      if (region !== REGION) { record({ actor: actorOf(init), op: "cloudcontrol.requestFailed", target: "arn:aws:s3:::" + q.Identifier, data: { token: "bad", message: "The bucket you are attempting to access must be addressed using the specified endpoint." } }); return json({ ProgressEvent: { RequestToken: "bad", OperationStatus: "IN_PROGRESS" } }); }
      JSON.parse(q.PatchDocument).forEach(function (op) {
        var who = actorOf(init), target = "arn:aws:s3:::" + q.Identifier;
        if (op.path === "/CorsConfiguration") record({ actor: who, op: "s3.putBucketCors", target: target, data: { bucket: q.Identifier, cors: op.value }, why: "plan.approve" });
        else if (op.path === "/CorsConfiguration/CorsRules/-") record({ actor: who, op: "s3.addCorsRule", target: target, data: { bucket: q.Identifier, rule: op.value }, why: "plan.approve" });
      });
      return json({ ProgressEvent: { RequestToken: "ok", OperationStatus: "IN_PROGRESS" } });
    }
    if (target === "GetResourceRequestStatus") return json({ ProgressEvent: q.RequestToken === "bad" ? { OperationStatus: "FAILED", StatusMessage: s.requests.bad } : { OperationStatus: "SUCCESS" } });
    return json({ __type: "UnsupportedActionException", message: "Not in the twin yet: " + target }, 400);
  }
  function s3(url, init) {
    var s = build(), u = new URL(url), m = /^([^.]+(?:--[^.]*)?)\.s3\.([a-z0-9-]+)\.amazonaws\.com$/.exec(u.host), bucket, key;
    if (m) { bucket = m[1]; key = decodeURIComponent(u.pathname.slice(1)); }
    else { var parts = u.pathname.split("/"); bucket = decodeURIComponent(parts[1]); key = decodeURIComponent(parts.slice(2).join("/")); }
    if (!s.objects[bucket]) return xml("<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>", 404);
    if (!s.cors[bucket]) return Promise.reject(new TypeError("Failed to fetch")); // a real browser sees a CORS failure
    if (!signed(init)) return xml("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", 403);
    if (!key && u.searchParams.has("cors")) {
      // GetBucketCors: the bucket's rules as S3 returns them (Cloud Control's CorsRules, in S3's XML names).
      var tag = function (t, v) { return "<" + t + ">" + esc(String(v)) + "</" + t + ">"; }, many = function (t, a) { return (a || []).map(function (v) { return tag(t, v); }).join(""); };
      return xml("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CORSConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">" + s.cors[bucket].CorsRules.map(function (r) {
        return "<CORSRule>" + (r.Id ? tag("ID", r.Id) : "") + many("AllowedHeader", r.AllowedHeaders) + many("AllowedMethod", r.AllowedMethods) + many("AllowedOrigin", r.AllowedOrigins) +
          many("ExposeHeader", r.ExposedHeaders) + (r.MaxAge !== undefined ? tag("MaxAgeSeconds", r.MaxAge) : "") + "</CORSRule>";
      }).join("") + "</CORSConfiguration>");
    }
    if (!key) {
      // ListObjectsV2: keys and common prefixes in key order, max-keys of them (default 1000) a page.
      var q = u.searchParams, prefix = q.get("prefix") || "", delim = q.get("delimiter"), max = Math.min(+(q.get("max-keys") || 1000), 1000);
      var after = q.get("continuation-token") ? fromToken(q.get("continuation-token")) : q.get("start-after") || "";
      var all = Object.keys(s.objects[bucket]).sort().filter(function (k) { return k.indexOf(prefix) === 0; }), items = [], seen = {};
      all.forEach(function (k) {
        var rest = k.slice(prefix.length), cut = delim ? rest.indexOf(delim) : -1;
        if (cut >= 0) { var cp = prefix + rest.slice(0, cut + 1); if (!seen[cp]) { seen[cp] = 1; items.push({ prefix: cp }); } }
        else items.push({ key: k });
      });
      items = items.filter(function (it) { return (it.key || it.prefix) > after; });
      var pageItems = items.slice(0, max), more = items.length > max;
      return Promise.all(pageItems.map(function (it) { return it.key ? s.objects[bucket][it.key].body : null; })).then(function (bodies) {
        var parts = pageItems.map(function (it, i) {
          return it.prefix ? "<CommonPrefixes><Prefix>" + esc(it.prefix) + "</Prefix></CommonPrefixes>"
            : "<Contents><Key>" + esc(it.key) + "</Key><LastModified>" + s.objects[bucket][it.key].modified + "</LastModified><ETag>&quot;" + etag(bodies[i]) + "&quot;</ETag><Size>" + bodies[i].length + "</Size><StorageClass>STANDARD</StorageClass></Contents>";
        });
        var last = pageItems.length ? pageItems[pageItems.length - 1] : null;
        return xml("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Name>" + esc(bucket) + "</Name><Prefix>" + esc(prefix) + "</Prefix>" +
          (q.get("continuation-token") ? "<ContinuationToken>" + esc(q.get("continuation-token")) + "</ContinuationToken>" : "") +
          (more ? "<NextContinuationToken>" + esc(toToken(last.key || last.prefix)) + "</NextContinuationToken>" : "") +
          "<KeyCount>" + pageItems.length + "</KeyCount><MaxKeys>" + max + "</MaxKeys>" + (delim ? "<Delimiter>" + esc(delim) + "</Delimiter>" : "") +
          "<IsTruncated>" + more + "</IsTruncated>" + parts.join("") + "</ListBucketResult>");
      });
    }
    var o = s.objects[bucket][key];
    if (!o) return xml("<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>", 404);
    return o.body.then(function (b) {
      var h = { "content-type": o.type, "etag": "\"" + etag(b) + "\"", "last-modified": new Date(o.modified).toUTCString(), "accept-ranges": "bytes" };
      var range = hdr(init, "range"), r = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      if (r && (r[1] || r[2])) {
        // bytes=a-b, bytes=a- (to the end) and bytes=-n (the last n bytes), as S3 answers them.
        var from = r[1] ? +r[1] : Math.max(b.length - +r[2], 0), to = r[1] && r[2] ? Math.min(+r[2], b.length - 1) : b.length - 1;
        if (from >= b.length || (r[1] && r[2] && +r[2] < +r[1])) return xml("<Error><Code>InvalidRange</Code><Message>The requested range is not satisfiable</Message><RangeRequested>" + esc(range) + "</RangeRequested><ActualObjectSize>" + b.length + "</ActualObjectSize></Error>", 416);
        h["content-range"] = "bytes " + from + "-" + to + "/" + b.length;
        return new Response(b.slice(from, to + 1), { status: 206, headers: h });
      }
      return new Response(b, { status: 200, headers: h });
    });
  }

  // Lambda (REST JSON, API version 2015-03-31) and Firehose (JSON 1.1, Firehose_20150804): read calls only.
  // lambda.aws.a, 23 Nov 2026. Three synthetic functions; demo-handler is built from the dependency zip in the
  // deps bucket (its CodeSize and CodeSha256 are that zip's), and one Firehose stream whose S3 destination is the
  // CloudFront logs bucket, so the hourly files already in the twin are its output. Synthetic simplification:
  // the twin writes one file per hour, where Firehose would write one per buffer interval (at most 900 s).
  var ROLE = function (n) { return "arn:aws:iam::" + ACCOUNT + ":role/" + n; };
  var FN = {
    "demo-handler": { Runtime: "python3.12", Handler: "demo_handler.handler.run", Timeout: 30, MemorySize: 256, Description: "Returns the vault ids in a request (vault API)", LastModified: "2026-11-18T16:54:00.000+0000", zip: "lambdas-dependencies/demo-handler==v1.0.0.zip" },
    "demo-log-enricher": { Runtime: "python3.12", Handler: "enricher.handler", Timeout: 60, MemorySize: 128, Description: "Adds the country and the vault id to each CloudFront log line before Firehose writes it", LastModified: "2026-11-19T10:12:00.000+0000", CodeSize: 4182 },
    "demo-nightly-report": { Runtime: "python3.12", Handler: "report.handler", Timeout: 300, MemorySize: 512, Description: "Counts yesterday's requests per vault and writes a summary", LastModified: "2026-11-17T22:40:00.000+0000", CodeSize: 9031 }
  };
  function fnArn(n) { return "arn:aws:lambda:" + REGION + ":" + ACCOUNT + ":function:" + n; }
  function own(o, k) { return typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k); }
  function b64(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function fnConfig(n) {
    var f = FN[n], o = build().objects[B.deps][f.zip || ""];
    var code = o ? o.body.then(function (b) { return crypto.subtle.digest("SHA-256", b).then(function (h) { return { size: b.length, sha: b64(new Uint8Array(h)) }; }); })
      : Promise.resolve({ size: f.CodeSize, sha: b64(enc.encode(("twin-" + n + "-code-sha256-padding!").slice(0, 32))) });
    return code.then(function (c) {
      return { FunctionName: n, FunctionArn: fnArn(n), Runtime: f.Runtime, Role: ROLE(n + "-role"), Handler: f.Handler, CodeSize: c.size, Description: f.Description,
        Timeout: f.Timeout, MemorySize: f.MemorySize, LastModified: f.LastModified, CodeSha256: c.sha, Version: "$LATEST", State: "Active", LastUpdateStatus: "Successful",
        PackageType: "Zip", Architectures: ["x86_64"] };
    });
  }
  function lambdaJson(o, status, type) { var h = { "content-type": "application/json" }; if (type) h["x-amzn-errortype"] = type; return new Response(JSON.stringify(o), { status: status || 200, headers: h }); }
  function lambda(url, init) {
    if (!signed(init)) return lambdaJson({ message: "Missing Authentication Token" }, 403, "MissingAuthenticationTokenException");
    if ((init.method || "GET").toUpperCase() !== "GET") return lambdaJson({ Type: "User", Message: "Not in the twin yet: read calls only" }, 400, "InvalidRequestContentException");
    var path = new URL(url).pathname, m;
    // ListFunctions returns a subset of FunctionConfiguration: no State or LastUpdateStatus fields (AWS's
    // ListFunctions reference); NextMarker only when more functions follow, so none here (three functions, up to 50 a page).
    if (/^\/2015-03-31\/functions\/?$/.test(path)) return Promise.all(Object.keys(FN).sort().map(fnConfig)).then(function (fs) {
      return lambdaJson({ Functions: fs.map(function (c) { var o = Object.assign({}, c); delete o.State; delete o.LastUpdateStatus; return o; }) });
    });
    if ((m = /^\/2015-03-31\/functions\/([^/]+)\/configuration\/?$/.exec(path))) {
      var n = decodeURIComponent(m[1]).replace(/^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:/, "");
      if (!own(FN, n)) return lambdaJson({ Type: "User", Message: "Function not found: " + fnArn(n) }, 404, "ResourceNotFoundException");
      return fnConfig(n).then(function (c) { return lambdaJson(c); });
    }
    return lambdaJson({ Type: "User", Message: "Not in the twin yet: " + path }, 400, "InvalidRequestContentException");
  }
  var STREAMS = { "demo-cloudfront-logs": { created: 1794819600, prefix: "cloudfront/", bucket: function () { return B.logs; }, processor: "demo-log-enricher" } };
  function firehoseJson(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/x-amz-json-1.1" } }); }
  function firehose(target, body, init) {
    if (!signed(init)) return firehoseJson({ __type: "MissingAuthenticationTokenException", message: "Missing Authentication Token" }, 403);
    var q = {}; try { q = JSON.parse(body || "{}"); } catch (e) { return firehoseJson({ __type: "SerializationException", message: "Body is not JSON" }, 400); }
    if (target === "ListDeliveryStreams") return firehoseJson({ DeliveryStreamNames: Object.keys(STREAMS).sort(), HasMoreDeliveryStreams: false });
    if (target === "DescribeDeliveryStream") {
      var st = own(STREAMS, q.DeliveryStreamName) ? STREAMS[q.DeliveryStreamName] : null;
      if (!st) return firehoseJson({ __type: "ResourceNotFoundException", message: "Firehose " + q.DeliveryStreamName + " under account " + ACCOUNT + " not found." }, 400);
      return firehoseJson({ DeliveryStreamDescription: { DeliveryStreamName: q.DeliveryStreamName, DeliveryStreamARN: "arn:aws:firehose:" + REGION + ":" + ACCOUNT + ":deliverystream/" + q.DeliveryStreamName,
        DeliveryStreamStatus: "ACTIVE", DeliveryStreamType: "DirectPut", VersionId: "1", CreateTimestamp: st.created, HasMoreDestinations: false,
        Destinations: [{ DestinationId: "destinationId-000000000001", ExtendedS3DestinationDescription: { RoleARN: ROLE(q.DeliveryStreamName + "-firehose"), BucketARN: "arn:aws:s3:::" + st.bucket(),
          Prefix: st.prefix, ErrorOutputPrefix: "errors/", BufferingHints: { SizeInMBs: 5, IntervalInSeconds: 900 }, CompressionFormat: "GZIP",
          EncryptionConfiguration: { NoEncryptionConfig: "NoEncryption" }, S3BackupMode: "Disabled",
          ProcessingConfiguration: { Enabled: true, Processors: [{ Type: "Lambda", Parameters: [{ ParameterName: "LambdaArn", ParameterValue: fnArn(st.processor) + ":$LATEST" }] }] } } }] } });
    }
    return firehoseJson({ __type: "UnknownOperationException", message: "Not in the twin yet: " + target }, 400);
  }

  // CloudWatch GetMetricData (Query protocol, API version 2010-08-01), read only. lambda.aws.a, 23 Nov 2026.
  // Every value comes from the hourly log files the stream delivered, so charts and logs agree:
  // AWS/Firehose IncomingRecords and DeliveryToS3.Records = lines in that hour's file;
  // AWS/Lambda for demo-handler (the vault API) = requests to /vault/<id>/files (Errors: those answered 4xx or 5xx;
  // Duration: their mean time_taken in ms); demo-log-enricher runs once per 900 s buffer, 4 times an hour, its
  // Duration growing with the lines; demo-nightly-report runs at night, so these hours have no datapoints.
  // Synthetic, as the rest of the twin. Datapoints exist only for the hours that have log files.
  function metricSeries(ns, name, dims, stat, h) {
    var d = Object.create(null); dims.forEach(function (x) { d[x[0]] = x[1]; });
    if (dims.length !== 1) return null; // a metric is matched on its exact dimension set, as CloudWatch does
    var L = h.lines, api = L.filter(function (l) { return /^\/vault\/[^/]+\/files/.test(l.cs_uri_stem); });
    var mean = function (a) { return a.length ? a.reduce(function (s, l) { return s + l.time_taken * 1000; }, 0) / a.length : null; };
    if (ns === "AWS/Firehose" && d.DeliveryStreamName === "demo-cloudfront-logs" && (name === "IncomingRecords" || name === "DeliveryToS3.Records")) return stat === "Sum" ? L.length : null;
    if (ns !== "AWS/Lambda") return null;
    if (d.FunctionName === "demo-handler") {
      if (name === "Invocations") return stat === "Sum" ? api.length : null;
      if (name === "Errors") return stat === "Sum" ? api.filter(function (l) { return l.sc_status >= 400; }).length : null;
      if (name === "Duration") return stat === "Average" && api.length ? +mean(api).toFixed(2) : null;
    }
    if (d.FunctionName === "demo-log-enricher") {
      if (name === "Invocations") return stat === "Sum" ? 4 : null;
      if (name === "Errors") return stat === "Sum" ? 0 : null;
      if (name === "Duration") return stat === "Average" ? +(40 + L.length * 0.8 / 4).toFixed(2) : null;
    }
    return null;
  }
  function cloudwatch(form, init) {
    if (!signed(init)) return xmlErr("MissingAuthenticationToken", "Request is missing Authentication Token", 403);
    if (form.get("Action") !== "GetMetricData") return xmlErr("InvalidAction", "Not in the twin yet: cloudwatch " + form.get("Action"));
    var t0 = Date.parse(form.get("StartTime") || ""), t1 = Date.parse(form.get("EndTime") || "");
    if (isNaN(t0) || isNaN(t1) || t1 <= t0) return xmlErr("InvalidParameterValue", "The parameter StartTime must be less than the parameter EndTime.");
    var asc = form.get("ScanBy") === "TimestampAscending", s = build(), out = [];
    for (var i = 1; form.get("MetricDataQueries.member." + i + ".Id"); i++) {
      var q = "MetricDataQueries.member." + i + ".", m = q + "MetricStat.Metric.", dims = [];
      for (var j = 1; form.get(m + "Dimensions.member." + j + ".Name"); j++) dims.push([form.get(m + "Dimensions.member." + j + ".Name"), form.get(m + "Dimensions.member." + j + ".Value")]);
      var period = +form.get(q + "MetricStat.Period"), stat = form.get(q + "MetricStat.Stat"), ns = form.get(m + "Namespace"), name = form.get(m + "MetricName");
      // Period: AWS takes 1, 5, 10, 30 or any multiple of 60 seconds (boto3.aws.a, against AWS's reference). The twin
      // keeps hourly datapoints: multiples of 3600 are aggregated from them (Sum adds; Average is over all the samples,
      // each hour weighted by its sample count); shorter periods answer Complete with no datapoints and a note (TwinHourlyOnly is the twin's own code, not an AWS one).
      if (!(period > 0 && (period % 60 === 0 || [1, 5, 10, 30].indexOf(period) >= 0))) return xmlErr("InvalidParameterValue", "The parameter Period must be 1, 5, 10, 30 or a multiple of 60.");
      var note = "";
      var samples = function (h) { // samples behind an hour's Average: demo-handler's vault API requests, else the enricher's 4 runs
        if (ns === "AWS/Lambda" && dims.length === 1 && dims[0][1] === "demo-handler") return h.lines.filter(function (l) { return /^\/vault\/[^/]+\/files/.test(l.cs_uri_stem); }).length;
        return 4;
      };
      var hourly = hoursOf(s).filter(function (h) { var t = Date.parse(h.at); return t >= t0 && t < t1; })
        .map(function (h) { return [h.at, metricSeries(ns, name, dims, stat, h), samples(h)]; }).filter(function (p) { return p[1] !== null; });
      var pts = [];
      if (period % 3600 !== 0) { if (hourly.length) note = "<Messages><member><Code>TwinHourlyOnly</Code><Value>The twin keeps hourly datapoints; ask with a Period that is a multiple of 3600.</Value></member></Messages>"; }
      else {
        var buckets = {}, order = [];
        hourly.forEach(function (p) {
          var b = new Date(Math.floor(Date.parse(p[0]) / (period * 1000)) * period * 1000).toISOString().replace(".000Z", "Z");
          if (!buckets[b]) { buckets[b] = []; order.push(b); } buckets[b].push(p);
        });
        // Average over all the samples in the period (boto3.aws.a): each hour weighted by its sample count.
        pts = order.map(function (b) {
          var v = buckets[b], sum = v.reduce(function (a, p) { return a + p[1]; }, 0);
          if (stat !== "Average") return [b, sum];
          var n = v.reduce(function (a, p) { return a + p[2]; }, 0);
          return n > 0 ? [b, +(v.reduce(function (a, p) { return a + p[1] * p[2]; }, 0) / n).toFixed(2)] : null;
        }).filter(function (p) { return p !== null; });
      }
      if (!asc) pts.reverse();
      out.push("<member><Id>" + esc(form.get(q + "Id")) + "</Id><Label>" + esc(form.get(q + "Label") || name || "") + "</Label><Timestamps>" +
        pts.map(function (p) { return "<member>" + p[0] + "</member>"; }).join("") + "</Timestamps><Values>" +
        pts.map(function (p) { return "<member>" + p[1] + "</member>"; }).join("") + "</Values><StatusCode>Complete</StatusCode>" + note + "</member>");
    }
    return xml("<GetMetricDataResponse xmlns=\"http://monitoring.amazonaws.com/doc/2010-08-01/\"><GetMetricDataResult><MetricDataResults>" + out.join("") +
      "</MetricDataResults><Messages/></GetMetricDataResult><ResponseMetadata><RequestId>twin-metrics</RequestId></ResponseMetadata></GetMetricDataResponse>");
  }

  // CloudWatch Logs (JSON 1.1, target prefix Logs_20140328), read only: DescribeLogGroups and FilterLogEvents for the
  // Lambda log groups. lambda.aws.a, 23 Nov 2026. Built from the same hourly log files as the metrics above, so a
  // function's log lines, its GetMetricData numbers and the delivered CloudFront logs agree: one START, END and REPORT
  // per invocation (Duration in REPORT is the request's time_taken for demo-handler, the metric's hourly mean for
  // demo-log-enricher), an [ERROR] line for each vault request answered 4xx or 5xx (the metric's Errors), one log
  // stream per function and hour. demo-nightly-report's group exists with no events in these hours. Synthetic.
  var LOG_RETENTION = 30;
  function logGroupOf(fn) { return "/aws/lambda/" + fn; }
  function logsJson(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/x-amz-json-1.1" } }); }
  function logsErr(type, msg, status) { return logsJson({ __type: type, message: msg }, status || 400); }
  function uuidOf(s) { var h = etag(enc.encode(s)); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-8" + h.slice(17, 20) + "-" + h.slice(20, 32); }
  function lambdaLogEvents(fn) {
    var s = build(); // the cache is kept on the world, not enumerable, as hoursOf does, so a refold makes it afresh
    if (!s._lambdaLogs) Object.defineProperty(s, "_lambdaLogs", { value: Object.create(null), enumerable: false, configurable: true });
    if (s._lambdaLogs[fn]) return s._lambdaLogs[fn];
    var ev = [], mem = FN[fn].MemorySize;
    var iso = function (t) { return new Date(t).toISOString(); };
    hoursOf(s).forEach(function (h, hi) {
      var stream = h.at.slice(0, 10).replace(/-/g, "/") + "/[$LATEST]" + etag(enc.encode(fn + "@" + h.at)), runs = [];
      if (fn === "demo-handler") h.lines.forEach(function (l, li) {
        if (!/^\/vault\/[^/]+\/files/.test(l.cs_uri_stem)) return;
        runs.push({ t: Date.parse(l.timestamp), ms: l.time_taken * 1000, id: uuidOf(fn + h.at + li),
          err: l.sc_status >= 400 ? "Request refused with " + l.sc_status + ": " + l.cs_method + " " + l.cs_uri_stem : "" });
      });
      if (fn === "demo-log-enricher") for (var q = 0; q < 4; q++) {
        var at = Date.parse(h.at) + q * 900000 + 30000, n = h.lines.filter(function (l) { return Math.floor(+l.timestamp.slice(14, 16) / 15) === q; }).length;
        runs.push({ t: at, ms: 40 + h.lines.length * 0.8 / 4, id: uuidOf(fn + h.at + q), info: "Enriched " + n + " records" });
      }
      runs.sort(function (a, b) { return a.t - b.t; }).forEach(function (r, k) {
        var end = r.t + Math.max(1, Math.round(r.ms)), used = Math.min(mem, 48 + ((hi * 7 + k * 3) % 23));
        var add = function (t, m) { ev.push({ logStreamName: stream, timestamp: t, message: m, ingestionTime: t + 1800 + ((k * 37) % 900) }); };
        add(r.t, "START RequestId: " + r.id + " Version: $LATEST\n");
        if (r.info) add(r.t + 1, "[INFO]\t" + iso(r.t + 1) + "\t" + r.id + "\t" + r.info + "\n");
        if (r.err) add(r.t + 1, "[ERROR]\t" + iso(r.t + 1) + "\t" + r.id + "\t" + r.err + "\n");
        add(end, "END RequestId: " + r.id + "\n");
        add(end, "REPORT RequestId: " + r.id + "\tDuration: " + r.ms.toFixed(2) + " ms\tBilled Duration: " + Math.ceil(r.ms) + " ms\tMemory Size: " + mem + " MB\tMax Memory Used: " + used + " MB\t\n");
      });
    });
    ev.sort(function (a, b) { return a.timestamp - b.timestamp; });
    ev.forEach(function (e, i) { e.eventId = String(e.timestamp) + pad(i, 43); }); // 56 digits like AWS's sample; unique and ordered here, opaque in AWS
    return (s._lambdaLogs[fn] = ev);
  }
  // A filter pattern for unstructured events, as CloudWatch Logs reads one: every plain term must appear, no -term may;
  // ?terms alone mean at least one must, but combined with other terms they are ignored (AWS's filter pattern page, via
  // boto3.aws.a's note 11); "quoted phrases" match whole; matching is case-sensitive. Terms match as substrings here:
  // whether AWS matches whole words is not documented (note 11, to confirm). JSON ({...}),
  // space-delimited ([...]) and regex (%...%) patterns are not in the twin yet.
  function logFilter(p) {
    p = String(p || "").trim();
    if (!p) return function () { return true; };
    if (/^[{[%]/.test(p)) return null;
    var all = [], none = [], any = [];
    (p.match(/[?-]?"[^"]*"|\S+/g) || []).forEach(function (t) {
      var list = t[0] === "?" ? any : t[0] === "-" ? none : all, w = list === all ? t : t.slice(1);
      list.push(w.replace(/^"([^"]*)"$/, "$1"));
    });
    return function (m) {
      return all.every(function (w) { return m.indexOf(w) >= 0; }) && !none.some(function (w) { return m.indexOf(w) >= 0; }) &&
        (!any.length || all.length || none.length || any.some(function (w) { return m.indexOf(w) >= 0; }));
    };
  }
  function logs(target, body, init) {
    if (!signed(init)) return logsErr("MissingAuthenticationTokenException", "Missing Authentication Token", 403);
    var q; try { q = JSON.parse(body || "{}"); } catch (e) { return logsErr("SerializationException", "Body is not JSON"); }
    if (!q || typeof q !== "object") return logsErr("SerializationException", "Body is not a JSON object");
    var groups = Object.keys(FN).sort().map(logGroupOf), arnOf = function (g) { return "arn:aws:logs:" + REGION + ":" + ACCOUNT + ":log-group:" + g; };
    if (target === "DescribeLogGroups") {
      // logGroupNamePrefix (at least 1 character) or logGroupNamePattern (a case-sensitive substring), not both; with a
      // pattern AWS returns only arn, creationTime and logGroupName (note 11). limit 1 to 50, then nextToken.
      if (q.logGroupNamePrefix !== undefined && q.logGroupNamePattern !== undefined) return logsErr("InvalidParameterException", "LogGroup name prefix and LogGroup name pattern are mutually exclusive parameters.");
      if (q.logGroupNamePrefix !== undefined && !(typeof q.logGroupNamePrefix === "string" && q.logGroupNamePrefix.length >= 1)) return logsErr("InvalidParameterException", "1 validation error detected: Value at 'logGroupNamePrefix' failed to satisfy constraint: Member must have length greater than or equal to 1");
      var dl = q.limit === undefined ? 50 : q.limit;
      if (!(dl >= 1 && dl <= 50 && dl === Math.floor(dl))) return logsErr("InvalidParameterException", "1 validation error detected: Value at 'limit' failed to satisfy constraint: Member must have value between 1 and 50");
      var dfrom = 0;
      if (q.nextToken !== undefined) { var dt = /^twin-(\d+)$/.exec(String(q.nextToken)); if (!dt) return logsErr("InvalidParameterException", "The specified nextToken is invalid."); dfrom = +dt[1]; }
      var pre = typeof q.logGroupNamePrefix === "string" ? q.logGroupNamePrefix : "", pat = typeof q.logGroupNamePattern === "string" ? q.logGroupNamePattern : null;
      var sel = groups.filter(function (g) { return pat !== null ? g.indexOf(pat) >= 0 : g.indexOf(pre) === 0; });
      var dout = { logGroups: sel.slice(dfrom, dfrom + dl).map(function (g) {
        var fn = g.slice(12), created = Date.parse(FN[fn].LastModified.replace("+0000", "Z"));
        if (pat !== null) return { logGroupName: g, creationTime: created, arn: arnOf(g) + ":*" };
        var bytes = lambdaLogEvents(fn).reduce(function (a, e) { return a + e.message.length; }, 0);
        return { logGroupName: g, creationTime: created, retentionInDays: LOG_RETENTION, metricFilterCount: 0,
          arn: arnOf(g) + ":*", storedBytes: bytes, logGroupClass: "STANDARD", logGroupArn: arnOf(g) };
      }) };
      if (dfrom + dl < sel.length) dout.nextToken = "twin-" + (dfrom + dl);
      return logsJson(dout);
    }
    if (target !== "FilterLogEvents") return logsErr("UnknownOperationException", "Not in the twin yet: logs " + target, 404); // 404 per the Logs CommonErrors page (note 11)
    if (!q.logGroupName && !q.logGroupIdentifier) return logsErr("InvalidParameterException", "Should provide either logGroupName or logGroupIdentifier."); // message not documented
    if (q.logGroupName && q.logGroupIdentifier) return logsErr("InvalidParameterException", "LogGroup name and LogGroup ARN are mutually exclusive parameters.");
    var raw = String(q.logGroupIdentifier || q.logGroupName || ""), arnm = /^arn:aws:logs:([a-z0-9-]+):(\d{12}):log-group:/.exec(raw);
    if (arnm && (arnm[1] !== REGION || arnm[2] !== ACCOUNT)) return logsErr("ResourceNotFoundException", "The specified log group does not exist.");
    var g = raw.replace(/^arn:aws:logs:[a-z0-9-]+:\d{12}:log-group:/, "").replace(/:\*$/, "");
    if (groups.indexOf(g) < 0) return logsErr("ResourceNotFoundException", "The specified log group does not exist.");
    if (q.logStreamNames && q.logStreamNamePrefix) return logsErr("InvalidParameterException", "logStreamNames and logStreamNamePrefix are mutually exclusive parameters.");
    var limit = q.limit === undefined ? 10000 : q.limit;
    if (!(limit >= 1 && limit <= 10000 && limit === Math.floor(limit))) return logsErr("InvalidParameterException", "1 validation error detected: Value at 'limit' failed to satisfy constraint: Member must have value between 1 and 10000");
    var match = logFilter(q.filterPattern);
    if (!match) return logsErr("InvalidParameterException", "Not in the twin yet: JSON, space-delimited and regex filter patterns");
    // startFromHead (botocore logs 2014-03-28, FilterLogEventsRequest): default true; false gives the latest events first
    // and is refused when startTime is before 1 Jan 2024; on later pages the direction in nextToken wins over it.
    var from = 0, head = q.startFromHead !== false;
    if (q.nextToken !== undefined) { var tk = /^twin-(head|tail)-(\d+)$/.exec(String(q.nextToken)); if (!tk) return logsErr("InvalidParameterException", "The specified nextToken is invalid."); head = tk[1] === "head"; from = +tk[2]; }
    else if (!head && !(q.startTime >= Date.UTC(2024, 0, 1))) return logsErr("InvalidParameterException", "startFromHead false is supported only when startTime is on or after Jan 1, 2024 00:00:00 UTC."); // message not documented
    if (Array.isArray(q.logStreamNames) && (q.logStreamNames.length < 1 || q.logStreamNames.length > 100))
      return logsErr("InvalidParameterException", "1 validation error detected: Value at 'logStreamNames' failed to satisfy constraint: Member must have length between 1 and 100");
    var names = Array.isArray(q.logStreamNames) ? q.logStreamNames : null, prefix = typeof q.logStreamNamePrefix === "string" ? q.logStreamNamePrefix : null;
    var hit = lambdaLogEvents(g.slice(12)).filter(function (e) {
      return (q.startTime === undefined || e.timestamp >= q.startTime) && (q.endTime === undefined || e.timestamp <= q.endTime) &&
        (!names || names.indexOf(e.logStreamName) >= 0) && (prefix === null || e.logStreamName.indexOf(prefix) === 0) && match(e.message);
    });
    if (!head) hit.reverse();
    var page = hit.slice(from, from + limit), out = { events: page.map(function (e) { return Object.assign({}, e); }), searchedLogStreams: [] };
    if (from + limit < hit.length) out.nextToken = "twin-" + (head ? "head" : "tail") + "-" + (from + limit);
    return logsJson(out);
  }

  // Answer a request as AWS would. Returns a Promise of a Response, or null if the host is not AWS.
  var AWS_HOST = /(^|\.)amazonaws\.com$/;
  function handle(url, init) {
    init = init || {};
    var host = new URL(url).host;
    if (!AWS_HOST.test(host)) return null;
    // Wait for the pack; if it did not load, an AWS-shaped 503 (fail closed: nothing reaches the network).
    return ready.then(function () {
      if (loaded && clock.frozen == null) { build(); settle(); }
      if (!loaded) return xmlErr("ServiceUnavailable", "The twin's demo pack did not load (" + ((loadError && loadError.message) || "unknown") + "). Twin mode never calls real AWS.", 503);
      return answer(url, init, host);
    });
  }
  function answer(url, init, host) {
    var body = typeof init.body === "string" ? init.body : "";
    // The customer's account has only its CloudFormation stacks and, from them, its CloudFront distributions and functions
    // (design 06) in the twin so far: every other service refuses the customer credential rather than answer with the
    // platform account's resources (security.aws.a, R-025 (a)).
    if (customerOf(init) && !/^cloudformation\.[a-z0-9-]+\.amazonaws\.com$/.test(host) && host !== "cloudfront.amazonaws.com")
      return Promise.resolve(xmlErr("AccessDenied", "Not in the twin's customer account yet: only CloudFormation and CloudFront answer it. Twin mode never calls real AWS.", 403));
    var p;
    try {
      if (host === "sts.amazonaws.com" || /^sts\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = sts(new URLSearchParams(body), init);
      else if (host === "iam.amazonaws.com") p = iam(new URLSearchParams(body), init);
      else if (/^cloudformation\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = cloudformation(new URLSearchParams(body), init, host);
      else if (/^ce\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = ce();
      else if (/^cloudcontrolapi\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = cloudcontrol((hdr(init, "x-amz-target") || "").split(".")[1], body, init, host);
      else if (/^lambda\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = lambda(url, init);
      else if (/^monitoring\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = cloudwatch(new URLSearchParams(body), init);
      else if (/^logs\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = logs((hdr(init, "x-amz-target") || "").split(".")[1], body, init);
      else if (/^firehose\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = firehose((hdr(init, "x-amz-target") || "").split(".")[1], body, init);
      else if (/\.?s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = s3(url, init);
      else if (host === "cloudfront.amazonaws.com") p = cloudfront(url, init, customerOf(init) || ACCOUNT);
      else p = xmlErr("NotImplemented", "The twin does not answer " + host + " yet. Twin mode never calls real AWS.", 501);
    } catch (e) { p = xmlErr("InternalFailure", e.message, 500); }
    return Promise.resolve(p).then(function (r) { return new Promise(function (res) { setTimeout(function () { res(r); }, 60 + lag() * 120); }); });
  }

  root.AwsTwin = { handle: handle, account: ACCOUNT, buckets: B, reset: function () { state = null; journal = []; streams = {}; clock.offset = 0; clock.frozen = null; },
    // The journal (design 02): a copy of every entry so far, and a fold of any list of entries into a world.
    journal: function () { build(); return JSON.parse(JSON.stringify(journal)); },
    // The twin's clock: now() (ISO), tick(ms) moves it on and emits what is due, pause() freezes it, resume() runs it
    // on from the frozen time; schedule(at, entry) records a clock.mark entry that schedules entry at that time.
    clock: {
      now: function () { return nowIso(); },
      paused: function () { return clock.frozen != null; },
      // Set the twin's time while paused (a scenario's or pack's start); time never moves back past an entry.
      at: function (iso) { var t = Date.parse(iso); if (clock.frozen == null || !isFinite(t)) throw new Error("twin: clock.at needs a paused clock and a time");
        if (journal.length && t < Date.parse(journal[journal.length - 1].t)) throw new Error("twin: clock.at would move time back past the journal"); clock.frozen = t; return nowIso(); },
      pause: function () { if (clock.frozen == null) clock.frozen = Date.now() + clock.offset; },
      resume: function () { if (clock.frozen != null) { clock.offset = clock.frozen - Date.now(); clock.frozen = null; } },
      tick: function (ms) { if (typeof ms !== "number" || !(ms >= 0)) throw new Error("twin: tick needs a number of ms");
        if (clock.frozen != null) clock.frozen += ms; else clock.offset += ms; build(); settle(); return nowIso(); },
      schedule: function (label, entries) { build(); return append({ op: "clock.mark", data: { label: String(label) }, why: "clock.schedule", schedule: entries }).seq; }
    },
    // Resolves once the pack has loaded (or failed to: then every AWS request is a 503); loadError says why.
    ready: function () { return ready; }, loadError: function () { return loadError ? loadError.message : null; },
    fold: function (entries) { return fold(entries); },
    packs: PACKS, pack: function () { return pack; },
    networks: { visitors: ["198.51.100.0/24"], attacker: "203.0.113.0/24", operator: OPERATOR_IP, operatorNet: "192.0.2.0/24", reserved: [EC2_PUBLIC] },
    usePack: function (name) { if (!own(PACKS, name)) return; try { localStorage.setItem("sws-aws-twin-pack", name); } catch (e) { /* none */ } } };
})(window);
