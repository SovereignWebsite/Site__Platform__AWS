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

  // ---- deterministic synthetic data ----
  var seed = 20261123;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  // Latency has its own generator, so the data never depends on how many calls came first.
  var lseed = 7;
  function lag() { lseed = (lseed * 1103515245 + 12345) & 0x7fffffff; return lseed / 0x7fffffff; }
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

  // ---- the synthetic account ----
  var B = {
    site: ACCOUNT + "--demo-site--" + REGION,
    logs: ACCOUNT + "--demo-cloudfront-logs--" + REGION,
    deps: ACCOUNT + "--demo-lambda-deps--" + REGION,
    trail: "aws-cloudtrail-logs-" + ACCOUNT + "-demo",
    dotted: "demo.static.example"
  };
  var state = null;
  function seedCors() {
    var o = {}, origin = root.location ? root.location.origin : "http://localhost";
    [B.logs, B.deps, B.trail, B.dotted].forEach(function (b) { o[b] = { CorsRules: [{ Id: "sws-aws-platform", AllowedOrigins: [origin], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], ExposedHeaders: ["ETag", "Content-Type", "Content-Length", "Last-Modified"], MaxAge: 3000 }] }; });
    return o;
  }
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
      put(B.logs, "cloudfront/2026/11/" + day + "/" + pad(hour) + "/demo-distribution-1-2026-11-" + day + "-" + pad(hour) + "-00-00.gz", "application/x-gzip", gzip(enc.encode(lines.join("\n") + "\n")), "2026-11-" + day + "T" + pad(hour) + ":59:00.000Z");
    }
    // Lambda dependencies as zips
    put(B.deps, "lambdas-dependencies/demo-handler==v1.0.0.zip", "application/zip", makeZip([
      ["demo_handler/__init__.py", "from .handler import run\n"],
      ["demo_handler/handler.py", "import json\n\n\ndef run(event, context):\n    # Return the vault ids in the request\n    body = json.loads(event.get('body') or '{}')\n    return {'statusCode': 200, 'body': json.dumps({'vaults': body.get('vaults', [])})}\n"],
      ["demo_handler-1.0.0.dist-info/METADATA", "Metadata-Version: 2.1\nName: demo-handler\nVersion: 1.0.0\n"],
      ["config.json", JSON.stringify({ timeout: 30, memory: 256, region: REGION })]
    ]), "2026-11-18T16:54:00.000Z");
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
        gzip(enc.encode(JSON.stringify({ Records: events }))), modified);
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
    state = {
      objects: objects, cors: seedCors(),
      roles: { "sws-aws-platform-read": platformTrust(), "sws-aws-platform-change": platformTrust(), "sovereignwebsite-factory-dns": { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Federated: "arn:aws:iam::" + ACCOUNT + ":oidc-provider/token.actions.githubusercontent.com" }, Action: "sts:AssumeRoleWithWebIdentity",
        Condition: { StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com", [K]: ["repo:SovereignWebsite@358722364/SovereignWebsite__IaC@1464324035:environment:apply", "repo:SovereignWebsite@358722364/SovereignWebsite__Factory@1464324035:environment:apply"] } } }] } },
      template: null, stackStatus: "CREATE_COMPLETE", changeSets: {}, requests: {}
    };
    // IAM read answers (design 04, dev.2.aws.a): the four demo roles the Lambda and Firehose twins run as, each
    // trusting the service that runs as it, and every role's details, policies and last use.
    function serviceTrust(svc) { return { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: svc }, Action: "sts:AssumeRole" }] }; }
    state.roles["demo-handler-role"] = serviceTrust("lambda.amazonaws.com");
    state.roles["demo-log-enricher-role"] = serviceTrust("lambda.amazonaws.com");
    state.roles["demo-nightly-report-role"] = serviceTrust("lambda.amazonaws.com");
    state.roles["demo-cloudfront-logs-firehose"] = serviceTrust("firehose.amazonaws.com");
    state.iam = iamSeed();
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
  var AWS_MANAGED = { "arn:aws:iam::aws:policy/SecurityAudit": "SecurityAudit", "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess": "ViewOnlyAccess" };
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
            stmt("ThisStackOnly", ["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents", "cloudformation:GetTemplate", "cloudformation:GetTemplateSummary", "cloudformation:CreateChangeSet", "cloudformation:DescribeChangeSet", "cloudformation:ExecuteChangeSet", "cloudformation:DeleteChangeSet"], "arn:aws:cloudformation:" + REGION + ":" + ACCOUNT + ":stack/sws-aws-platform/*"),
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
    var max = Math.min(+(form.get("MaxItems") || 100), cap || 1000), from = form.get("Marker") ? +atob(form.get("Marker")) : 0;
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
  function iam(form, init) {
    if (!signed(init)) return xmlErr("MissingAuthenticationToken", "Request is missing Authentication Token", 403);
    var s = build(), A = form.get("Action"), name = form.get("RoleName"), page;
    if (A === "ListRoles") {
      page = iamPage(Object.keys(s.roles).sort(), form, function (n) { return "<member>" + iamRoleXml(s, n, false) + "</member>"; }, 2);
      return iamOk("ListRoles", "<Roles>" + page.items + "</Roles>" + page.tail);
    }
    if (A === "GetOpenIDConnectProvider") {
      if (form.get("OpenIDConnectProviderArn") !== "arn:aws:iam::" + ACCOUNT + ":oidc-provider/token.actions.githubusercontent.com") return xmlErr("NoSuchEntity", "OpenIDConnect Provider not found for arn " + form.get("OpenIDConnectProviderArn"), 404);
      return iamOk("GetOpenIDConnectProvider", "<Url>token.actions.githubusercontent.com</Url><ClientIDList><member>sts.amazonaws.com</member></ClientIDList><CreateDate>2026-11-15T08:55:00Z</CreateDate>");
    }
    if (A === "ListOpenIDConnectProviders")
      return iamOk("ListOpenIDConnectProviders", "<OpenIDConnectProviderList><member><Arn>arn:aws:iam::" + ACCOUNT + ":oidc-provider/token.actions.githubusercontent.com</Arn></member></OpenIDConnectProviderList>");
    if (A === "GetPolicy" || A === "GetPolicyVersion") {
      var arn = form.get("PolicyArn"), pn = AWS_MANAGED[arn];
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
      return iamOk("ListAttachedRolePolicies", "<AttachedPolicies>" + page.items + "</AttachedPolicies>" + page.tail);
    }
    if (A === "ListRolePolicies") {
      page = iamPage(Object.keys(info.inline).sort(), form, function (n) { return "<member>" + esc(n) + "</member>"; });
      return iamOk("ListRolePolicies", "<PolicyNames>" + page.items + "</PolicyNames>" + page.tail);
    }
    if (A === "GetRolePolicy") {
      var pol = form.get("PolicyName");
      if (!info.inline[pol]) return xmlErr("NoSuchEntity", "The role policy with name " + pol + " cannot be found.", 404);
      return iamOk("GetRolePolicy", "<RoleName>" + esc(name) + "</RoleName><PolicyName>" + esc(pol) + "</PolicyName><PolicyDocument>" + encodeURIComponent(JSON.stringify(info.inline[pol])) + "</PolicyDocument>");
    }
    if (A === "UpdateAssumeRolePolicy") { var p = JSON.parse(form.get("PolicyDocument")); p.Statement.forEach(function (st) { st.Condition = collapse(st.Condition); }); s.roles[name] = p; return xml("<UpdateAssumeRolePolicyResponse" + IAM_NS + "><ResponseMetadata><RequestId>00000000-0000-4000-8000-0000000000ab</RequestId></ResponseMetadata></UpdateAssumeRolePolicyResponse>"); }
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
  // ---- Costs (the Costs tab: billing.aws.a's site/billing.js on CostsApi, site/api/costs-api.js) ----
  // Cost Explorer GetCostAndUsage, GetCostForecast and GetDimensionValues for the twin's account, signed calls only
  // (security.aws.a, R-025 (a)). Every figure is synthetic and every answer says so (x-twin-note). Budgets is answered as a
  // browser sees it: boto3.aws.a's note 21 finds the SDK's CORS table does not mark Budgets as allowing CORS, so the call
  // fails as a refused cross-origin request would. Figures (billing.aws.a's choice): small round amounts per service per
  // day, in ten-thousandths of a dollar so every view adds up exactly, from 1 September 2026 to today (the twin's clock
  // where it has one); later days are empty, the current month is Estimated, each period echoes the request. The twin's
  // own choices: these services and amounts, region global for CloudFront and Tax, 31 periods a page, a forecast that may
  // not start in the past, the error wording.
  var COST_NOTE = "synthetic figures from the twin, not an AWS bill", COST_FROM = Date.UTC(2026, 8, 1), DAY_MS = 86400000;
  var COST_SERVICES = [
    { name: "AWS Cost Explorer", region: "us-east-1", daily: 500 }, { name: "AWS Lambda", region: REGION, daily: 200 },
    { name: "AWS Secrets Manager", region: "us-east-1", monthly: 4000 }, { name: "Amazon CloudFront", region: "global", daily: 1000 },
    { name: "Amazon Simple Storage Service", region: REGION, daily: 500 }, { name: "Tax", region: "global", daily: 0 }
  ];
  var COST_SPAN_DAYS = 427; // about 14 months: the twin's own bound (security.aws.a), so no request builds a huge answer
  var COST_METRICS = { UnblendedCost: 1, BlendedCost: 1, AmortizedCost: 1, NetUnblendedCost: 1 };
  function costJson(o, status) { var r = new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/x-amz-json-1.1", "x-twin-note": COST_NOTE } }); return r; }
  function costErr(type, msg, status) { return costJson({ __type: type, message: msg }, status || 400); }
  function costDay(v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "")); if (!m) return null; var t = Date.UTC(+m[1], +m[2] - 1, +m[3]); return new Date(t).toISOString().slice(0, 10) === m[0] ? t : null; }
  function costIso(t) { return new Date(t).toISOString().slice(0, 10); }
  function costToday() { var n = new Date(typeof nowMs === "function" ? nowMs() : Date.now()); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); }
  function costOn(svc, t) { return t < COST_FROM || t > costToday() ? 0 : (svc.daily || 0) + (svc.monthly && new Date(t).getUTCDate() === 1 ? svc.monthly : 0); }
  function costSum(svcs, a, b) { var n = 0; svcs.forEach(function (sv) { for (var t = a; t < b; t += DAY_MS) n += costOn(sv, t); }); return n; }
  function costAmount(n) { return Math.floor(n / 10000) + "." + String(n % 10000).padStart(4, "0") + "000000"; }
  function costPeriods(start, end, gran) {
    var out = [], t = start;
    while (t < end) { var d = new Date(t), next = gran === "DAILY" ? t + DAY_MS : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); out.push([t, Math.min(next, end)]); t = Math.min(next, end); }
    return out;
  }
  function ce(init, target, body) {
    if (!signed(init)) return costErr("AccessDeniedException", "Missing Authentication Token", 403);
    var q; try { q = JSON.parse(body || "{}"); } catch (e) { return costErr("ValidationException", "The body is not JSON."); }
    var tp = q.TimePeriod || {}, start = costDay(tp.Start), end = costDay(tp.End), gran = q.Granularity || "MONTHLY";
    if (start === null || end === null || start >= end) return costErr("ValidationException", "TimePeriod needs Start before End, both YYYY-MM-DD (End is exclusive).");
    if (end - start > COST_SPAN_DAYS * DAY_MS) return costErr("ValidationException", "TimePeriod is at most " + COST_SPAN_DAYS + " days (about 14 months) in the twin.");
    if (gran !== "DAILY" && gran !== "MONTHLY") return costErr("ValidationException", "Granularity is DAILY or MONTHLY in the twin.");
    var action = String(target || "").replace(/^AWSInsightsIndexService\./, "");
    if (action === "GetCostAndUsage") {
      var metrics = Array.isArray(q.Metrics) ? q.Metrics : [];
      if (!metrics.length || !metrics.every(function (m) { return typeof m === "string" && Object.prototype.hasOwnProperty.call(COST_METRICS, m); })) return costErr("ValidationException", "Metrics are UnblendedCost, BlendedCost, AmortizedCost or NetUnblendedCost in the twin.");
      var group = Array.isArray(q.GroupBy) && q.GroupBy[0] ? q.GroupBy[0] : null;
      if (group && (q.GroupBy.length > 1 || group.Type !== "DIMENSION" || (group.Key !== "SERVICE" && group.Key !== "REGION"))) return costErr("ValidationException", "GroupBy is one DIMENSION, SERVICE or REGION, in the twin.");
      var periods = costPeriods(start, end, gran), from = 0;
      if (q.NextPageToken) { var pm = /^twin-costs-(\d{1,4})$/.exec(String(q.NextPageToken)); if (!pm || +pm[1] >= periods.length) return costErr("ValidationException", "The NextPageToken is not valid."); from = +pm[1]; }
      var today = new Date(costToday()), monthStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
      var money = function (n) { var o = {}; metrics.forEach(function (m) { o[m] = { Amount: costAmount(n), Unit: "USD" }; }); return o; };
      var out = { ResultsByTime: periods.slice(from, from + 31).map(function (p) {
        var r = { TimePeriod: { Start: costIso(p[0]), End: costIso(p[1]) }, Total: {}, Groups: [], Estimated: p[1] > monthStart };
        if (!group) r.Total = money(costSum(COST_SERVICES, p[0], p[1]));
        else {
          var keys = {};
          COST_SERVICES.forEach(function (sv) { var k = group.Key === "SERVICE" ? sv.name : sv.region; keys[k] = (keys[k] || 0) + costSum([sv], p[0], p[1]); });
          r.Groups = Object.keys(keys).sort().map(function (k) { return { Keys: [k], Metrics: money(keys[k]) }; });
        }
        return r;
      }), DimensionValueAttributes: [] };
      if (group) out.GroupDefinitions = [{ Type: "DIMENSION", Key: group.Key }];
      if (from + 31 < periods.length) out.NextPageToken = "twin-costs-" + (from + 31);
      return costJson(out);
    }
    if (action === "GetCostForecast") {
      if (!/^(UNBLENDED|BLENDED|AMORTIZED|NET_UNBLENDED)_COST$/.test(String(q.Metric || ""))) return costErr("ValidationException", "Metric is UNBLENDED_COST, BLENDED_COST, AMORTIZED_COST or NET_UNBLENDED_COST in the twin.");
      if (start < costToday()) return costErr("ValidationException", "The forecast may not start in the past (the twin's rule).");
      var expected = function (t) { var n = 0; COST_SERVICES.forEach(function (sv) { n += (sv.daily || 0) + (sv.monthly && new Date(t).getUTCDate() === 1 ? sv.monthly : 0); }); return n; };
      var fr = costPeriods(start, end, gran).map(function (p) { var n = 0; for (var t = p[0]; t < p[1]; t += DAY_MS) n += expected(t); return [p, n]; }), total = 0;
      fr.forEach(function (x) { total += x[1]; });
      return costJson({ Total: { Amount: costAmount(total), Unit: "USD" }, ForecastResultsByTime: fr.map(function (x) {
        return { TimePeriod: { Start: costIso(x[0][0]), End: costIso(x[0][1]) }, MeanValue: costAmount(x[1]), PredictionIntervalLowerBound: costAmount(Math.round(x[1] * 0.9)), PredictionIntervalUpperBound: costAmount(Math.round(x[1] * 1.1)) };
      }) });
    }
    if (action === "GetDimensionValues") {
      if (q.Dimension !== "SERVICE" && q.Dimension !== "REGION") return costErr("ValidationException", "Dimension is SERVICE or REGION in the twin.");
      var vals = {};
      COST_SERVICES.forEach(function (sv) { if (costSum([sv], start, end) > 0) vals[q.Dimension === "SERVICE" ? sv.name : sv.region] = 1; });
      var vs = Object.keys(vals).sort();
      return costJson({ DimensionValues: vs.map(function (v) { return { Value: v, Attributes: {} }; }), ReturnSize: vs.length, TotalSize: vs.length });
    }
    return costErr("ValidationException", "The twin answers three Cost Explorer reads only: GetCostAndUsage, GetCostForecast and GetDimensionValues.");
  }
  // Budgets: refused as a browser would refuse a cross-origin call AWS does not allow (no CORS: note 21).
  function budgets() { return Promise.reject(new TypeError("Failed to fetch")); }
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
    if (/^\/2015-03-31\/functions\/?$/.test(path)) return Promise.all(Object.keys(FN).sort().map(fnConfig)).then(function (fs) { return lambdaJson({ Functions: fs, NextMarker: null }); });
    if ((m = /^\/2015-03-31\/functions\/([^/]+)\/configuration\/?$/.exec(path))) {
      var n = decodeURIComponent(m[1]).replace(/^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:/, "");
      if (!FN[n]) return lambdaJson({ Type: "User", Message: "Function not found: " + fnArn(n) }, 404, "ResourceNotFoundException");
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
      var st = STREAMS[q.DeliveryStreamName];
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
      else if (/^ce\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = ce(init, hdr(init, "x-amz-target"), body);
      else if (host === "budgets.amazonaws.com") p = budgets();
      else if (/^cloudcontrolapi\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = cloudcontrol((hdr(init, "x-amz-target") || "").split(".")[1], body, init, host);
      else if (/^lambda\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = lambda(url, init);
      else if (/^firehose\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = firehose((hdr(init, "x-amz-target") || "").split(".")[1], body, init);
      else if (/\.?s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) p = s3(url, init);
      else return null;
    } catch (e) { p = xmlErr("InternalFailure", e.message, 500); }
    return Promise.resolve(p).then(function (r) { return new Promise(function (res) { setTimeout(function () { res(r); }, 60 + lag() * 120); }); });
  }

  root.AwsTwin = { handle: handle, account: ACCOUNT, buckets: B, reset: function () { state = null; seed = 20261123; lseed = 7; },
    packs: PACKS, pack: function () { return pack; },
    usePack: function (name) { if (!PACKS[name]) return; try { localStorage.setItem("sws-aws-twin-pack", name); } catch (e) { /* none */ } } };
})(window);
