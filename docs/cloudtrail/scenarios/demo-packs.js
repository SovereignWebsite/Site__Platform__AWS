// Seeded CloudTrail for the twin's three demo packs (site/twin.js PACKS: baseline, attack, surge), as data for the
// twin owner: the records a real trail would hold for 22 Nov 2026, 09:00 to 12:00 UTC, the hours the CloudFront logs
// cover. Written by cloudtrail.aws.a. Synthetic and deterministic: account 111122223333, RFC 5737 addresses split as
// data.aws.a and ux.aws.a agreed (operator 192.0.2.0/24, visitors 198.51.100.0/24, the attacker on 203.0.113.0/24).
// Names follow the twin: buckets, roles sws-aws-platform-read/-change signed in with Google, the DNS role, the trail
// "demo", the hub's stack sws-aws-platform in eu-west-2. No network, no DOM.
//
// *To check* (boto3.aws.a): userIdentity and sourceIPAddress on CloudFront's origin fetches (OAC) and Firehose's
// writes, and readOnly on AssumeRoleWithWebIdentity. The reader and alarms do not depend on them.
(function (root) {
  "use strict";
  function demoPack(name, o) {
    o = o || {};
    var A = o.account || "111122223333", R = "eu-west-2", G = "us-east-1"; // IAM and STS write to us-east-1
    var B = { site: A + "--demo-site--" + R, logs: A + "--demo-cloudfront-logs--" + R, trail: "aws-cloudtrail-logs-" + A + "-demo" };
    var OPERATOR = o.operator || "192.0.2.10", ATTACKER = o.attacker || "203.0.113.66";
    var seed = 20261122;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    function pad(x, w) { x = String(x); while (x.length < (w || 2)) x = "0" + x; return x; }
    var out = [], n = 0;

    function platform(role) {
      return { type: "AssumedRole", principalId: "AROATWIN" + role.toUpperCase() + ":sws-aws-platform", arn: "arn:aws:sts::" + A + ":assumed-role/sws-aws-platform-" + role + "/sws-aws-platform",
        accountId: A, sessionContext: { sessionIssuer: { type: "Role", arn: "arn:aws:iam::" + A + ":role/sws-aws-platform-" + role, accountId: A, userName: "sws-aws-platform-" + role },
          webIdFederationData: { federatedProvider: "accounts.google.com" } } };
    }
    function webUser(sub) { return { type: "WebIdentityUser", principalId: "accounts.google.com:demo-client:" + sub, userName: sub, identityProvider: "accounts.google.com" }; }
    var service = function (svc) { return { type: "AWSService", invokedBy: svc }; };
    var firehose = { type: "AssumedRole", invokedBy: "firehose.amazonaws.com", arn: "arn:aws:sts::" + A + ":assumed-role/demo-firehose-delivery/firehose",
      sessionContext: { sessionIssuer: { type: "Role", arn: "arn:aws:iam::" + A + ":role/demo-firehose-delivery", userName: "demo-firehose-delivery", accountId: A } } };

    function rec(t, who, source, name, params, x) {
      x = x || {};
      var svc = who.invokedBy || null;
      out.push(Object.assign({ eventVersion: "1.09", userIdentity: who, eventTime: t, eventSource: source, eventName: name,
        awsRegion: x.region || (source === "iam.amazonaws.com" || source === "sts.amazonaws.com" ? G : R),
        sourceIPAddress: svc || x.ip || OPERATOR, userAgent: svc || (x.ip === ATTACKER ? "aws-cli/2.17.0" : "Mozilla/5.0"),
        requestParameters: params, responseElements: null, eventID: "pack-" + name.length + "-" + pad(++n, 6) + "-" + (x.tag || "b"),
        readOnly: !!x.read, eventType: "AwsApiCall", managementEvent: !x.data, recipientAccountId: A, eventCategory: x.data ? "Data" : "Management" },
        x.error ? { errorCode: x.error, errorMessage: x.message || null } : {}));
    }
    function at(h, m, s) { return "2026-11-22T" + pad(h) + ":" + pad(m) + ":" + pad(s || 0) + "Z"; }

    // ---- every pack: the operator's morning, the site serving, the logs being written ----
    rec(at(9, 2), webUser("operator-sub"), "sts.amazonaws.com", "AssumeRoleWithWebIdentity", { roleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read", roleSessionName: "sws-aws-platform" });
    rec(at(9, 3), platform("read"), "s3.amazonaws.com", "ListBuckets", null, { read: true });
    rec(at(9, 3, 20), platform("read"), "s3.amazonaws.com", "GetBucketCors", { bucketName: B.site }, { read: true });
    rec(at(9, 4), platform("read"), "iam.amazonaws.com", "GetRole", { roleName: "sws-aws-platform-change" }, { read: true });
    rec(at(10, 1, 2), platform("read"), "s3.amazonaws.com", "GetObject", { bucketName: B.site, key: "data/vaults.json" }, { read: true, data: true });
    var paths = ["index.html", "assets/site.css", "data/vaults.json", "vault/vault-demo-001/files", "vault/vault-demo-002/files"];
    var fetches = name === "surge" ? 50 : 5; // CloudFront origin fetches an hour: a tenth of visitors miss the cache
    for (var h = 9; h <= 11; h++) {
      for (var i = 0; i < fetches; i++) {
        var key = name === "surge" && rnd() < 0.7 ? "vault/vault-demo-001/files" : paths[Math.floor(rnd() * paths.length)];
        rec(at(h, Math.floor(rnd() * 60), Math.floor(rnd() * 60)), service("cloudfront.amazonaws.com"), "s3.amazonaws.com", "GetObject", { bucketName: B.site, key: key }, { read: true, data: true });
      }
      rec(at(h, 59, 30), firehose, "s3.amazonaws.com", "PutObject", { bucketName: B.logs, key: "cloudfront/2026/11/22/" + pad(h) + "/demo-distribution-1-2026-11-22-" + pad(h) + "-00-00.gz" }, { data: true });
    }

    // ---- attack: R-008 played out. A stolen Google token, refused, then accepted; the hub's stack rewritten
    // through a change set; the DNS role's trust changed; the trail and its bucket attacked and refused. ----
    if (name === "attack") {
      var X = { ip: ATTACKER, tag: "a" };
      for (var k = 0; k < 6; k++) rec(at(10, 20 + k, 7), webUser("operator-sub"), "sts.amazonaws.com", "AssumeRoleWithWebIdentity",
        { roleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-change", roleSessionName: "sws-aws-platform" }, Object.assign({ error: "AccessDenied", message: "Not authorized to perform sts:AssumeRoleWithWebIdentity" }, X));
      rec(at(10, 40), webUser("operator-sub"), "sts.amazonaws.com", "AssumeRoleWithWebIdentity", { roleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-change", roleSessionName: "sws-aws-platform" }, X);
      rec(at(10, 42), platform("change"), "cloudformation.amazonaws.com", "CreateChangeSet", { stackName: "sws-aws-platform", changeSetName: "maintenance-1122" }, X);
      rec(at(10, 43), platform("change"), "cloudformation.amazonaws.com", "ExecuteChangeSet", { stackName: "sws-aws-platform", changeSetName: "maintenance-1122" }, X);
      rec(at(10, 44, 40), platform("change"), "iam.amazonaws.com", "UpdateAssumeRolePolicy", { roleName: "sovereignwebsite-factory-dns", policyDocument: "(a trust policy naming another account)" }, X);
      rec(at(10, 46), platform("change"), "cloudtrail.amazonaws.com", "StopLogging", { name: "demo" }, Object.assign({ error: "AccessDenied" }, X));
      rec(at(10, 47), platform("change"), "s3.amazonaws.com", "PutBucketPolicy", { bucketName: B.trail }, Object.assign({ error: "AccessDenied" }, X));
    }
    return { Records: out };
  }
  // What each pack's trail should raise in ct-alarms.js (newest first), for the twin's own test to compare.
  var EXPECTED = {
    baseline: [],
    surge: [],
    attack: ["refused-on-protected", "refused-on-protected", "iam-trust-or-permissions", "hub-stack-change-applied", "new-network", "refused-burst"]
  };
  root.CloudTrailScenarios = Object.assign(root.CloudTrailScenarios || {}, { demoPack: demoPack, demoPackAlarms: EXPECTED });
})(typeof window !== "undefined" ? window : globalThis);
