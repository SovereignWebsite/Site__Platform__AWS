// CloudTrail alarm rules: run in the page over the reader's events (ct-reader.js), each rule written in words,
// each result carrying the events that fired it. Reference implementation by cloudtrail.aws.a, kept in docs/
// until a code path is agreed. Rules from the first note and security.aws.c's R-008 (c) and R-005.
(function (root) {
  "use strict";
  var PLATFORM = /^sws-aws-platform-/, DNS_ROLE = "sovereignwebsite-factory-dns";
  var IAM_CHANGES = { UpdateAssumeRolePolicy: 1, PutRolePolicy: 1, AttachRolePolicy: 1, DetachRolePolicy: 1, DeleteRolePolicy: 1, CreatePolicyVersion: 1, SetDefaultPolicyVersion: 1 };
  var TRAIL_CHANGES = { StopLogging: 1, DeleteTrail: 1, UpdateTrail: 1, PutEventSelectors: 1, PutInsightSelectors: 1 };

  function roleNames(e) { return e.targets.filter(function (t) { return t.type === "role"; }).map(function (t) { return t.name; }); }

  var RULES = [
    { id: "iam-trust-or-permissions", level: "high",
      words: "Someone changed who may use, or what may be done by, the hub's roles or the DNS role.",
      match: function (e) { return e.service === "iam" && IAM_CHANGES[e.action] && !e.failed && roleNames(e).some(function (n) { return PLATFORM.test(n) || n === DNS_ROLE; }); } },
    { id: "hub-stack-change-applied", level: "high",
      words: "A change set was applied to the hub's own stack (R-008: a change set can rewrite the change role).",
      match: function (e) { return e.service === "cloudformation" && e.action === "ExecuteChangeSet" && !e.failed && e.targets.some(function (t) { return t.type === "stack" && (t.name === "sws-aws-platform" || PLATFORM.test(t.name)); }); } },
    { id: "trail-changed", level: "high",
      words: "CloudTrail itself was stopped or changed, so later events may be missing.",
      match: function (e) { return e.service === "cloudtrail" && TRAIL_CHANGES[e.action] && !e.failed; } },
    { id: "refused-burst", level: "medium",
      words: "One identity was refused five times or more within ten minutes.",
      group: function (events) {
        var out = [], by = {};
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
    { id: "new-address", level: "medium",
      words: "A change was made from an address not seen in any earlier event.",
      group: function (events) {
        var seen = {}, out = [];
        events.slice().sort(function (a, b) { return a.time - b.time; }).forEach(function (e, n) {
          var ip = e.from.ip;
          if (!ip || /\.amazonaws\.com$/.test(ip)) return; // a service acting, not an address
          if (n > 0 && !seen[ip] && e.change && !e.failed) out.push([e]);
          seen[ip] = 1;
        });
        return out;
      } }
  ];

  // Returns alarms, newest first: { rule, level, words, events, time }.
  function run(events) {
    var alarms = [];
    RULES.forEach(function (r) {
      var groups = r.group ? r.group(events) : events.filter(r.match).map(function (e) { return [e]; });
      groups.forEach(function (g) { alarms.push({ rule: r.id, level: r.level, words: r.words, events: g, time: Math.max.apply(null, g.map(function (e) { return e.time; })) }); });
    });
    return alarms.sort(function (a, b) { return b.time - a.time; });
  }

  root.CloudTrailAlarms = { run: run, rules: RULES.map(function (r) { return { id: r.id, level: r.level, words: r.words }; }) };
})(typeof window !== "undefined" ? window : globalThis);
