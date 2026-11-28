// Route53Api: Route 53's hosted zone and record reads as plain objects (architect.aws.a design 03, part 1: CfnApi and
// Route53Api adopted from cloudformation.aws.a's sketch), over the same send as S3Api. Global: one endpoint,
// https://route53.amazonaws.com/2013-04-01/..., signing name route53, region us-east-1, REST with XML answers (botocore
// route53 2013-04-01, boto3.aws.a note 20, docs/boto3/2026-11-23__20-route53-reads.md). Reads only: no change batches,
// no health checks, no DNS queries. The SDK's table says Route 53 allows CORS; one browser call confirms it, which only
// aws.c's plan with Dinis's approval may make, so the page uses this on the twin until then.
//
//   var api = Route53Api(send, { account });
//   api.zones({ next, max })          -> { items: [zone], next }                     ListHostedZones (Marker, MaxItems)
//   api.zone(id)                      -> zone + { nameServers: [host] }              GetHostedZone
//   api.records(zoneId, { next, max }) -> { items: [record], next }                  ListResourceRecordSets
//   zone   = { id, arn, name, private, comment, recordCount, callerReference }
//   record = { id, zoneId, name, type, setIdentifier, ttl, values: [text], alias: { dnsName, hostedZoneId, evaluateTargetHealth } | null }
//   Route53Api.all = ApiAll (site/api/all.js).
//
// A zone's id is the bare Z... (Route 53 answers "/hostedzone/Z...", and takes the bare id in request paths: note 20);
// its arn is arn:aws:route53:::hostedzone/<id>, the same id CfnApi derives for AWS::Route53::HostedZone, so the graph
// has one node per zone. Records have no ARN in AWS; id is urn:sws:route53-record:<zoneId>/<name>/<type>[/<setIdentifier>]
// (design 03 refinement 3): the name normalised (lower case, no trailing dot, octal escapes decoded), the set identifier
// when there is one, so NS and SOA on a name, an A and AAAA pair, and one name in two zones are distinct records.
// Record paging is not a marker but the triple (StartRecordName, StartRecordType, StartRecordIdentifier); next is that
// triple, opaque to callers. Names keep Route 53's trailing dot; its \ddd octal escapes (such as \052 for *) are decoded.
// Comments, names and values are the owner's text: render as text. Errors: an Error "Code: Message" with .code and
// .status, never quoting the body; a CORS TypeError passes through; answers over 4 MB are refused before parsing, by
// their declared length when they give one.
(function (root) {
  "use strict";
  var BASE = "https://route53.amazonaws.com/2013-04-01", MAX_BODY = 4 * 1024 * 1024, ZONE = /^Z[A-Z0-9]{1,32}$/;
  function unescape(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e[0] === "#") { var c = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; }
      return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }[e];
    });
  }
  // A small XML element tree, linear (indexOf only), as CloudFrontApi's: { name, kids: [node], text }.
  function tree(xml) {
    var top = { name: "", kids: [], text: "" }, stack = [top], i = 0, n = xml.length;
    while (i < n) {
      var lt = xml.indexOf("<", i);
      if (lt < 0) break;
      if (lt > i) stack[stack.length - 1].text += xml.slice(i, lt);
      var gt = xml.indexOf(">", lt);
      if (gt < 0) break;
      var tag = xml.slice(lt + 1, gt);
      i = gt + 1;
      if (tag[0] === "?" || tag[0] === "!") continue;
      if (tag[0] === "/") {
        var name = tag.slice(1).trim();
        if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
        continue;
      }
      var self = tag[tag.length - 1] === "/", nm = (self ? tag.slice(0, -1) : tag).trim().split(/\s/)[0];
      var node = { name: nm, kids: [], text: "" };
      stack[stack.length - 1].kids.push(node);
      if (!self) stack.push(node);
    }
    return top;
  }
  function kid(node, name) { if (!node) return null; for (var i = 0; i < node.kids.length; i++) if (node.kids[i].name === name) return node.kids[i]; return null; }
  function kids(node, name) { return node ? node.kids.filter(function (k) { return k.name === name; }) : []; }
  function txt(node, name) { var k = name ? kid(node, name) : node; return k ? unescape(k.text) : null; }
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  // Route 53 writes some characters in names as \ddd (octal); 0 to 255 only.
  function dnsName(s) { return s === null ? null : s.replace(/\\([0-7]{3})/g, function (m, o) { var c = parseInt(o, 8); return c <= 255 ? String.fromCharCode(c) : m; }); }
  function zoneId(id) {
    var s = String(id === undefined || id === null ? "" : id).replace(/^\/hostedzone\//, "");
    return ZONE.test(s) ? s : null;
  }
  function zoneOf(z) {
    var id = zoneId(txt(z, "Id")), cfg = kid(z, "Config"), count = txt(z, "ResourceRecordSetCount");
    return { id: id, arn: id ? "arn:aws:route53:::hostedzone/" + id : null, name: dnsName(txt(z, "Name")), private: txt(cfg, "PrivateZone") === "true",
      comment: txt(cfg, "Comment") || "", recordCount: count === null ? null : Number(count), callerReference: txt(z, "CallerReference") };
  }
  function normName(n) { return String(n === null || n === undefined ? "" : n).toLowerCase().replace(/\.$/, ""); }
  function recordId(zone, name, type, setIdentifier) {
    var z = zoneId(zone), n = normName(name), t = String(type === null || type === undefined ? "" : type);
    return z && n && /^[A-Z]{1,10}$/.test(t) ? "urn:sws:route53-record:" + z + "/" + n + "/" + t + (setIdentifier ? "/" + setIdentifier : "") : null;
  }
  function maxOf(o) { return o && o.max ? String(Math.min(Math.max(1, o.max | 0), 300)) : null; }

  function Route53Api(send, opts) {
    if (typeof send !== "function") throw new TypeError("Route53Api needs a send function");
    function call(route, q) {
      var s = q ? q.toString() : "";
      return send({ service: "route53", region: "us-east-1", method: "GET", url: BASE + route + (s ? "?" + s : ""), headers: {} }).then(function (r) {
        var declared = Number(r.headers && r.headers.get && r.headers.get("content-length"));
        if (declared > MAX_BODY) return Promise.reject(fail("TooLarge", "the answer is over " + MAX_BODY + " characters; not read", r.status));
        return r.text().then(function (t) {
          if (t.length > MAX_BODY) throw fail("TooLarge", "the answer is over " + MAX_BODY + " characters; not read", r.status);
          var x = tree(t); t = null; // the body is not kept
          if (r.ok) return x;
          var err = kid(kid(x, "ErrorResponse"), "Error") || kid(x, "Error");
          throw fail(txt(err, "Code") || "HTTP " + r.status, txt(err, "Message") || "no message", r.status);
        });
      });
    }
    // ListHostedZones: query names marker and maxitems (the Route 53 API reference's request syntax; botocore's Marker
    // and MaxItems members).
    function zones(o) {
      var q = new URLSearchParams();
      if (o && o.next) q.set("marker", String(o.next));
      if (maxOf(o)) q.set("maxitems", maxOf(o));
      return call("/hostedzone", q).then(function (x) {
        var res = kid(x, "ListHostedZonesResponse");
        return { items: kids(kid(res, "HostedZones"), "HostedZone").map(zoneOf),
          next: txt(res, "IsTruncated") === "true" ? txt(res, "NextMarker") : null };
      });
    }
    function zone(id) {
      var z = zoneId(id);
      if (!z) return Promise.reject(new TypeError("not a Route 53 hosted zone id: " + String(id).slice(0, 80)));
      return call("/hostedzone/" + encodeURIComponent(z)).then(function (x) {
        var res = kid(x, "GetHostedZoneResponse"), out = zoneOf(kid(res, "HostedZone"));
        out.nameServers = kids(kid(kid(res, "DelegationSet"), "NameServers"), "NameServer").map(function (n) { return txt(n); });
        return out;
      });
    }
    // next is the triple [name, type, identifier] as JSON, opaque to callers; anything else is refused before a request.
    function records(id, o) {
      var z = zoneId(id);
      if (!z) return Promise.reject(new TypeError("not a Route 53 hosted zone id: " + String(id).slice(0, 80)));
      var q = new URLSearchParams(), start = null;
      if (o && o.next) {
        try { start = JSON.parse(String(o.next)); } catch (e) { start = null; }
        if (!Array.isArray(start) || start.length !== 3 || typeof start[0] !== "string" || !start[0] || !start.every(function (v) { return v === null || typeof v === "string"; }))
          return Promise.reject(new TypeError("not a records cursor"));
        q.set("name", start[0]); if (start[1]) q.set("type", start[1]); if (start[2]) q.set("identifier", start[2]);
      }
      if (maxOf(o)) q.set("maxitems", maxOf(o));
      return call("/hostedzone/" + encodeURIComponent(z) + "/rrset", q).then(function (x) {
        var res = kid(x, "ListResourceRecordSetsResponse");
        var items = kids(kid(res, "ResourceRecordSets"), "ResourceRecordSet").map(function (r) {
          var at = kid(r, "AliasTarget"), ttl = txt(r, "TTL");
          var nm = dnsName(txt(r, "Name")), sid = txt(r, "SetIdentifier");
          return { id: recordId(z, nm, txt(r, "Type"), sid), zoneId: z, name: nm, type: txt(r, "Type"), setIdentifier: sid, ttl: ttl === null ? null : Number(ttl),
            values: kids(kid(r, "ResourceRecords"), "ResourceRecord").map(function (v) { return txt(v, "Value"); }),
            alias: at ? { dnsName: dnsName(txt(at, "DNSName")), hostedZoneId: txt(at, "HostedZoneId"), evaluateTargetHealth: txt(at, "EvaluateTargetHealth") === "true" } : null };
        });
        return { items: items, next: txt(res, "IsTruncated") === "true" ? JSON.stringify([txt(res, "NextRecordName"), txt(res, "NextRecordType"), txt(res, "NextRecordIdentifier")]) : null };
      });
    }
    return { zones: zones, zone: zone, records: records };
  }
  Route53Api.zoneId = zoneId;
  Route53Api.recordId = recordId;
  Route53Api.normName = normName;
  Route53Api.parts = { tree: tree, kid: kid, kids: kids, txt: txt, fail: fail, zoneId: zoneId, zoneOf: zoneOf };
  Route53Api.all = function (page, opts) { return root.ApiAll(page, opts); };
  root.Route53Api = Route53Api;
})(typeof window !== "undefined" ? window : globalThis);
