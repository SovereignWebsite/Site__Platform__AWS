// LogsApi: CloudWatch Logs' read calls as plain objects (design 03, part 1), over the same send as S3Api: JSON 1.1,
// target prefix Logs_20140328. Reads only; never sees credentials; cannot tell AWS from the twin. lambda.aws.a's
// note 03 (docs/lambda/2026-11-23__03-recent-invocations.md): a Lambda function's recent invocations.
//
//   var api = LogsApi(send);
//   api.groups(region, { prefix, next, max })                         -> { items: [group], next }   DescribeLogGroups
//   api.events(region, group, { start, end, pattern, newest, next, max }) -> { items: [event], next }   FilterLogEvents
//   group = { name, arn, region, created, retentionDays, storedBytes }   (created ISO; retentionDays null = never expire)
//   event = { stream, time, timestamp, message, id }                    (time ISO, timestamp epoch ms, message as written)
//   start and end: ISO strings or epoch ms; newest: true asks for the latest events first (startFromHead false, which
//   AWS accepts only with a start on or after 2024-01-01; an earlier start is refused before any request).
//   group: a log group name, or its ARN (with or without the trailing :*).
//   LogsApi.invocations(events) -> [invocation]   no request: groups Lambda's START/END/REPORT lines by request id
//   invocation = { requestId, start, end, durationMs, billedMs, memoryMb, maxMemoryMb, initMs, errors, complete, lines }
//   LogsApi.all = ApiAll (site/api/all.js), to drain groups() or events() with a cap.
//
// Messages are the function's own output and, for a web-facing function, carry request paths an attacker chose:
// render them as text, never as markup (note 03, security).
// Errors: an Error whose message is "Code: Message", with .code and .status; __type may come bare or prefixed
// ("...#Code"), and is cut at ":" then "#" as botocore does (boto3.aws.a, note 11). A CORS TypeError passes through.
(function (root) {
  "use strict";
  var REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  function ms(t) { return typeof t === "number" ? t : t === undefined || t === null ? undefined : Date.parse(t); }
  function iso(t) { return typeof t === "number" ? new Date(t).toISOString() : null; }
  function LogsApi(send) {
    if (typeof send !== "function") throw new TypeError("LogsApi needs a send function");
    function call(region, target, payload) {
      region = String(region); // tested and used as the same string (security R-023 b, as CfnApi)
      if (!REGION_RE.test(region)) return Promise.reject(new TypeError("not an AWS region: " + region)); // it goes into a signed host name
      var url = "https://logs." + region + ".amazonaws.com/";
      return send({ service: "logs", region: region, method: "POST", url: url, body: JSON.stringify(payload),
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "Logs_20140328." + target } }).then(function (r) {
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          var j = {}; try { j = JSON.parse(t); } catch (e) { /* not JSON */ }
          throw fail(String(j.__type || "HTTP " + r.status).split(":")[0].split("#").pop(), j.message || j.Message || "no message", r.status);
        });
      });
    }
    function groups(region, o) {
      o = o || {};
      var q = { limit: Math.min(Math.max(1, (o.max || 50) | 0), 50) };
      if (o.prefix) q.logGroupNamePrefix = String(o.prefix);
      if (o.next) q.nextToken = o.next;
      return call(region, "DescribeLogGroups", q).then(function (j) {
        return { items: (j.logGroups || []).map(function (g) {
          var r = /^arn:aws:logs:([a-z0-9-]+):/.exec(g.arn || g.logGroupArn || "");
          return { name: g.logGroupName, arn: g.logGroupArn || String(g.arn || "").replace(/:\*$/, "") || null, region: r ? r[1] : region,
            created: iso(g.creationTime), retentionDays: typeof g.retentionInDays === "number" ? g.retentionInDays : null,
            storedBytes: typeof g.storedBytes === "number" ? g.storedBytes : null };
        }), next: j.nextToken || null };
      });
    }
    function events(region, group, o) {
      o = o || {};
      var g = String(group || ""), q = {};
      if (!g) return Promise.reject(new TypeError("events needs a log group"));
      if (/^arn:/.test(g)) q.logGroupIdentifier = g.replace(/:\*$/, ""); else q.logGroupName = g;
      var s = ms(o.start), e = ms(o.end);
      if (s !== undefined) { if (isNaN(s)) return Promise.reject(new TypeError("not a time: " + o.start)); q.startTime = s; }
      if (e !== undefined) { if (isNaN(e)) return Promise.reject(new TypeError("not a time: " + o.end)); q.endTime = e; }
      if (o.pattern) q.filterPattern = String(o.pattern);
      // FilterLogEvents takes startFromHead (botocore 1.44.9's logs model, 2014-03-28); false is accepted only with a
      // startTime on or after 2024-01-01T00:00:00Z, else InvalidParameterException, so that is refused here first.
      if (o.newest) {
        // An absent start is refused too: AWS's note names only starts on or after that day (the twin reads it so).
        if (s === undefined || s < Date.UTC(2024, 0, 1)) return Promise.reject(new TypeError("newest needs a start on or after 2024-01-01 (FilterLogEvents)"));
        q.startFromHead = false;
      }
      q.limit = Math.min(Math.max(1, (o.max || 100) | 0), 10000);
      if (o.next) q.nextToken = o.next;
      return call(region, "FilterLogEvents", q).then(function (j) {
        return { items: (j.events || []).map(function (x) {
          return { stream: x.logStreamName || null, time: iso(x.timestamp), timestamp: x.timestamp, message: x.message, id: x.eventId || null };
        }), next: j.nextToken || null };
      });
    }
    return { groups: groups, events: events };
  }
  // Lambda's platform lines, as it writes them for the zip runtimes (text log format): START, END and REPORT per
  // request id. Anything else carrying a request id (the runtime's own [ERROR] or [INFO] lines, tab-separated with
  // the id in the third field) joins that invocation; [ERROR] lines are counted. An invocation without its REPORT in
  // the events given is complete: false (it ran past the window, or the page ended). Newest first if the events were.
  var UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  var START = new RegExp("^START RequestId: (" + UUID + ")"), END = new RegExp("^END RequestId: (" + UUID + ")"),
    REPORT = new RegExp("^REPORT RequestId: (" + UUID + ")"), INLINE = new RegExp("^\\[[A-Z]+\\]\\t[^\\t]*\\t(" + UUID + ")\\t");
  function num(m, re) { var x = re.exec(m); return x ? +x[1] : null; }
  LogsApi.invocations = function (evs) {
    var by = Object.create(null), order = [];
    (evs || []).forEach(function (e) {
      var m = String(e.message || ""), id = null, k;
      if ((k = START.exec(m)) || (k = END.exec(m)) || (k = REPORT.exec(m)) || (k = INLINE.exec(m))) id = k[1];
      if (!id) return;
      var v = by[id];
      if (!v) { v = by[id] = { requestId: id, start: null, end: null, durationMs: null, billedMs: null, memoryMb: null, maxMemoryMb: null, initMs: null, errors: 0, complete: false, lines: [] }; order.push(id); }
      v.lines.push(e);
      if (START.test(m)) v.start = e.time || iso(e.timestamp);
      else if (END.test(m)) v.end = e.time || iso(e.timestamp);
      else if (REPORT.test(m)) {
        v.complete = true; v.end = v.end || e.time || iso(e.timestamp);
        v.durationMs = num(m, /\tDuration: ([\d.]+) ms/); v.billedMs = num(m, /\tBilled Duration: ([\d.]+) ms/);
        v.memoryMb = num(m, /\tMemory Size: (\d+) MB/); v.maxMemoryMb = num(m, /\tMax Memory Used: (\d+) MB/); v.initMs = num(m, /\tInit Duration: ([\d.]+) ms/);
      } else if (/^\[ERROR\]\t/.test(m)) v.errors++;
    });
    return order.map(function (id) { return by[id]; });
  };
  LogsApi.all = function (page, opts) { return root.ApiAll(page, opts); };
  root.LogsApi = LogsApi;
})(typeof window !== "undefined" ? window : globalThis);
