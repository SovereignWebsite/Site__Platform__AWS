// FirehoseApi: Amazon Data Firehose's read calls as plain objects (design 03, part 1), over the same send as
// S3Api: JSON 1.1, target prefix Firehose_20150804. Reads only; never sees credentials; cannot tell AWS from the twin.
//
//   var api = FirehoseApi(send, { account });
//   api.streams(region, { next, max })  -> { items: [{ name, region, arn, arnDerived }], next }   ListDeliveryStreams
//   api.stream(region, name)            -> stream                                             DescribeDeliveryStream
//   stream = { name, arn, region, status, type, created, destinations: [{ id, kind: "s3", bucket, bucketArn, prefix,
//              errorPrefix, roleArn, compression, bufferSeconds, bufferMb, processors: [{ type, lambdaArn }] }] }
//   FirehoseApi.all = ApiAll (site/api/all.js), to drain streams() with a cap.
//
// ListDeliveryStreams gives names only: with the account known, each item's ARN is derived and marked arnDerived
// (design 03, refinement 1), and stream() returns AWS's own. next is the last name of the page (opaque to callers).
// Errors: an Error whose message is "Code: Message", with .code and .status; a CORS TypeError passes through.
(function (root) {
  "use strict";
  var REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  function FirehoseApi(send, opts) {
    if (typeof send !== "function") throw new TypeError("FirehoseApi needs a send function");
    var account = opts && opts.account;
    function call(region, target, payload) {
      if (!REGION_RE.test(String(region))) return Promise.reject(new TypeError("not an AWS region: " + region)); // it goes into a signed host name
      var url = "https://firehose." + region + ".amazonaws.com/";
      return send({ service: "firehose", region: region, method: "POST", url: url, body: JSON.stringify(payload),
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "Firehose_20150804." + target } }).then(function (r) {
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          var j = {}; try { j = JSON.parse(t); } catch (e) { /* not JSON */ }
          throw fail(String(j.__type || "HTTP " + r.status).split("#").pop(), j.message || j.Message || "no message", r.status);
        });
      });
    }
    function streams(region, o) {
      o = o || {};
      var q = { Limit: Math.min(Math.max(1, (o.max || 100) | 0), 10000) };
      if (o.next) q.ExclusiveStartDeliveryStreamName = o.next;
      return call(region, "ListDeliveryStreams", q).then(function (j) {
        var names = j.DeliveryStreamNames || [];
        return { items: names.map(function (n) {
            return { name: n, region: region, arn: account ? "arn:aws:firehose:" + region + ":" + account + ":deliverystream/" + n : null, arnDerived: !!account };
          }), next: j.HasMoreDeliveryStreams && names.length ? names[names.length - 1] : null };
      });
    }
    function stream(region, name) {
      return call(region, "DescribeDeliveryStream", { DeliveryStreamName: name }).then(function (j) {
        var d = j.DeliveryStreamDescription || {}, r = /^arn:aws:firehose:([a-z0-9-]+):/.exec(d.DeliveryStreamARN || "");
        return { name: d.DeliveryStreamName, arn: d.DeliveryStreamARN, region: r ? r[1] : region, status: d.DeliveryStreamStatus || null,
          type: d.DeliveryStreamType || null, created: typeof d.CreateTimestamp === "number" ? new Date(d.CreateTimestamp * 1000).toISOString() : d.CreateTimestamp || null,
          destinations: (d.Destinations || []).map(function (x) {
            var s = x.ExtendedS3DestinationDescription || x.S3DestinationDescription;
            if (!s) return { id: x.DestinationId, kind: "other" };
            var pc = s.ProcessingConfiguration;
            return { id: x.DestinationId, kind: "s3", bucketArn: s.BucketARN, bucket: String(s.BucketARN || "").replace(/^arn:aws:s3:::/, ""),
              prefix: s.Prefix || "", errorPrefix: s.ErrorOutputPrefix || "", roleArn: s.RoleARN || null, compression: s.CompressionFormat || null,
              bufferSeconds: s.BufferingHints ? s.BufferingHints.IntervalInSeconds : null, bufferMb: s.BufferingHints ? s.BufferingHints.SizeInMBs : null,
              processors: pc && pc.Enabled ? (pc.Processors || []).map(function (p) {
                var arn = ((p.Parameters || []).filter(function (x) { return x.ParameterName === "LambdaArn"; })[0] || {}).ParameterValue || null;
                return { type: p.Type, lambdaArn: arn };
              }) : [] };
          }) };
      });
    }
    return { streams: streams, stream: stream };
  }
  FirehoseApi.all = function (page, opts) { return root.ApiAll(page, opts); };
  root.FirehoseApi = FirehoseApi;
})(typeof window !== "undefined" ? window : globalThis);
