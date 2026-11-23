// Runs the log view on the twin's CloudFront-logs bucket, as the S3 browser would. Twin only: no network.
(function () {
  var T = window.AwsTwin, auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
  var base = "https://" + T.buckets.logs + ".s3.eu-west-2.amazonaws.com/";
  function get(q) { return T.handle(base + q, { method: "GET", headers: auth }); }
  get("?list-type=2&prefix=cloudfront%2F").then(function (r) { return r.text(); }).then(function (x) {
    var doc = new DOMParser().parseFromString(x, "application/xml");
    var objects = Array.prototype.map.call(doc.getElementsByTagName("Contents"), function (c) {
      return { Key: c.getElementsByTagName("Key")[0].textContent, Size: +c.getElementsByTagName("Size")[0].textContent };
    });
    return LogView.run(document.getElementById("box"), objects, function (key) {
      return get(key).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });
    });
  }).then(function (res) {
    var v = res.summary.vaults.filter(function (x) { return x.key === "vault-demo-001"; })[0];
    window.viewResult = { requests: res.summary.requests, vault1: v ? v.requests : 0 };
  });
})();
