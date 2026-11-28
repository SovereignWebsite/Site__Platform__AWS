// CloudTrailApi: CloudTrail's event history (LookupEvents) as plain objects, over the same send as the other APIs.
// Regional: cloudtrail.<region>.amazonaws.com, JSON 1.1, X-Amz-Target com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.
// LookupEvents returns the last 90 days of management events in one region (IAM and other global services are recorded
// in us-east-1); data events such as S3 object reads are never in it. Reads only; never sees credentials.
//
//   var api = CloudTrailApi(send);
//   api.events(region, { attribute: { key, value }, start, end, next, max }) -> { items: [event], next }
//   event = { id, name, source, time (ISO), readOnly, username, accessKeyId, role, actor, region, resources, record }
//     record: the full CloudTrail record (parsed); role: the assumed role's name, if any; actor: who, in a few words
// key is one of Username, EventName, EventSource, ReadOnly, ResourceType, ResourceName, EventId, AccessKeyId.
(function (root) {
  "use strict";
  var TARGET = "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents";
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  function secs(t) { return typeof t === "number" ? Math.floor(t / 1000) : Math.floor(Date.parse(t) / 1000); }
  function shape(e, region) {
    var rec = {}; try { rec = JSON.parse(e.CloudTrailEvent || "{}"); } catch (x) { rec = {}; }
    var ui = rec.userIdentity || {}, issuer = (ui.sessionContext && ui.sessionContext.sessionIssuer) || {};
    var role = ui.type === "AssumedRole" ? (issuer.userName || String(ui.arn || "").split("/")[1] || null) : null;
    var actor = role ? "role " + role : ui.type === "WebIdentityUser" ? "Google sign-in" : ui.type === "Root" ? "the account root" : ui.type === "IAMUser" ? "user " + (ui.userName || "") : ui.type === "AWSService" ? (ui.invokedBy || "an AWS service") : (ui.type || e.Username || "unknown");
    return { id: e.EventId, name: e.EventName, source: e.EventSource, time: new Date(e.EventTime * 1000).toISOString(), readOnly: String(e.ReadOnly) === "true",
      username: e.Username || null, accessKeyId: e.AccessKeyId || null, role: role, actor: actor, region: rec.awsRegion || region,
      resources: (e.Resources || []).map(function (r) { return { type: r.ResourceType, name: r.ResourceName }; }), record: rec };
  }
  function CloudTrailApi(send) {
    if (typeof send !== "function") throw new TypeError("CloudTrailApi needs a send function");
    function events(region, o) {
      o = o || {};
      var q = { MaxResults: Math.min(Math.max(o.max || 50, 1), 50) };
      if (o.attribute) q.LookupAttributes = [{ AttributeKey: o.attribute.key, AttributeValue: String(o.attribute.value) }];
      if (o.start !== undefined) q.StartTime = secs(o.start);
      if (o.end !== undefined) q.EndTime = secs(o.end);
      if (o.next) q.NextToken = o.next;
      return send({ service: "cloudtrail", region: region, method: "POST", url: "https://cloudtrail." + region + ".amazonaws.com/", body: JSON.stringify(q),
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": TARGET } }).then(function (r) {
        return r.text().then(function (t) {
          var j = {}; try { j = JSON.parse(t || "{}"); } catch (x) { j = {}; }
          if (!r.ok) throw fail(String(j.__type || "HTTP " + r.status).split("#").pop(), j.message || j.Message || "no message", r.status);
          return { items: (j.Events || []).map(function (e) { return shape(e, region); }), next: j.NextToken || null };
        });
      });
    }
    return { events: events };
  }
  root.CloudTrailApi = CloudTrailApi;
})(typeof window !== "undefined" ? window : globalThis);
