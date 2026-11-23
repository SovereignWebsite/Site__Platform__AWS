// LambdaApi: Lambda's read calls as plain objects (design 03, part 1), over the same send as S3Api: REST JSON,
// API version 2015-03-31. Reads only; never sees credentials; cannot tell AWS from the twin.
//
//   var api = LambdaApi(send);
//   api.functions(region, { next, max })  -> { items: [fn], next }   ListFunctions, one page (Marker / NextMarker)
//   api.function(region, name)            -> fn                      GetFunctionConfiguration (name or ARN)
//   fn = { name, arn, region, runtime, handler, role, description, memory, timeout, codeSize, codeSha256, modified,
//          version, state, packageType, architectures }   (role is the execution role's ARN; values as AWS gives them)
//   LambdaApi.all = ApiAll (site/api/all.js), to drain functions() with a cap.
//
// Errors: an Error whose message is "Code: Message", with .code and .status (code from x-amzn-errortype or the
// body); a CORS TypeError passes through unchanged.
(function (root) {
  "use strict";
  var REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  function shape(f, region) {
    var r = /^arn:aws:lambda:([a-z0-9-]+):/.exec(f.FunctionArn || "");
    return { name: f.FunctionName, arn: f.FunctionArn, region: r ? r[1] : region, runtime: f.Runtime || null, handler: f.Handler || null,
      role: f.Role || null, description: f.Description || "", memory: f.MemorySize, timeout: f.Timeout, codeSize: f.CodeSize,
      codeSha256: f.CodeSha256 || null, modified: f.LastModified || null, version: f.Version || null, state: f.State || null,
      packageType: f.PackageType || null, architectures: f.Architectures || [] };
  }
  function LambdaApi(send) {
    if (typeof send !== "function") throw new TypeError("LambdaApi needs a send function");
    function get(region, path) {
      if (!REGION_RE.test(String(region))) return Promise.reject(new TypeError("not an AWS region: " + region)); // it goes into a signed host name
      var url = "https://lambda." + region + ".amazonaws.com" + path;
      return send({ service: "lambda", region: region, method: "GET", url: url, headers: {}, body: "" }).then(function (r) {
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          var j = {}; try { j = JSON.parse(t); } catch (e) { /* not JSON */ }
          var code = String(r.headers.get("x-amzn-errortype") || j.__type || j.Type || "HTTP " + r.status).split(":")[0].split("#").pop();
          throw fail(code, j.Message || j.message || "no message", r.status);
        });
      });
    }
    function functions(region, opts) {
      opts = opts || {};
      var q = [];
      if (opts.next) q.push("Marker=" + encodeURIComponent(opts.next));
      if (opts.max) q.push("MaxItems=" + Math.min(Math.max(1, opts.max | 0), 50));
      return get(region, "/2015-03-31/functions/" + (q.length ? "?" + q.join("&") : "")).then(function (j) {
        return { items: (j.Functions || []).map(function (f) { return shape(f, region); }), next: j.NextMarker || null };
      });
    }
    function fn(region, name) {
      return get(region, "/2015-03-31/functions/" + encodeURIComponent(name) + "/configuration").then(function (f) { return shape(f, region); });
    }
    return { functions: functions, "function": fn };
  }
  LambdaApi.all = function (page, opts) { return root.ApiAll(page, opts); };
  root.LambdaApi = LambdaApi;
})(typeof window !== "undefined" ? window : globalThis);
