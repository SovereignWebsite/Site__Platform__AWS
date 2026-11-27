// CloudFrontApi: CloudFront's distribution and function reads as plain objects (architect.aws.a design 06; design 03,
// part 1), over the same send as S3Api. Global: https://cloudfront.amazonaws.com/2020-05-31/..., signing name
// cloudfront, region us-east-1, REST with XML answers, paged by Marker and MaxItems (botocore cloudfront 2020-05-31,
// read by boto3.aws.a and here). Reads only: no config writes, no invalidations, and no function code (DescribeFunction
// and GetFunction are not called). CORS on the real endpoint is not known yet, so the page uses this on the twin only
// until aws.c checks it with Dinis's approval (design 06, section 2).
//
//   var api = CloudFrontApi(send, { account });
//   api.distributions({ next, max })   -> { items: [distribution], next }          ListDistributions
//   api.distribution(id)               -> distribution + { logging, defaultRoot }   GetDistribution
//   api.functions({ next, max, stage }) -> { items: [fn], next }                    ListFunctions (stage DEVELOPMENT | LIVE)
//   distribution = { id, arn, domain, aliases: [host], enabled, status, priceClass, comment, lastModified,
//                    origins: [origin], functions: [{ arn, event, behaviour }] }
//   origin       = { id, domain, kind: "s3" | "s3-website" | "lambda-url" | "custom", target, path, oac, customHeaders: [name] }
//   fn           = { name, arn, runtime, stage, status, lastModified }
//   logging      = { bucket, prefix } when legacy standard logging is on, else null
//   CloudFrontApi.all = ApiAll (site/api/all.js).
//
// origin.kind and target are decided here, so every view shows the same: <bucket>.s3[.<region>].amazonaws.com is s3 and
// <bucket>.s3-website[-.]<region>.amazonaws.com is s3-website, both with the bucket's ARN as target; <id>.lambda-url.
// <region>.on.aws is lambda-url with no target (a Function URL id does not name its function); anything else is custom
// with no target, its domain only text, never fetched. Origin custom headers: names only. Their values are often a secret
// shared with the origin, so the XML reader discards every HeaderValue's text as it parses, before any node, output,
// error or log can hold it, and the raw body is not kept (iam.aws.a, security.aws.a). Comment and aliases are the
// owner's text: render as text. functions are the default behaviour's (behaviour "*") and each cache behaviour's
// (its path pattern) function associations. Errors: an Error "Code: Message" with .code and .status, never quoting the
// body; a CORS TypeError passes through; answers over 4 MB are refused before parsing.
(function (root) {
  "use strict";
  var BASE = "https://cloudfront.amazonaws.com/2020-05-31", MAX_BODY = 4 * 1024 * 1024;
  var DROP = { HeaderValue: true }; // elements whose text is never kept
  function unescape(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e[0] === "#") { var c = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; }
      return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }[e];
    });
  }
  // A small XML element tree, linear (indexOf only): { name, kids: [node], text }. Attributes, comments, processing
  // instructions and CDATA are skipped (CloudFront's answers use none that matter). Text of DROP elements is discarded.
  function tree(xml) {
    var top = { name: "", kids: [], text: "" }, stack = [top], i = 0, n = xml.length;
    while (i < n) {
      var lt = xml.indexOf("<", i);
      if (lt < 0) break;
      if (lt > i) { var cur = stack[stack.length - 1]; if (!DROP[cur.name]) cur.text += xml.slice(i, lt); }
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
  function path(node) { for (var i = 1; i < arguments.length && node; i++) node = kid(node, arguments[i]); return node; }
  function txt(node, name) { var k = name ? kid(node, name) : node; return k ? unescape(k.text) : null; }
  function items(node, name) { var it = kid(node, "Items"); return it ? it.kids.filter(function (k) { return k.name === name; }) : []; }
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }

  var BUCKET = "[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]";
  var S3_WEB = new RegExp("^(" + BUCKET + ")\\.s3-website[-.][a-z0-9-]+\\.amazonaws\\.com$");
  var S3_REST = new RegExp("^(" + BUCKET + ")\\.s3(\\.[a-z0-9-]+)?\\.amazonaws\\.com$");
  // The legacy dashed regional REST host, <bucket>.s3-<region>.amazonaws.com, still on older distributions (architect.aws.a);
  // checked after the website forms, so s3-website-<region> is never read as it. Dualstack stays custom.
  var S3_DASHED = new RegExp("^(" + BUCKET + ")\\.s3-[a-z]{2}(-[a-z]+)+-\\d\\.amazonaws\\.com$");
  var LAMBDA_URL = /^[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws$/;
  // partition: the distribution's own ARN's (aws, aws-cn, aws-us-gov), so a bucket's ARN is in the same partition.
  function kind(domain, partition) {
    var d = String(domain || "").toLowerCase(), m, arn = "arn:" + (/^aws(-[a-z-]+)?$/.test(partition || "") ? partition : "aws") + ":s3:::";
    if ((m = S3_WEB.exec(d))) return { kind: "s3-website", target: arn + m[1] };
    if ((m = S3_REST.exec(d)) || (m = S3_DASHED.exec(d))) return { kind: "s3", target: arn + m[1] };
    if (LAMBDA_URL.test(d)) return { kind: "lambda-url", target: null };
    return { kind: "custom", target: null };
  }
  function associations(behaviour, pattern) {
    return items(kid(behaviour, "FunctionAssociations"), "FunctionAssociation").map(function (a) {
      return { arn: txt(a, "FunctionARN"), event: txt(a, "EventType"), behaviour: pattern };
    });
  }
  // From a DistributionSummary or a DistributionConfig (with the Distribution's own fields passed as top).
  function distributionOf(cfg, top) {
    top = top || cfg;
    var partition = (/^arn:(aws[a-z-]*):cloudfront:/.exec(txt(top, "ARN") || "") || [])[1];
    var fns = associations(kid(cfg, "DefaultCacheBehavior"), "*");
    items(kid(cfg, "CacheBehaviors"), "CacheBehavior").forEach(function (b) { fns = fns.concat(associations(b, txt(b, "PathPattern"))); });
    return { id: txt(top, "Id"), arn: txt(top, "ARN"), domain: txt(top, "DomainName"),
      aliases: items(kid(cfg, "Aliases"), "CNAME").map(function (c) { return txt(c); }),
      enabled: txt(cfg, "Enabled") === "true", status: txt(top, "Status"), priceClass: txt(cfg, "PriceClass"), comment: txt(cfg, "Comment") || "",
      lastModified: txt(top, "LastModifiedTime"),
      origins: items(kid(cfg, "Origins"), "Origin").map(function (o) {
        var d = txt(o, "DomainName"), k = kind(d, partition);
        return { id: txt(o, "Id"), domain: d, kind: k.kind, target: k.target, path: txt(o, "OriginPath") || "", oac: txt(o, "OriginAccessControlId") || null,
          customHeaders: items(kid(o, "CustomHeaders"), "OriginCustomHeader").map(function (h) { return txt(h, "HeaderName"); }) };
      }),
      functions: fns };
  }

  function CloudFrontApi(send, opts) {
    if (typeof send !== "function") throw new TypeError("CloudFrontApi needs a send function");
    function call(route) {
      return send({ service: "cloudfront", region: "us-east-1", method: "GET", url: BASE + route, headers: {} }).then(function (r) {
        // Refused by its declared length before the body is read, when the answer says it (security.aws.a); else after.
        var declared = Number(r.headers && r.headers.get && r.headers.get("content-length"));
        if (declared > MAX_BODY) return Promise.reject(fail("TooLarge", "the answer is over " + MAX_BODY + " characters; not read", r.status));
        return r.text().then(function (t) {
          if (t.length > MAX_BODY) throw fail("TooLarge", "the answer is over " + MAX_BODY + " characters; not read", r.status);
          var x = tree(t); t = null; // the body is not kept
          if (r.ok) return x;
          var err = path(x, "ErrorResponse", "Error") || kid(x, "Error");
          throw fail(txt(err, "Code") || "HTTP " + r.status, txt(err, "Message") || "no message", r.status);
        });
      });
    }
    function query(o, extra) {
      var q = new URLSearchParams();
      if (o && o.next) q.set("Marker", String(o.next));
      if (o && o.max) q.set("MaxItems", String(Math.min(Math.max(1, o.max | 0), 1000)));
      Object.keys(extra || {}).forEach(function (k) { if (extra[k]) q.set(k, extra[k]); });
      var s = q.toString();
      return s ? "?" + s : "";
    }
    function distributions(o) {
      return call("/distribution" + query(o)).then(function (x) {
        var list = kid(x, "DistributionList");
        return { items: items(list, "DistributionSummary").map(function (s) { return distributionOf(s); }),
          next: txt(list, "IsTruncated") === "true" ? txt(list, "NextMarker") : null };
      });
    }
    function distribution(id) {
      var s = String(id === undefined || id === null ? "" : id);
      if (!/^[A-Z0-9]{1,64}$/.test(s)) return Promise.reject(new TypeError("not a CloudFront distribution id: " + s.slice(0, 80)));
      return call("/distribution/" + encodeURIComponent(s)).then(function (x) {
        var d = kid(x, "Distribution"), cfg = kid(d, "DistributionConfig"), out = distributionOf(cfg, d), log = kid(cfg, "Logging");
        out.logging = log && txt(log, "Enabled") === "true" ? { bucket: txt(log, "Bucket"), prefix: txt(log, "Prefix") || "" } : null;
        out.defaultRoot = txt(cfg, "DefaultRootObject") || null;
        return out;
      });
    }
    function functions(o) {
      o = o || {};
      if (o.stage !== undefined && o.stage !== "DEVELOPMENT" && o.stage !== "LIVE") return Promise.reject(new TypeError("stage is DEVELOPMENT or LIVE"));
      return call("/function" + query(o, { Stage: o.stage })).then(function (x) {
        var list = kid(x, "FunctionList");
        return { items: items(list, "FunctionSummary").map(function (f) {
          var md = kid(f, "FunctionMetadata");
          return { name: txt(f, "Name"), arn: txt(md, "FunctionARN"), runtime: txt(kid(f, "FunctionConfig"), "Runtime"), stage: txt(md, "Stage"),
            status: txt(f, "Status"), lastModified: txt(md, "LastModifiedTime") };
        }), next: txt(list, "NextMarker") || null }; // FunctionList has no IsTruncated: NextMarker alone pages it
      });
    }
    return { distributions: distributions, distribution: distribution, functions: functions };
  }
  CloudFrontApi.originKind = kind;
  CloudFrontApi.all = function (page, opts) { return root.ApiAll(page, opts); };
  root.CloudFrontApi = CloudFrontApi;
})(typeof window !== "undefined" ? window : globalThis);
