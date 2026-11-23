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
  var PACKS = {
    baseline: { title: "Normal day", about: "A small site behind CloudFront, its logs written by Firehose, two vaults in use.", perHour: 25, attack: false },
    attack: { title: "Attack in progress", about: "One address scanning for secrets and admin pages, then trying path traversal on the vault API, among normal visitors.", perHour: 25, attack: true, see: { label: "the CloudFront logs of 22 Nov, 11:00", bucket: "logs", prefix: "cloudfront/2026/11/22/11/" } },
    surge: { title: "Traffic surge", about: "Ten times the usual visitors, most of them on one vault's files.", perHour: 250, attack: false, hot: "/vault/vault-demo-001/files", see: { label: "the CloudFront logs of 22 Nov, 11:00", bucket: "logs", prefix: "cloudfront/2026/11/22/11/" } }
  };
  var pack = "baseline";
  try { var qp = new URLSearchParams(root.location.search).get("pack"); if (qp && PACKS[qp]) pack = qp; else { var sp = localStorage.getItem("sws-aws-twin-pack"); if (sp && PACKS[sp]) pack = sp; } } catch (e) { /* none */ }
  var enc = new TextEncoder();

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
  function rnd() { return rng("v0", 20261123)(); }
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
  function emptyWorld() { return { objects: map(), cors: map(), roles: map(), iam: map(), template: null, stackStatus: "CREATE_COMPLETE", changeSets: map(), requests: map() }; }
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
    "s3.putObject": function (w, e) { var d = e.data; (w.objects[d.bucket] = w.objects[d.bucket] || map())[d.key] = lazyObject(d); if (d.bucket === B.logs) delete w._hours; },
    "s3.putBucketCors": function (w, e) { w.cors[e.data.bucket] = JSON.parse(JSON.stringify(e.data.cors)); },
    "s3.addCorsRule": function (w, e) { w.cors[e.data.bucket].CorsRules.push(JSON.parse(JSON.stringify(e.data.rule))); },
    "iam.createRole": function (w, e) { w.roles[e.data.name] = JSON.parse(JSON.stringify(e.data.trust)); if (e.data.details) w.iam[e.data.name] = JSON.parse(JSON.stringify(e.data.details)); },
    "iam.updateAssumeRolePolicy": function (w, e) { w.roles[e.data.name] = JSON.parse(JSON.stringify(e.data.trust)); },
    "cloudformation.loadTemplate": function (w, e) { w.template = e.data.body; },
    "cloudformation.createChangeSet": function (w, e) { w.changeSets[e.data.name] = e.data.body; },
    "cloudformation.executeChangeSet": function (w, e) { w.template = w.changeSets[e.data.name]; w.stackStatus = "UPDATE_COMPLETE"; },
    "cloudcontrol.requestFailed": function (w, e) { w.requests[e.data.token] = e.data.message; }
  };
  function apply(w, e) { var f = OPS[e.op]; if (!f) throw new Error("twin: no operation " + e.op); f(w, e); return w; }
  function fold(entries) { return entries.reduce(apply, emptyWorld()); }
  // Append an entry to the journal and apply it to the live world.
  function record(e) {
    var full = { seq: journal.length + 1, t: e.t || new Date().toISOString(), actor: e.actor || "twin", op: e.op, target: e.target || null,
      data: e.data, why: e.why || null, source: e.source || "twin" };
    journal.push(full);
    if (state) apply(state, full);
    return full;
  }
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
    var origin = root.location ? root.location.origin : "http://localhost";
    [B.logs, B.deps, B.trail, B.dotted].forEach(function (b) {
      record({ t: "2026-11-18T09:00:00.000Z", actor: source, source: source, why: "pack.seed", op: "s3.putBucketCors", target: "arn:aws:s3:::" + b,
        data: { bucket: b, cors: { CorsRules: [{ Id: "sws-aws-platform", AllowedOrigins: [origin], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], ExposedHeaders: ["ETag", "Content-Type", "Content-Length", "Last-Modified"], MaxAge: 3000 }] } } });
    });
    // a small static site
    put(B.site, "index.html", "text/html", "<!doctype html>\n<html lang=\"en-GB\">\n<head><title>Demo site</title></head>\n<body><h1>Demo site</h1><p>Served from S3 through CloudFront.</p></body>\n</html>\n");
    put(B.site, "assets/site.css", "text/css", "body { font: 16px/1.5 system-ui; }\nh1 { color: #2456c7; }\n");
    put(B.site, "data/vaults.json", "application/json", JSON.stringify({ vaults: [{ id: "vault-demo-001", files: 42, region: REGION }, { id: "vault-demo-002", files: 7, region: "eu-west-1" }] }));
    put(B.site, "config/site.yaml", "application/x-yaml", "site: demo\nregion: eu-west-2\ncache:\n  ttl: 3600   # seconds\n  enabled: true\nlogs: s3://" + B.logs + "/\n");
    // CloudFront logs delivered by Firehose: one gzip of JSON lines per hour
    var paths = ["/", "/index.html", "/assets/site.css", "/data/vaults.json", "/vault/vault-demo-001/files", "/vault/vault-demo-002/files", "/favicon.ico"];
    for (var day = 20; day <= 22; day++) for (var hour = 9; hour <= 11; hour++) {
      var lines = [], P = PACKS[pack];
      for (var i = 0; i < P.perHour; i++) {
        var p = P.hot && rnd() < 0.7 ? P.hot : pick(paths);
        lines.push(JSON.stringify(enrich({ timestamp: "2026-11-" + day + "T" + pad(hour) + ":" + pad(Math.floor(rnd() * 60)) + ":" + pad(Math.floor(rnd() * 60)) + "Z",
          c_ip: "203.0.113." + Math.floor(rnd() * 250 + 1), cs_method: "GET", cs_uri_stem: p, sc_status: p === "/favicon.ico" ? 404 : 200,
          sc_bytes: Math.floor(rnd() * 9000 + 300), time_taken: +(rnd() * 0.2).toFixed(3), x_edge_location: pick(["LHR50-C1", "DUB2-C1", "AMS1-C1"]), cs_user_agent: pick(["Mozilla/5.0", "curl/8.5", "python-requests/2.32"]) })));
      }
      if (P.attack && day === 22) {
        // One address (TEST-NET-3, documentation range) probing, getting louder each hour.
        var probes = ["/.env", "/.git/config", "/wp-admin/", "/admin", "/config.json", "/backup.zip", "/vault/../../etc/passwd", "/vault/vault-demo-001/files?key=../../secrets", "/api/vaults?id=1%27%20OR%20%271%27=%271"];
        for (var a = 0; a < (hour - 8) * 15; a++) {
          var pr = pick(probes);
          lines.push(JSON.stringify(enrich({ timestamp: "2026-11-22T" + pad(hour) + ":" + pad(Math.floor(rnd() * 60)) + ":" + pad(Math.floor(rnd() * 60)) + "Z",
            c_ip: "203.0.113.66", cs_method: pick(["GET", "GET", "POST"]), cs_uri_stem: pr, sc_status: pick([403, 404, 404, 400]), sc_bytes: Math.floor(rnd() * 400 + 100),
            time_taken: +(rnd() * 0.05).toFixed(3), x_edge_location: "AMS1-C1", cs_user_agent: pick(["sqlmap/1.8", "Nuclei - Open-source project", "curl/8.5"]) })));
        }
        lines.sort();
      }
      put(B.logs, "cloudfront/2026/11/" + day + "/" + pad(hour) + "/demo-distribution-1-2026-11-" + day + "-" + pad(hour) + "-00-00.gz", "application/x-gzip", { gzipText: lines.join("\n") + "\n" }, "2026-11-" + day + "T" + pad(hour) + ":59:00.000Z", "cloudfront.traffic");
    }
    // Lambda dependencies as zips
    put(B.deps, "lambdas-dependencies/demo-handler==v1.0.0.zip", "application/zip", { zip: [
      ["demo_handler/__init__.py", "from .handler import run\n"],
      ["demo_handler/handler.py", "import json\n\n\ndef run(event, context):\n    # Return the vault ids in the request\n    body = json.loads(event.get('body') or '{}')\n    return {'statusCode': 200, 'body': json.dumps({'vaults': body.get('vaults', [])})}\n"],
      ["demo_handler-1.0.0.dist-info/METADATA", "Metadata-Version: 2.1\nName: demo-handler\nVersion: 1.0.0\n"],
      ["config.json", JSON.stringify({ timeout: 30, memory: 256, region: REGION })]
    ] }, "2026-11-18T16:54:00.000Z", "lambda.dependencies");
    // CloudTrail log files: one per region and five minutes. IAM is global, so its events are written under us-east-1.
    function trailEvent(n, e) {
      var role = e.write ? "sws-aws-platform-change" : "sws-aws-platform-read";
      return { eventVersion: "1.09", userIdentity: { type: "AssumedRole", principalId: "AROATWIN" + (e.write ? "CHANGE" : "READ") + ":sws-aws-platform",
          arn: "arn:aws:sts::" + ACCOUNT + ":assumed-role/" + role + "/sws-aws-platform", accountId: ACCOUNT, accessKeyId: "ASIATWIN" + (e.write ? "CHANGE" : "READ"),
          sessionContext: { sessionIssuer: { type: "Role", principalId: "AROATWIN" + (e.write ? "CHANGE" : "READ"), arn: "arn:aws:iam::" + ACCOUNT + ":role/" + role, accountId: ACCOUNT, userName: role },
            webIdFederationData: { federatedProvider: "accounts.google.com" }, attributes: { creationDate: "2026-11-22T10:00:00Z", mfaAuthenticated: "false" } } },
        eventTime: e.time, eventSource: e.source, eventName: e.name, awsRegion: e.region, sourceIPAddress: "203.0.113.7", userAgent: "Mozilla/5.0",
        requestParameters: e.params, responseElements: null, requestID: "TWIN-REQ-" + pad(n, 4), eventID: "00000000-0000-4000-8000-" + pad(n, 12),
        readOnly: !e.write, eventType: "AwsApiCall", managementEvent: !e.data, recipientAccountId: ACCOUNT, eventCategory: e.data ? "Data" : "Management" };
    }
    function trailFile(region, stamp, events, modified) {
      put(B.trail, "AWSLogs/" + ACCOUNT + "/CloudTrail/" + region + "/2026/11/22/" + ACCOUNT + "_CloudTrail_" + region + "_" + stamp + "_demo.json.gz", "application/x-gzip",
        { gzipText: JSON.stringify({ Records: events }) }, modified, "cloudtrail.delivery");
    }
    trailFile(REGION, "20261122T1005Z", [trailEvent(1, { time: "2026-11-22T10:01:02Z", source: "s3.amazonaws.com", name: "GetObject", region: REGION, data: true, params: { bucketName: B.site, key: "data/vaults.json" } })], "2026-11-22T10:05:00.000Z");
    trailFile("us-east-1", "20261122T1005Z", [trailEvent(2, { time: "2026-11-22T10:04:40Z", source: "iam.amazonaws.com", name: "UpdateAssumeRolePolicy", region: "us-east-1", write: true, params: { roleName: "sovereignwebsite-factory-dns", policyDocument: "(the new trust policy)" } })], "2026-11-22T10:05:00.000Z");
    // A folder of more than 1000 keys, so listing pages (max-keys, continuation token) as S3 does.
    for (var a = 1; a <= 1203; a++) put(B.site, "archive/2026/page-" + pad(a, 4) + ".json", "application/json", "{\"page\":" + a + "}");
    // A bucket with dots in its name: S3 is reached by the path form for these.
    put(B.dotted, "index.html", "text/html", "<!doctype html>\n<html lang=\"en-GB\"><head><title>Dotted bucket</title></head><body><p>A bucket whose name has dots.</p></body></html>\n");

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
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
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
  function cloudformation(form, init) {
    if (!signed(init)) return xmlErr("MissingAuthenticationToken", "Request is missing Authentication Token", 403);
    var s = build(), A = form.get("Action");
    var ready = s.template ? Promise.resolve(s.template) : fetch(new URL("cloudformation/bootstrap.yaml", document.baseURI)).then(function (r) { return r.text(); })
      .then(function (t) { record({ op: "cloudformation.loadTemplate", target: "arn:aws:cloudformation:" + REGION + ":" + ACCOUNT + ":stack/sws-aws-platform", data: { body: t.replace("Description: >-\n", "Description: >-\n  (twin: an older version)\n") } }); return s.template; });
    return ready.then(function () {
      if (A === "GetTemplate") return xml("<GetTemplateResponse><GetTemplateResult><TemplateBody>" + esc(s.template) + "</TemplateBody></GetTemplateResult></GetTemplateResponse>");
      if (A === "CreateChangeSet") { record({ actor: actorOf(init), op: "cloudformation.createChangeSet", target: "arn:aws:cloudformation:" + REGION + ":" + ACCOUNT + ":stack/sws-aws-platform", data: { name: form.get("ChangeSetName"), body: form.get("TemplateBody") }, why: "plan.approve" }); return xml("<CreateChangeSetResponse><CreateChangeSetResult><Id>twin</Id></CreateChangeSetResult></CreateChangeSetResponse>"); }
      if (A === "DescribeChangeSet") return xml("<DescribeChangeSetResponse><DescribeChangeSetResult><Status>CREATE_COMPLETE</Status><Changes><member><ResourceChange><Action>Modify</Action><LogicalResourceId>PlatformRead</LogicalResourceId><ResourceType>AWS::IAM::Role</ResourceType><Replacement>False</Replacement></ResourceChange></member><member><ResourceChange><Action>Modify</Action><LogicalResourceId>PlatformChange</LogicalResourceId><ResourceType>AWS::IAM::Role</ResourceType><Replacement>False</Replacement></ResourceChange></member></Changes></DescribeChangeSetResult></DescribeChangeSetResponse>");
      if (A === "ExecuteChangeSet") { record({ actor: actorOf(init), op: "cloudformation.executeChangeSet", target: "arn:aws:cloudformation:" + REGION + ":" + ACCOUNT + ":stack/sws-aws-platform", data: { name: form.get("ChangeSetName") }, why: "plan.approve" }); return xml("<ExecuteChangeSetResponse/>"); }
      if (A === "DescribeStacks") return xml("<DescribeStacksResponse><DescribeStacksResult><Stacks><member><StackName>sws-aws-platform</StackName><StackStatus>" + s.stackStatus + "</StackStatus></member></Stacks></DescribeStacksResult></DescribeStacksResponse>");
      return xmlErr("InvalidAction", "Not in the twin yet: cloudformation " + A);
    });
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

  // Answer a request as AWS would. Returns a Promise of a Response, or null if the host is not AWS.
  function handle(url, init) {
    init = init || {};
    var u = new URL(url), host = u.host;
    var body = typeof init.body === "string" ? init.body : "";
    var p;
    try {
      if (host === "sts.amazonaws.com" || /^sts\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = sts(new URLSearchParams(body), init);
      else if (host === "iam.amazonaws.com") p = iam(new URLSearchParams(body), init);
      else if (/^cloudformation\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = cloudformation(new URLSearchParams(body), init);
      else if (/^ce\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = ce();
      else if (/^cloudcontrolapi\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = cloudcontrol((hdr(init, "x-amz-target") || "").split(".")[1], body, init, host);
      else if (/^lambda\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = lambda(url, init);
      else if (/^monitoring\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = cloudwatch(new URLSearchParams(body), init);
      else if (/^firehose\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = firehose((hdr(init, "x-amz-target") || "").split(".")[1], body, init);
      else if (/\.?s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = s3(url, init);
      else return null;
    } catch (e) { p = xmlErr("InternalFailure", e.message, 500); }
    return Promise.resolve(p).then(function (r) { return new Promise(function (res) { setTimeout(function () { res(r); }, 60 + lag() * 120); }); });
  }

  root.AwsTwin = { handle: handle, account: ACCOUNT, buckets: B, reset: function () { state = null; journal = []; streams = {}; },
    // The journal (design 02): a copy of every entry so far, and a fold of any list of entries into a world.
    journal: function () { build(); return JSON.parse(JSON.stringify(journal)); },
    fold: function (entries) { return fold(entries); },
    packs: PACKS, pack: function () { return pack; },
    usePack: function (name) { if (!PACKS[name]) return; try { localStorage.setItem("sws-aws-twin-pack", name); } catch (e) { /* none */ } } };
})(window);
