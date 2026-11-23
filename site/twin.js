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
    attack: { title: "Attack in progress", about: "One address scanning for secrets and admin pages, then trying path traversal on the vault API, among normal visitors.", perHour: 25, attack: true },
    surge: { title: "Traffic surge", about: "Ten times the usual visitors, most of them on one vault's files.", perHour: 250, attack: false, hot: "/vault/vault-demo-001/files" }
  };
  var pack = "baseline";
  try { var qp = new URLSearchParams(root.location.search).get("pack"); if (qp && PACKS[qp]) pack = qp; else { var sp = localStorage.getItem("sws-aws-twin-pack"); if (sp && PACKS[sp]) pack = sp; } } catch (e) { /* none */ }
  var enc = new TextEncoder();

  // ---- deterministic synthetic data ----
  var seed = 20261123;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; }

  function gzip(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function deflateRaw(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xffffffff; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // A real zip (deflate entries, central directory at the end), so the page reads it by byte ranges.
  function makeZip(files) {
    return Promise.all(files.map(function (f) { var raw = enc.encode(f[1]); return deflateRaw(raw).then(function (d) { return { name: enc.encode(f[0]), raw: raw, data: d, crc: crc32(raw) }; }); }))
      .then(function (es) {
        var parts = [], central = [], off = 0;
        es.forEach(function (e) {
          var h = new DataView(new ArrayBuffer(30));
          h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, 8, true);
          h.setUint16(10, 0x6000, true); h.setUint16(12, 0x5b77, true); h.setUint32(14, e.crc, true);
          h.setUint32(18, e.data.length, true); h.setUint32(22, e.raw.length, true); h.setUint16(26, e.name.length, true);
          parts.push(new Uint8Array(h.buffer), e.name, e.data);
          var c = new DataView(new ArrayBuffer(46));
          c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, 8, true);
          c.setUint16(12, 0x6000, true); c.setUint16(14, 0x5b77, true); c.setUint32(16, e.crc, true); c.setUint32(20, e.data.length, true);
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

  // ---- the synthetic account ----
  var B = {
    site: ACCOUNT + "--demo-site--" + REGION,
    logs: ACCOUNT + "--demo-cloudfront-logs--" + REGION,
    deps: ACCOUNT + "--demo-lambda-deps--" + REGION,
    trail: "aws-cloudtrail-logs-" + ACCOUNT + "-demo"
  };
  var state = null;
  function build() {
    if (state) return state;
    var objects = {}; // bucket -> key -> { body: Promise<Uint8Array>, type, modified }
    function put(bucket, key, type, body, when) { (objects[bucket] = objects[bucket] || {})[key] = { body: Promise.resolve(body).then(function (b) { return typeof b === "string" ? enc.encode(b) : b; }), type: type, modified: when || "2026-11-20T09:00:00.000Z" }; }
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
        lines.push(JSON.stringify({ timestamp: "2026-11-" + day + "T" + pad(hour) + ":" + pad(Math.floor(rnd() * 60)) + ":" + pad(Math.floor(rnd() * 60)) + "Z",
          c_ip: "203.0.113." + Math.floor(rnd() * 250 + 1), cs_method: "GET", cs_uri_stem: p, sc_status: p === "/favicon.ico" ? 404 : 200,
          sc_bytes: Math.floor(rnd() * 9000 + 300), time_taken: +(rnd() * 0.2).toFixed(3), x_edge_location: pick(["LHR50-C1", "DUB2-C1", "AMS1-C1"]), cs_user_agent: pick(["Mozilla/5.0", "curl/8.5", "python-requests/2.32"]) }));
      }
      if (P.attack && day === 22) {
        // One address (TEST-NET-3, documentation range) probing, getting louder each hour.
        var probes = ["/.env", "/.git/config", "/wp-admin/", "/admin", "/config.json", "/backup.zip", "/vault/../../etc/passwd", "/vault/vault-demo-001/files?key=../../secrets", "/api/vaults?id=1%27%20OR%20%271%27=%271"];
        for (var a = 0; a < (hour - 8) * 15; a++) {
          var pr = pick(probes);
          lines.push(JSON.stringify({ timestamp: "2026-11-22T" + pad(hour) + ":" + pad(Math.floor(rnd() * 60)) + ":" + pad(Math.floor(rnd() * 60)) + "Z",
            c_ip: "203.0.113.66", cs_method: pick(["GET", "GET", "POST"]), cs_uri_stem: pr, sc_status: pick([403, 404, 404, 400]), sc_bytes: Math.floor(rnd() * 400 + 100),
            time_taken: +(rnd() * 0.05).toFixed(3), x_edge_location: "AMS1-C1", cs_user_agent: pick(["sqlmap/1.8", "Nuclei - Open-source project", "curl/8.5"]) }));
        }
        lines.sort();
      }
      put(B.logs, "cloudfront/2026/11/" + day + "/" + pad(hour) + "/demo-distribution-1-2026-11-" + day + "-" + pad(hour) + "-00-00.gz", "application/x-gzip", gzip(enc.encode(lines.join("\n") + "\n")), "2026-11-" + day + "T" + pad(hour) + ":59:00.000Z");
    }
    // Lambda dependencies as zips
    put(B.deps, "lambdas-dependencies/demo-handler==v1.0.0.zip", "application/zip", makeZip([
      ["demo_handler/__init__.py", "from .handler import run\n"],
      ["demo_handler/handler.py", "import json\n\n\ndef run(event, context):\n    # Return the vault ids in the request\n    body = json.loads(event.get('body') or '{}')\n    return {'statusCode': 200, 'body': json.dumps({'vaults': body.get('vaults', [])})}\n"],
      ["demo_handler-1.0.0.dist-info/METADATA", "Metadata-Version: 2.1\nName: demo-handler\nVersion: 1.0.0\n"],
      ["config.json", JSON.stringify({ timeout: 30, memory: 256, region: REGION })]
    ]), "2026-11-18T16:54:00.000Z");
    // CloudTrail digest-style records
    put(B.trail, "AWSLogs/" + ACCOUNT + "/CloudTrail/" + REGION + "/2026/11/22/" + ACCOUNT + "_CloudTrail_" + REGION + "_20261122T1000Z_demo.json.gz", "application/x-gzip",
      gzip(enc.encode(JSON.stringify({ Records: [
        { eventTime: "2026-11-22T10:01:02Z", eventSource: "s3.amazonaws.com", eventName: "GetObject", awsRegion: REGION, sourceIPAddress: "203.0.113.7", userIdentity: { type: "AssumedRole", arn: "arn:aws:sts::" + ACCOUNT + ":assumed-role/sws-aws-platform-read/sws-aws-platform" }, requestParameters: { bucketName: B.site, key: "data/vaults.json" } },
        { eventTime: "2026-11-22T10:04:40Z", eventSource: "iam.amazonaws.com", eventName: "UpdateAssumeRolePolicy", awsRegion: "us-east-1", userIdentity: { type: "AssumedRole", arn: "arn:aws:sts::" + ACCOUNT + ":assumed-role/sws-aws-platform-change/sws-aws-platform" }, requestParameters: { roleName: "demo-dns-role" } }
      ] }))), "2026-11-22T10:05:00.000Z");
    var K = "token.actions.githubusercontent.com:sub";
    state = {
      objects: objects, cors: {},
      roles: { "sovereignwebsite-factory-dns": { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Federated: "arn:aws:iam::" + ACCOUNT + ":oidc-provider/token.actions.githubusercontent.com" }, Action: "sts:AssumeRoleWithWebIdentity",
        Condition: { StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com", [K]: ["repo:SovereignWebsite@358722364/SovereignWebsite__IaC@1464324035:environment:apply", "repo:SovereignWebsite@358722364/SovereignWebsite__Factory@1464324035:environment:apply"] } } }] } },
      template: null, stackStatus: "CREATE_COMPLETE", changeSets: {}, requests: {}
    };
    return state;
  }

  // ---- wire helpers ----
  function xml(body, status) { return new Response(body, { status: status || 200, headers: { "content-type": "text/xml" } }); }
  function xmlErr(code, msg, status) { return xml("<ErrorResponse><Error><Code>" + code + "</Code><Message>" + esc(msg) + "</Message></Error></ErrorResponse>", status || 400); }
  function json(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/x-amz-json-1.0" } }); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function hdr(init, name) { var h = init.headers || {}; for (var k in h) if (k.toLowerCase() === name) return h[k]; return null; }
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
  function iam(form, init) {
    if (!signed(init)) return xmlErr("MissingAuthenticationToken", "Request is missing Authentication Token", 403);
    var s = build(), A = form.get("Action"), name = form.get("RoleName");
    if (!s.roles[name]) return xmlErr("NoSuchEntity", "The role with name " + name + " cannot be found.", 404);
    if (A === "GetRole") return xml("<GetRoleResponse><GetRoleResult><Role><RoleName>" + esc(name) + "</RoleName><AssumeRolePolicyDocument>" + encodeURIComponent(JSON.stringify(s.roles[name])) + "</AssumeRolePolicyDocument></Role></GetRoleResult></GetRoleResponse>");
    if (A === "UpdateAssumeRolePolicy") { var p = JSON.parse(form.get("PolicyDocument")); p.Statement.forEach(function (st) { st.Condition = collapse(st.Condition); }); s.roles[name] = p; return xml("<UpdateAssumeRolePolicyResponse/>"); }
    return xmlErr("InvalidAction", "Not in the twin yet: iam " + A);
  }
  function cloudformation(form, init) {
    if (!signed(init)) return xmlErr("MissingAuthenticationToken", "Request is missing Authentication Token", 403);
    var s = build(), A = form.get("Action");
    var ready = s.template ? Promise.resolve(s.template) : fetch(new URL("cloudformation/bootstrap.yaml", document.baseURI)).then(function (r) { return r.text(); })
      .then(function (t) { s.template = t.replace("Description: >-\n", "Description: >-\n  (twin: an older version)\n"); return s.template; });
    return ready.then(function () {
      if (A === "GetTemplate") return xml("<GetTemplateResponse><GetTemplateResult><TemplateBody>" + esc(s.template) + "</TemplateBody></GetTemplateResult></GetTemplateResponse>");
      if (A === "CreateChangeSet") { s.changeSets[form.get("ChangeSetName")] = form.get("TemplateBody"); return xml("<CreateChangeSetResponse><CreateChangeSetResult><Id>twin</Id></CreateChangeSetResult></CreateChangeSetResponse>"); }
      if (A === "DescribeChangeSet") return xml("<DescribeChangeSetResponse><DescribeChangeSetResult><Status>CREATE_COMPLETE</Status><Changes><member><ResourceChange><Action>Modify</Action><LogicalResourceId>PlatformRead</LogicalResourceId><ResourceType>AWS::IAM::Role</ResourceType><Replacement>False</Replacement></ResourceChange></member><member><ResourceChange><Action>Modify</Action><LogicalResourceId>PlatformChange</LogicalResourceId><ResourceType>AWS::IAM::Role</ResourceType><Replacement>False</Replacement></ResourceChange></member></Changes></DescribeChangeSetResult></DescribeChangeSetResponse>");
      if (A === "ExecuteChangeSet") { s.template = s.changeSets[form.get("ChangeSetName")]; s.stackStatus = "UPDATE_COMPLETE"; return xml("<ExecuteChangeSetResponse/>"); }
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
      if (region !== REGION) { s.requests.bad = "The bucket you are attempting to access must be addressed using the specified endpoint."; return json({ ProgressEvent: { RequestToken: "bad", OperationStatus: "IN_PROGRESS" } }); }
      JSON.parse(q.PatchDocument).forEach(function (op) {
        if (op.path === "/CorsConfiguration") s.cors[q.Identifier] = op.value;
        else if (op.path === "/CorsConfiguration/CorsRules/-") s.cors[q.Identifier].CorsRules.push(op.value);
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
    if (!key) {
      var prefix = u.searchParams.get("prefix") || "", delim = u.searchParams.get("delimiter"), seen = {}, contents = [], prefixes = [];
      var all = Object.keys(s.objects[bucket]).sort().filter(function (k) { return k.indexOf(prefix) === 0; });
      return Promise.all(all.map(function (k) { return s.objects[bucket][k].body; })).then(function (bodies) {
        all.forEach(function (k, i) {
          var rest = k.slice(prefix.length), cut = delim ? rest.indexOf(delim) : -1;
          if (cut >= 0) { var cp = prefix + rest.slice(0, cut + 1); if (!seen[cp]) { seen[cp] = 1; prefixes.push("<CommonPrefixes><Prefix>" + esc(cp) + "</Prefix></CommonPrefixes>"); } }
          else contents.push("<Contents><Key>" + esc(k) + "</Key><Size>" + bodies[i].length + "</Size><LastModified>" + s.objects[bucket][k].modified + "</LastModified></Contents>");
        });
        return xml("<ListBucketResult><Name>" + esc(bucket) + "</Name><Prefix>" + esc(prefix) + "</Prefix>" + prefixes.join("") + contents.join("") + "</ListBucketResult>");
      });
    }
    var o = s.objects[bucket][key];
    if (!o) return xml("<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>", 404);
    return o.body.then(function (b) {
      var r = /bytes=(\d+)-(\d+)/.exec(hdr(init, "range") || "");
      if (r) return new Response(b.slice(+r[1], +r[2] + 1), { status: 206, headers: { "content-type": o.type } });
      return new Response(b, { status: 200, headers: { "content-type": o.type } });
    });
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
      else if (/\.?s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = s3(url, init);
      else return null;
    } catch (e) { p = xmlErr("InternalFailure", e.message, 500); }
    return Promise.resolve(p).then(function (r) { return new Promise(function (res) { setTimeout(function () { res(r); }, 60 + rnd() * 120); }); });
  }

  root.AwsTwin = { handle: handle, account: ACCOUNT, buckets: B, reset: function () { state = null; seed = 20261123; },
    packs: PACKS, pack: function () { return pack; },
    usePack: function (name) { if (!PACKS[name]) return; try { localStorage.setItem("sws-aws-twin-pack", name); } catch (e) { /* none */ } } };
})(window);
