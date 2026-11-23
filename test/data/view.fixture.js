// Runs the log view on the twin's CloudFront-logs bucket, as the S3 browser would. Twin only: no network.
// Investigation context: the demo site's keys and vaults list, read from the twin as the page would.
(function () {
  var T = window.AwsTwin, auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
  var logs = "https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/", site = "https://" + T.buckets.site + ".s3.eu-west-2.amazonaws.com/";
  function get(base, q) { return T.handle(base + q, { method: "GET", headers: auth }); }
  function keysOf(x) {
    var doc = new DOMParser().parseFromString(x, "application/xml");
    return Array.prototype.map.call(doc.getElementsByTagName("Contents"), function (c) {
      return { Key: c.getElementsByTagName("Key")[0].textContent, Size: +c.getElementsByTagName("Size")[0].textContent };
    });
  }
  // the demo site has no CORS rule for the page until the plan adds it: add it as the page's plan would
  var cors = T.handle("https://cloudcontrolapi.eu-west-2.amazonaws.com/", { method: "POST", headers: Object.assign({ "x-amz-target": "CloudApiService.UpdateResource" }, auth),
    body: JSON.stringify({ TypeName: "AWS::S3::Bucket", Identifier: T.buckets.site, PatchDocument: JSON.stringify([{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [{ Id: "sws-aws-platform", AllowedOrigins: [location.origin === "null" ? "http://localhost" : location.origin] }] } }]) }) });
  var context = { siteBucket: T.buckets.site, logsBucket: T.buckets.logs, siteKeys: [], vaults: [] };
  window.opened = [];
  // every page of the listing (the demo site holds more than 1,000 keys)
  function listAll(base, q, acc, token) {
    return get(base, q + (token ? "&continuation-token=" + encodeURIComponent(token) : "")).then(function (r) { return r.text(); }).then(function (x) {
      acc = acc.concat(keysOf(x));
      var m = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(x);
      return m ? listAll(base, q, acc, m[1]) : acc;
    });
  }
  cors.then(function () { return listAll(site, "?list-type=2", []); }).then(function (all) {
    context.siteKeys = all.map(function (o) { return o.Key; });
    return get(site, "data/vaults.json").then(function (r) { return r.json(); }).then(function (j) { context.vaults = j.vaults; });
  }).catch(function (e) { window.contextError = String(e); })
    .then(function () { return get(logs, "?list-type=2&prefix=cloudfront%2F"); }).then(function (r) { return r.text(); }).then(function (x) {
      return LogView.run(document.getElementById("box"), keysOf(x), function (key) {
        return get(logs, key).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });
      }, { context: context, open: function (ref) { window.opened.push({ bucket: ref.bucket, key: ref.key, line: ref.line || null }); } });
    }).then(function (res) {
      var v = res.summary.vaults.filter(function (x) { return x.key === "vault-demo-001"; })[0];
      window.viewResult = { requests: res.summary.requests, vault1: v ? v.requests : 0, siteKeys: context.siteKeys.length };
    });
})();
