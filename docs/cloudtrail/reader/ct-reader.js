// CloudTrail reader: turns CloudTrail input into the one event shape every view reads
// (docs/cloudtrail/2026-11-23__02-event-shape.md). Reference implementation by cloudtrail.aws.a, kept in
// docs/ until a code path is agreed. No network, no DOM: give it parsed JSON, get events back.
// Targets use ontology.aws.a's node ids (ARNs) and type names (docs/ontology/2026-11-23__01-resource-ontology.md).
(function (root) {
  "use strict";
  // Derived ids (resources without an ARN): the graph's prefix. "twin:" today; "urn:sws:" if ontology.aws.a agrees (design 03).
  var DERIVED = "twin:";
  var LABELS = { "sws-aws-platform-read": "the read role", "sws-aws-platform-change": "the change role" };

  function who(u) {
    u = u || {};
    var sc = u.sessionContext || {}, issuer = sc.sessionIssuer || {}, fed = sc.webIdFederationData || {};
    var via = u.invokedBy || fed.federatedProvider || u.identityProvider || null;
    switch (u.type) {
      case "AssumedRole": return { kind: "role", name: issuer.userName || null, arn: issuer.arn || null, via: via };
      case "IAMUser": return { kind: "user", name: u.userName || null, arn: u.arn || null, via: via };
      case "Root": return { kind: "root", name: "the account root", arn: u.arn || null, via: via };
      case "WebIdentityUser": return { kind: "web", name: u.userName || null, arn: null, via: via };
      case "AWSService": return { kind: "service", name: u.invokedBy || null, arn: null, via: via };
      default: return { kind: "unknown", name: u.type || null, arn: u.arn || null, via: via };
    }
  }

  function roleFromArn(a) { var m = /^arn:aws:iam::(\d{12}):role\/(.+)$/.exec(a || ""); return m ? { account: m[1], name: m[2] } : null; }

  function targets(r) {
    var p = r.requestParameters || {}, acct = r.recipientAccountId, svc = (r.eventSource || "").replace(/\.amazonaws\.com$/, ""), out = [];
    function role(name, account) { if (name) out.push({ type: "role", id: "arn:aws:iam::" + (account || acct) + ":role/" + name, name: name }); }
    function bucket(b) { if (b) out.push({ type: "bucket", id: "arn:aws:s3:::" + b, name: b }); }
    if (p.bucketName) { bucket(p.bucketName); if (p.key) out.push({ type: "object", id: "arn:aws:s3:::" + p.bucketName + "/" + p.key, name: p.key }); }
    if (p.roleName) role(p.roleName);
    if (p.roleArn) { var ra = roleFromArn(p.roleArn); if (ra) role(ra.name, ra.account); }
    if (p.policyArn) out.push({ type: "policy", id: p.policyArn, name: p.policyArn.split("/").pop() });
    if (p.stackName) out.push({ type: "stack", id: "arn:aws:cloudformation:" + r.awsRegion + ":" + acct + ":stack/" + p.stackName, name: p.stackName }); // as the graph names stacks (no stack uuid)
    if (svc === "cloudcontrolapi" && p.typeName === "AWS::S3::Bucket") bucket(p.identifier);
    if (svc === "cloudtrail" && p.name) out.push({ type: "trail", id: DERIVED + "cloudtrail/trail/" + p.name, name: p.name });
    if (p.functionName) out.push({ type: "function", id: "arn:aws:lambda:" + r.awsRegion + ":" + acct + ":function:" + p.functionName, name: p.functionName });
    return out;
  }

  function label(w) { return (w.name && LABELS[w.name]) || w.name || "someone unknown"; }
  function first(ts, type) { for (var i = 0; i < ts.length; i++) if (ts[i].type === type) return ts[i].name; return null; }

  function words(e) {
    var w = label(e.who), t = e.targets, role = first(t, "role"), stack = first(t, "stack"), b = first(t, "bucket"), key = first(t, "object");
    var s;
    switch (e.action) {
      case "AssumeRoleWithWebIdentity": s = w + " signed in to " + (LABELS[role] || "the role " + role) + (e.who.via ? " with " + (e.who.via === "accounts.google.com" ? "Google" : e.who.via) : ""); break;
      case "UpdateAssumeRolePolicy": s = w + " rewrote who may assume the role " + role; break;
      case "PutRolePolicy": case "AttachRolePolicy": s = w + " gave the role " + role + " new permissions"; break;
      case "CreateChangeSet": s = w + " prepared a change to the stack " + stack; break;
      case "ExecuteChangeSet": s = w + " applied a change to the stack " + stack; break;
      case "UpdateResource": s = b ? w + " changed the settings of the bucket " + b : w + " changed a resource"; break;
      case "GetObject": s = w + " read " + key + " in " + b; break;
      case "ListObjectsV2": case "ListObjects": case "ListBucket": s = w + " listed " + b; break;
      case "StopLogging": s = w + " stopped the trail " + first(t, "trail"); break;
      default: s = w + " called " + e.action + " on " + e.service;
    }
    if (e.failed) s += " (refused: " + e.failed.code + ")";
    return s;
  }

  function normalise(r) {
    var e = {
      id: r.eventID || null,
      time: r.eventTime ? Date.parse(r.eventTime) : null,
      iso: r.eventTime || null,
      service: (r.eventSource || "").replace(/\.amazonaws\.com$/, "") || null,
      action: r.eventName || null,
      region: r.awsRegion || null,
      account: r.recipientAccountId || null,
      who: who(r.userIdentity),
      from: { ip: r.sourceIPAddress || null, agent: r.userAgent || null },
      change: r.readOnly !== true, // missing readOnly counts as a change
      category: r.eventCategory || null,
      failed: r.errorCode ? { code: r.errorCode, message: r.errorMessage || null } : null,
      targets: targets(r),
      raw: r
    };
    e.node = e.id ? DERIVED + "event/cloudtrail/" + e.id : null; // the event's own graph node id
    e.words = words(e);
    return e;
  }

  // Accepts: { Records: [...] } (S3 delivery), { Events: [{ CloudTrailEvent: "<json>" }] } (LookupEvents, *to check*),
  // a bare array of records, or a string of one record per line. Returns { events, skipped, format }.
  function read(input) {
    var records = [], format = null;
    if (typeof input === "string") {
      format = "lines";
      input.split(/\r?\n/).forEach(function (l) { if (l.trim()) records.push(JSON.parse(l)); });
    } else if (input && Array.isArray(input.Records)) { format = "records"; records = input.Records; }
    else if (input && Array.isArray(input.Events)) { format = "lookup-events"; records = input.Events.map(function (x) { return typeof x.CloudTrailEvent === "string" ? JSON.parse(x.CloudTrailEvent) : null; }); }
    else if (Array.isArray(input)) { format = "array"; records = input; }
    else return { events: [], skipped: 0, format: null };
    var seen = {}, events = [], skipped = 0;
    records.forEach(function (r) {
      if (!r || typeof r !== "object" || !r.eventName) { skipped++; return; }
      if (r.eventID) { if (seen[r.eventID]) { skipped++; return; } seen[r.eventID] = 1; }
      events.push(normalise(r));
    });
    events.sort(function (a, b) { return (b.time || 0) - (a.time || 0); }); // newest first
    return { events: events, skipped: skipped, format: format };
  }

  // Merge several reads (several files), dropping duplicates across them, newest first.
  function merge(reads) {
    var seen = {}, out = [], skipped = 0;
    reads.forEach(function (rd) { skipped += rd.skipped; rd.events.forEach(function (e) { if (e.id && seen[e.id]) { skipped++; return; } if (e.id) seen[e.id] = 1; out.push(e); }); });
    out.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
    return { events: out, skipped: skipped };
  }

  // The event as handed to the graph: everything but raw (kept for the detail panel only, design 03).
  function forGraph(e) { var o = {}; for (var k in e) if (k !== "raw") o[k] = e[k]; return o; }

  root.CloudTrailReader = { read: read, merge: merge, normalise: normalise, forGraph: forGraph };
})(typeof window !== "undefined" ? window : globalThis);
