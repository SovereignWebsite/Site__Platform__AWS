// AWS Signature Version 4, in the browser, with WebCrypto only. No SDK, no dependency.
// The credentials passed in live in the page's memory and are never stored or sent anywhere
// except as a signature to the AWS endpoint being called.
(function (root) {
  "use strict";
  var enc = new TextEncoder();
  var subtle = (root.crypto || globalThis.crypto).subtle;

  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }
  function sha256(text) { return subtle.digest("SHA-256", enc.encode(text)).then(hex); }
  function hmac(key, text) {
    var k = typeof key === "string" ? enc.encode(key) : key;
    return subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (ck) { return subtle.sign("HMAC", ck, enc.encode(text)); });
  }
  function uriEncode(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }
  function canonicalQuery(search) {
    if (!search) return "";
    return search.replace(/^\?/, "").split("&").filter(Boolean).map(function (p) {
      var i = p.indexOf("=");
      var k = decodeURIComponent((i < 0 ? p : p.slice(0, i)).replace(/\+/g, " "));
      var v = i < 0 ? "" : decodeURIComponent(p.slice(i + 1).replace(/\+/g, " "));
      return [uriEncode(k), uriEncode(v)];
    }).sort(function (a, b) {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    }).map(function (kv) { return kv[0] + "=" + kv[1]; }).join("&");
  }

  // req: { method, url, headers: {}, body: string }; creds: { accessKeyId, secretAccessKey, sessionToken }
  // Returns the headers to send (including Authorization). amzDate is for tests only.
  function sign(req, creds, region, service, amzDate) {
    var u = new URL(req.url);
    var date = amzDate || new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    var day = date.slice(0, 8);
    var headers = {};
    Object.keys(req.headers || {}).forEach(function (k) { headers[k.toLowerCase()] = String(req.headers[k]).trim(); });
    headers.host = u.host;
    headers["x-amz-date"] = date;
    if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;
    var names = Object.keys(headers).sort();
    var canonHeaders = names.map(function (n) { return n + ":" + headers[n].replace(/\s+/g, " ") + "\n"; }).join("");
    var signed = names.join(";");
    var scope = day + "/" + region + "/" + service + "/aws4_request";
    return sha256(req.body || "").then(function (bodyHash) {
      var path = u.pathname.split("/").map(function (s) { return uriEncode(decodeURIComponent(s)); }).join("/") || "/";
      var canon = [req.method, path, canonicalQuery(u.search), canonHeaders, signed, bodyHash].join("\n");
      return sha256(canon);
    }).then(function (canonHash) {
      var toSign = ["AWS4-HMAC-SHA256", date, scope, canonHash].join("\n");
      return hmac("AWS4" + creds.secretAccessKey, day)
        .then(function (k) { return hmac(k, region); })
        .then(function (k) { return hmac(k, service); })
        .then(function (k) { return hmac(k, "aws4_request"); })
        .then(function (k) { return hmac(k, toSign); })
        .then(function (sig) {
          var out = {};
          names.forEach(function (n) { if (n !== "host") out[n] = headers[n]; });
          out.authorization = "AWS4-HMAC-SHA256 Credential=" + creds.accessKeyId + "/" + scope +
            ", SignedHeaders=" + signed + ", Signature=" + hex(sig);
          return out;
        });
    });
  }

  root.SigV4 = { sign: sign };
})(typeof window !== "undefined" ? window : globalThis);
