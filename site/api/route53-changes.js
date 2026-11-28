// Route53Changes: the Route 53 changes this site may make, kept apart from Route53Api (which only reads, and from which
// the command line is generated). Dinis Cruz, 28 Nov 2026: create a hosted zone; add, change and delete NS, A, CNAME and
// TXT records, from this UI. Template v2.2's change role allows exactly these (route53:ChangeResourceRecordSetsRecordTypes
// and ...Actions conditions); the page shows each change as a plan first and calls these only on Approve.
//
//   var api = Route53Changes(send);   // send signs with the change role
//   api.createZone(name, { comment, callerReference }) -> { zone, change: { id, status }, nameServers }   CreateHostedZone
//   api.changeRecords(zoneId, [{ action, record: { name, type, ttl, values } }], comment) -> { id, status }   ChangeResourceRecordSets
//   api.change(id) -> { id, status, submitted }   GetChange: PENDING, then INSYNC once every Route 53 server has it
//   Route53Changes.checkChange(change) -> true if the page may send it (type, action, name, TTL and values)
(function (root) {
  "use strict";
  var BASE = "https://route53.amazonaws.com/2013-04-01", MAX_BODY = 1024 * 1024;
  var P = root.Route53Api.parts, kid = P.kid, kids = P.kids, txt = P.txt, fail = P.fail, zoneId = P.zoneId, zoneOf = P.zoneOf;
  // What the page may change: these four types, these three actions, a name, a TTL of 0 to 2147483647, and values that fit
  // the type (A: IPv4 addresses; CNAME: exactly one host name; NS: host names; TXT: quoted strings of up to 255 characters).
  var DOMAIN = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  var HOST = /^([a-z0-9_*]([a-z0-9_-]{0,61}[a-z0-9])?\.)*[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.?$/i;
  var TYPES = { A: function (v) { return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v); },
    CNAME: function (v, all) { return all.length === 1 && HOST.test(v); }, NS: function (v) { return HOST.test(v); },
    TXT: function (v) { return /^"([^"\\]|\\.){0,255}"( "([^"\\]|\\.){0,255}")*$/.test(v); } };
  function checkChange(c) {
    var r = c && c.record;
    if (!r || ["CREATE", "UPSERT", "DELETE"].indexOf(c.action) < 0 || !TYPES[r.type]) return false;
    if (!HOST.test(String(r.name || "")) || !(r.ttl >= 0 && r.ttl <= 2147483647) || !Array.isArray(r.values) || !r.values.length || r.values.length > 100) return false;
    return r.values.every(function (v) { return typeof v === "string" && TYPES[r.type](v, r.values); });
  }
  function xesc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  Route53Api.checkChange = checkChange;
  Route53Api.TYPES = Object.keys(TYPES);

  function Route53Changes(send) {
    if (typeof send !== "function") throw new TypeError("Route53Changes needs a send function");
    function call(route, method, body) {
      var req = { service: "route53", region: "us-east-1", method: method, url: BASE + route, headers: {} };
      if (body) { req.body = body; req.headers["content-type"] = "application/xml"; }
      return send(req).then(function (r) {
        return r.text().then(function (t) {
          if (t.length > MAX_BODY) throw fail("TooLarge", "the answer is over " + MAX_BODY + " characters; not read", r.status);
          var x = P.tree(t);
          if (r.ok) return x;
          var err = kid(kid(x, "ErrorResponse"), "Error") || kid(x, "Error");
          throw fail(txt(err, "Code") || "HTTP " + r.status, txt(err, "Message") || "no message", r.status);
        });
      });
    }
    // Dinis Cruz, 28 Nov 2026: create a hosted zone, and add, change and delete NS, A, CNAME and TXT records. Template
    // v2.2's change role allows exactly these (route53:ChangeResourceRecordSetsRecordTypes and ...Actions conditions).
    //   api.createZone(name, { comment, callerReference }) -> { zone, change: { id, status }, nameServers }   CreateHostedZone
    //   api.changeRecords(zoneId, [{ action, record: { name, type, ttl, values } }], comment) -> { id, status }   ChangeResourceRecordSets
    //   api.change(id) -> { id, status, submitted }   GetChange: status PENDING, then INSYNC once every Route 53 server has it
    function changeInfo(c) { return { id: String(txt(c, "Id") || "").replace(/^\/change\//, ""), status: txt(c, "Status"), submitted: txt(c, "SubmittedAt") }; }
    function createZone(name, o) {
      o = o || {};
      var n = String(name || "").trim().toLowerCase().replace(/\.$/, "");
      if (!DOMAIN.test(n)) return Promise.reject(new TypeError("not a domain name: " + String(name).slice(0, 80)));
      var ref = o.callerReference || ("sws-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8));
      var body = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><CreateHostedZoneRequest xmlns=\"https://route53.amazonaws.com/doc/2013-04-01/\"><Name>" + xesc(n + ".") +
        "</Name><CallerReference>" + xesc(ref) + "</CallerReference><HostedZoneConfig><Comment>" + xesc(String(o.comment || "").slice(0, 256)) + "</Comment><PrivateZone>false</PrivateZone></HostedZoneConfig></CreateHostedZoneRequest>";
      return call("/hostedzone", "POST", body).then(function (x) {
        var res = kid(x, "CreateHostedZoneResponse");
        return { zone: zoneOf(kid(res, "HostedZone")), change: changeInfo(kid(res, "ChangeInfo")),
          nameServers: kids(kid(kid(res, "DelegationSet"), "NameServers"), "NameServer").map(function (k) { return txt(k); }) };
      });
    }
    function changeRecords(id, changes, comment) {
      var z = zoneId(id);
      if (!z) return Promise.reject(new TypeError("not a Route 53 hosted zone id: " + String(id).slice(0, 80)));
      var bad = (changes || []).filter(function (c) { return !checkChange(c); });
      if (!changes || !changes.length || bad.length) return Promise.reject(new TypeError("a change is not valid: " + (bad.length ? JSON.stringify(bad[0]).slice(0, 120) : "none given")));
      var xml = changes.map(function (c) {
        var r = c.record;
        return "<Change><Action>" + c.action + "</Action><ResourceRecordSet><Name>" + xesc(r.name) + "</Name><Type>" + r.type + "</Type><TTL>" + (r.ttl | 0) +
          "</TTL><ResourceRecords>" + r.values.map(function (v) { return "<ResourceRecord><Value>" + xesc(v) + "</Value></ResourceRecord>"; }).join("") + "</ResourceRecords></ResourceRecordSet></Change>";
      }).join("");
      var body = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><ChangeResourceRecordSetsRequest xmlns=\"https://route53.amazonaws.com/doc/2013-04-01/\"><ChangeBatch>" +
        (comment ? "<Comment>" + xesc(String(comment).slice(0, 256)) + "</Comment>" : "") + "<Changes>" + xml + "</Changes></ChangeBatch></ChangeResourceRecordSetsRequest>";
      return call("/hostedzone/" + encodeURIComponent(z) + "/rrset/", "POST", body).then(function (x) { return changeInfo(kid(kid(x, "ChangeResourceRecordSetsResponse"), "ChangeInfo")); });
    }
    function change(id) {
      var c = String(id || "").replace(/^\/change\//, "");
      if (!/^[A-Z0-9]{1,32}$/.test(c)) return Promise.reject(new TypeError("not a Route 53 change id"));
      return call("/change/" + encodeURIComponent(c), "GET").then(function (x) { return changeInfo(kid(kid(x, "GetChangeResponse"), "ChangeInfo")); });
    }
    return { createZone: createZone, changeRecords: changeRecords, change: change };
  }
  Route53Changes.checkChange = checkChange;
  Route53Changes.TYPES = Object.keys(TYPES);
  root.Route53Changes = Route53Changes;
})(typeof window !== "undefined" ? window : globalThis);
