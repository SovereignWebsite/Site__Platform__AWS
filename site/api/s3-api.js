// S3Api: the S3 browser's calls as plain objects (design 01, docs/architecture/, step 2).
// It speaks the wire (Cloud Control JSON for buckets, S3 REST XML for objects) through one function, send,
// which signs and delivers a request and returns a real Response, from AWS or from the twin alike. S3Api never
// sees credentials and cannot tell which answered: Dinis Cruz, 23 Nov 2026, "the code should not know the
// difference". It only reads; changes stay with plans and Approve.
//
//   var api = S3Api(send);        // send({ service, region, method, url, headers, body }) -> Promise<Response>
//   api.listBuckets()             -> ["name", ...] sorted, every page
//   api.getBucket(name)           -> { name, region, cors }   (cors: the CorsConfiguration, or null)
//   api.listObjects(bucket, region, { prefix, delimiter, token, maxKeys })
//                                 -> { folders: [prefix], files: [{ key, size, modified }], next: token or null }
//   api.getObject(bucket, region, key, [start, end])
//                                 -> { status, contentType, contentRange, bytes: Uint8Array }
//   api.getBucketCors(bucket, region)
//                                 -> { CorsRules: [...] } in getBucket's (Cloud Control) shape, or null if none
//                                    (null is defensive: from a browser, a bucket with no rule for this origin fails
//                                    with TypeError before S3's 404 NoSuchCORSConfiguration is readable; build no UI on it)
//                                    For buckets already reachable from this page, for example to re-check after a
//                                    plan is applied: S3 GetBucketCors needs only s3:GetBucketCORS. It cannot replace
//                                    getBucket, since a bucket with no CORS rule for this site fails in the browser
//                                    before S3 can say so (architect.aws.a and dev.2.aws.a, 23 Nov 2026).
//
// Errors: an Error whose message is "Code: Message" (as Platform.awsError makes), with .code and .status.
// A bucket with no CORS rule for this site fails as the browser fails it (TypeError: Failed to fetch); that
// error passes through unchanged so the page can offer the CORS plan.
(function (root) {
  "use strict";
  // Buckets in every region are listed and read through Cloud Control in us-east-1, as site/s3.js does today;
  // to confirm against AWS's Cloud Control API documentation (not checked live: no agent calls AWS).
  var CC_REGION = "us-east-1";
  function uriEncode(s) { return encodeURIComponent(s).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); }); }

  // ---- a small reader for S3's flat XML (no DOMParser, so it runs in Node too) ----
  function unescape(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e[0] === "#") { var c = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; }
      return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }[e];
    });
  }
  function blocks(xml, tag) { // inner text of every <tag>...</tag>, in order (S3's elements never nest in themselves)
    var out = [], re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g"), m;
    while ((m = re.exec(xml))) out.push(m[1]);
    return out;
  }
  function text(xml, tag) { var b = blocks(xml, tag)[0]; return b === undefined ? "" : unescape(b); }

  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  function xmlError(r) {
    return r.text().then(function (t) { throw fail(text(t, "Code") || "HTTP " + r.status, text(t, "Message") || "no message", r.status); });
  }
  function jsonError(r) {
    return r.text().then(function (t) {
      var j = {}; try { j = JSON.parse(t); } catch (e) { /* not JSON */ }
      var code = String(j.__type || "HTTP " + r.status).split("#").pop();
      throw fail(code, j.message || j.Message || "no message", r.status);
    });
  }

  // Names and regions go into a signed host name: check them first (security R-019).
  var REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/, BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
  function bucketUrl(bucket, region, key, query) {
    if (!BUCKET_RE.test(String(bucket))) throw new TypeError("not an S3 bucket name: " + bucket);
    if (!REGION_RE.test(String(region))) throw new TypeError("not an AWS region: " + region);
    var path = "/" + (key ? key.split("/").map(uriEncode).join("/") : "");
    // Names with dots do not match S3's certificate as a host name: those take the path form.
    if (bucket.indexOf(".") >= 0) return "https://s3." + region + ".amazonaws.com/" + encodeURIComponent(bucket) + path + (query || "");
    return "https://" + bucket + ".s3." + region + ".amazonaws.com" + path + (query || "");
  }

  function S3Api(send) {
    if (typeof send !== "function") throw new TypeError("S3Api needs a send function");

    function cc(target, payload) {
      var url = "https://cloudcontrolapi." + CC_REGION + ".amazonaws.com/";
      return send({ service: "cloudcontrolapi", region: CC_REGION, method: "POST", url: url, body: JSON.stringify(payload),
        headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": "CloudApiService." + target } })
        .then(function (r) { return r.ok ? r.json() : jsonError(r); });
    }
    function s3(region, url, headers) {
      return send({ service: "s3", region: region, method: "GET", url: url, headers: headers || {}, body: "" });
    }

    function listBuckets() {
      var names = [];
      function page(token) {
        var q = { TypeName: "AWS::S3::Bucket", MaxResults: 100 }; if (token) q.NextToken = token;
        return cc("ListResources", q).then(function (j) {
          (j.ResourceDescriptions || []).forEach(function (d) { names.push(d.Identifier); });
          return j.NextToken ? page(j.NextToken) : names.sort();
        });
      }
      return page(null);
    }

    function getBucket(name) {
      return cc("GetResource", { TypeName: "AWS::S3::Bucket", Identifier: name }).then(function (j) {
        var p = JSON.parse((j.ResourceDescription && j.ResourceDescription.Properties) || "{}");
        var m = /\.s3\.([a-z0-9-]+)\.amazonaws\.com$/.exec(p.RegionalDomainName || "");
        // No RegionalDomainName: fall back to us-east-1, S3's default region.
        return { name: name, region: m ? m[1] : CC_REGION, cors: p.CorsConfiguration || null };
      });
    }

    function listObjects(bucket, region, opts) {
      try { bucketUrl(bucket, region, "", ""); } catch (e) { return Promise.reject(e); }
      opts = opts || {};
      var q = "?list-type=2", delim = opts.delimiter === undefined ? "/" : opts.delimiter;
      if (delim) q += "&delimiter=" + encodeURIComponent(delim);
      q += "&max-keys=" + (opts.maxKeys || 1000);
      if (opts.prefix) q += "&prefix=" + encodeURIComponent(opts.prefix);
      if (opts.token) q += "&continuation-token=" + encodeURIComponent(opts.token);
      return s3(region, bucketUrl(bucket, region, "", q)).then(function (r) {
        if (!r.ok) return xmlError(r);
        return r.text().then(function (t) {
          return {
            folders: blocks(t, "CommonPrefixes").map(function (b) { return text(b, "Prefix"); }),
            files: blocks(t, "Contents").map(function (b) {
              return { key: text(b, "Key"), size: Number(text(b, "Size")), modified: text(b, "LastModified") };
            }),
            next: text(t, "IsTruncated") === "true" ? text(t, "NextContinuationToken") || null : null
          };
        });
      });
    }

    function getObject(bucket, region, key, range) {
      try { bucketUrl(bucket, region, "", ""); } catch (e) { return Promise.reject(e); }
      var h = range ? { range: "bytes=" + range[0] + "-" + range[1] } : {};
      return s3(region, bucketUrl(bucket, region, key), h).then(function (r) {
        if (r.status !== 200 && r.status !== 206) return xmlError(r);
        return r.arrayBuffer().then(function (b) {
          return { status: r.status, contentType: r.headers.get("content-type") || "", contentRange: r.headers.get("content-range"), bytes: new Uint8Array(b) };
        });
      });
    }

    function getBucketCors(bucket, region) {
      try { bucketUrl(bucket, region, "", ""); } catch (e) { return Promise.reject(e); }
      return s3(region, bucketUrl(bucket, region, "", "?cors")).then(function (r) {
        if (r.status === 404) return r.clone().text().then(function (t) { return text(t, "Code") === "NoSuchCORSConfiguration" ? null : xmlError(r); });
        if (!r.ok) return xmlError(r);
        return r.text().then(function (t) {
          return { CorsRules: blocks(t, "CORSRule").map(function (b) {
            var rule = {}, all = function (tag) { return blocks(b, tag).map(unescape); };
            if (text(b, "ID")) rule.Id = text(b, "ID");
            rule.AllowedOrigins = all("AllowedOrigin"); rule.AllowedMethods = all("AllowedMethod");
            if (all("AllowedHeader").length) rule.AllowedHeaders = all("AllowedHeader");
            if (all("ExposeHeader").length) rule.ExposedHeaders = all("ExposeHeader");
            if (text(b, "MaxAgeSeconds")) rule.MaxAge = Number(text(b, "MaxAgeSeconds"));
            return rule;
          }) };
        });
      });
    }

    return { listBuckets: listBuckets, getBucket: getBucket, listObjects: listObjects, getObject: getObject, getBucketCors: getBucketCors };
  }
  S3Api.bucketUrl = bucketUrl;
  root.S3Api = S3Api;
})(typeof window !== "undefined" ? window : globalThis);
