// CloudTrail alarm rules: run in the page over the reader's events (ct-reader.js), each rule written in words,
// each result carrying the events that fired it. Reference implementation by cloudtrail.aws.a, kept in docs/
// until a code path is agreed. Rules from the first note and security.aws.c's R-008 (c) and R-005.
(function (root) {
  "use strict";
  var PLATFORM = /^sws-aws-platform-/, DNS_ROLE = "sovereignwebsite-factory-dns", TRAIL_BUCKET = /^aws-cloudtrail-logs-/;
  // Sets without a prototype, so an action named "constructor" or "__proto__" is not a member (R-021 a).
  function set(names) { var o = Object.create(null); names.forEach(function (n) { o[n] = 1; }); return o; }
  var IAM_CHANGES = set(["UpdateAssumeRolePolicy", "PutRolePolicy", "AttachRolePolicy", "DetachRolePolicy", "DeleteRolePolicy",
    "CreatePolicyVersion", "SetDefaultPolicyVersion", "UpdateRole", "PutRolePermissionsBoundary", "DeleteRolePermissionsBoundary",
    "CreateRole", "DeleteRole", "TagRole", "UntagRole"]);
  var STACK_CHANGES = set(["ExecuteChangeSet", "UpdateStack", "DeleteStack"]);
  var TRAIL_CHANGES = set(["StopLogging", "DeleteTrail", "UpdateTrail", "PutEventSelectors", "PutInsightSelectors"]);
  var TRAIL_BUCKET_CHANGES = set(["PutBucketPolicy", "DeleteBucketPolicy", "PutBucketLifecycle", "PutBucketLifecycleConfiguration", "DeleteBucketLifecycle", "DeleteBucket"]);

  function names(e, type) { return e.targets.filter(function (t) { return t.type === type; }).map(function (t) { return t.name; }); }
  function hub(n) { return n === "sws-aws-platform" || PLATFORM.test(n); }

  // The three protected things, whether the call succeeded or not; ctx.trailBuckets are the buckets trails write to.
  function hubRoles(e) { return e.service === "iam" && IAM_CHANGES[e.action] === 1 && names(e, "role").some(function (n) { return PLATFORM.test(n) || n === DNS_ROLE; }); }
  function hubStack(e) { return e.service === "cloudformation" && STACK_CHANGES[e.action] === 1 && names(e, "stack").some(hub); }
  function trail(e, ctx) {
    if (e.service === "cloudtrail") return TRAIL_CHANGES[e.action] === 1;
    return e.service === "s3" && TRAIL_BUCKET_CHANGES[e.action] === 1 && names(e, "bucket").some(function (b) { return TRAIL_BUCKET.test(b) || ctx.trailBuckets[b] === 1; });
  }

  var RULES = [
    { id: "iam-trust-or-permissions", level: "high",
      words: "Someone changed who may use, or what may be done by, the hub's roles or the DNS role.",
      match: function (e) { return !e.failed && hubRoles(e); } },
    { id: "hub-stack-change-applied", level: "high",
      words: "The hub's own stack was changed or deleted (R-008: a change set can rewrite the change role).",
      match: function (e) { return !e.failed && hubStack(e); } },
    { id: "trail-changed", level: "high",
      words: "CloudTrail itself, or the bucket it writes to, was stopped or changed, so later events may be missing.",
      match: function (e, ctx) { return !e.failed && trail(e, ctx); } },
    { id: "refused-on-protected", level: "medium",
      words: "Someone tried, and was refused, to change the hub's roles, its stack, or CloudTrail.",
      match: function (e, ctx) { return e.failed && (hubRoles(e) || hubStack(e) || trail(e, ctx)); } },
    { id: "refused-burst", level: "medium",
      words: "One identity was refused five times or more within ten minutes.",
      group: function (events) {
        var out = [], by = Object.create(null);
        events.filter(function (e) { return e.failed; }).forEach(function (e) { var k = e.who.kind + ":" + e.who.name; (by[k] = by[k] || []).push(e); });
        Object.keys(by).forEach(function (k) {
          var list = by[k].slice().sort(function (a, b) { return a.time - b.time; });
          for (var i = 0, j = 0; j < list.length; j++) {
            while (list[j].time - list[i].time > 600e3) i++;
            if (j - i + 1 >= 5) { out.push(list.slice(i, j + 1)); i = j + 1; }
          }
        });
        return out;
      } },
    { id: "new-network", level: "medium",
      words: "A change was made from a network (/24 or /48) not seen in any earlier event.",
      group: function (events) {
        var seen = Object.create(null), out = [];
        events.slice().sort(function (a, b) { return a.time - b.time; }).forEach(function (e, n) {
          var ip = e.from.net;
          if (!ip) return; // a service acting, or no address
          if (n > 0 && !seen[ip] && e.change && !e.failed) out.push([e]);
          seen[ip] = 1;
        });
        return out;
      } }
  ];

  // Returns alarms, newest first: { rule, level, words, events, time }.
  function run(events) {
    var alarms = [], ctx = { trailBuckets: Object.create(null) };
    events.forEach(function (e) { var b = e.service === "cloudtrail" && e.raw && e.raw.requestParameters && e.raw.requestParameters.s3BucketName; if (typeof b === "string") ctx.trailBuckets[b] = 1; });
    RULES.forEach(function (r) {
      var groups = r.group ? r.group(events) : events.filter(function (e) { return r.match(e, ctx); }).map(function (e) { return [e]; });
      groups.forEach(function (g) { alarms.push({ rule: r.id, level: r.level, words: r.words, events: g, time: Math.max.apply(null, g.map(function (e) { return e.time; })) }); });
    });
    return alarms.sort(function (a, b) { return b.time - a.time; });
  }

  root.CloudTrailAlarms = { run: run, rules: RULES.map(function (r) { return { id: r.id, level: r.level, words: r.words }; }) };
})(typeof window !== "undefined" ? window : globalThis);
