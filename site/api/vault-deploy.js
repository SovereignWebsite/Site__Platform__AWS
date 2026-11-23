// VaultDeploy: the logic of the Vault deploy page (ux.aws.a design 06, plan step 5), with no DOM and no AWS call, so
// it runs in Node and in the page alike. The page has no credential in the customer's account (V8 a): it builds the
// quick-create link that opens CloudFormation in the customer's own console, and afterwards checks the address the
// customer pastes back by reading /health (vaults.aws.a design 04, 4a). Nothing here schedules anything (security.aws.a
// condition 7).
//
//   VaultDeploy.newVaultId(crypto)              -> "3f9a0c21b7d4"   12 hex digits from crypto.getRandomValues
//   index = the page's published-template index for one template, { "<version>": { url, versionId, sha256 } }: sha256
//       the file's 64 hex digits; url the S3 object URL (one bucket serves every region's console, boto3.aws.a note 12)
//       whose key is templates/<name>/<version>/<name>-<first 12 hex of sha256>.yaml, with no query; versionId the S3
//       object version (create-only keys in a compliance-locked, versioned bucket: cloudformation.aws.a). The link's
//       templateURL is <url>?versionId=<versionId>, AWS's documented way to name one exact version (CloudFormation User
//       Guide, via boto3.aws.a note 12), so neither a new version nor a delete marker changes what a link deploys. The
//       template URL is only ever taken from the index (security.aws.a); every part is checked before a link is built.
//       <name> is vault for vaultStackUrl and vault-access for accessStackUrl.
//   VaultDeploy.vaultStackUrl(o)                -> quick-create URL for stack sws-vault-<id>
//       o = { region, vaultId, index, version, imageUri, deployPageOrigin, mode: "one-stack" | "access-stack" }
//   VaultDeploy.accessStackUrl(o)               -> quick-create URL for stack sws-vault-<id>-access (least-privilege
//       mode, screen 2-alt); o = { region, vaultId, index, version, params: { Name: value } } (the access template's
//       index and its own parameters, passed as given; VaultId is always set from o.vaultId). The page shows the
//       DistributionId and CertificateArn it passes beside the change set, never filled silently (iam.aws.a 0.2.0).
//   VaultDeploy.templateEntry(index, version, name) -> { url, versionId, sha256, templateUrl }: the checked index entry for one of the three
//       published templates, name "vault" | "vault-access" | "vault-edge" (the us-east-1 certificate stack for an own
//       domain, design 06b, whose link comes later); throws a TypeError if the entry is missing or not in the form
//   VaultDeploy.deployRoleName(vaultId)         -> "sws-vault-<id>-deploy", the role the customer picks in 2-alt
//   VaultDeploy.cleanEndpoint(input)            -> { ok: true, endpoint } | { ok: false, reason: "empty" | "not-url" | "not-cloudfront" }
//   VaultDeploy.checkHealth(fetch, endpoint, { vaultId, index, version, timeoutMs, maxBytes })
//       -> Promise<{ ok: true, vaultId, version, sha256 } | { ok: false, reason, ... }>
//       version: the template version this page linked. reason: "not-url" | "not-cloudfront" | "no-answer" |
//       "not-a-vault" | "other-vault" (with vaultId) | "old-template" (a version not in the index, with version) |
//       "other-template" (a published version other than the one linked: an older deployment, with version) |
//       "template-mismatch" (a template_sha256 in the answer that differs from the index entry: not our template) |
//       "too-large"
//       sha256 is always the index entry for the version, never taken from the answer (architect.aws.a design 05,
//       change 3: live needs that entry to equal the sha256 of the template the page linked).
//
// The link's format is AWS's documented quick-create link (boto3.aws.a, docs/boto3/2026-11-23__08-vault-deploy-design-
// check.md note C, AWS CloudFormation User Guide read 23 Nov 2026): https://<region>.console.aws.amazon.com/
// cloudformation/home?region=<region>#/stacks/create/review?templateURL=<S3 URL>&stackName=<name>&param_<Name>=<value>.
// Only templateURL, stackName and param_<Name> are documented, so nothing else is sent; the template URL must be an
// S3 object URL. Inputs are checked against the same patterns vault.yaml declares (work/cloudformation.aws.a 0.4.4),
// so a link that CloudFormation would refuse is refused here first, with a TypeError naming the field.
// /health's answer is untrusted (security.aws.a): fetched with credentials omitted, redirects refused, no cache, a
// time limit and a byte cap; vault_id must be 12 hex digits and template_version a key of the index. Callers render
// what comes back with textContent only. The pasted address is never put in a URL or storage by this module.
(function (root) {
  "use strict";
  var REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;
  var VAULT_ID_RE = /^[0-9a-f]{12}$/;
  // vault.yaml's own patterns (ImageUri, DeployPageOrigin), copied so the page refuses what the stack would.
  var IMAGE_RE = /^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/;
  var ORIGIN_RE = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]([a-z0-9-]*[a-z0-9])?(:[1-9][0-9]{0,4})?$/;
  // An S3 object URL in either documented form: https://s3.<region>.amazonaws.com/<bucket>/<key> or
  // https://<bucket>.s3.<region>.amazonaws.com/<key>. Bucket names: 3 to 63 of a-z, 0-9, dot and hyphen.
  // The two documented forms, with the key captured; no query or fragment.
  var S3_PATH_RE = /^https:\/\/s3\.[a-z]{2}(-[a-z]+)+-\d\.amazonaws\.com\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/([^?#\s]+)$/;
  var S3_HOST_RE = /^https:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\.s3\.[a-z]{2}(-[a-z]+)+-\d\.amazonaws\.com\/([^?#\s]+)$/;
  var VERSION_RE = /^[0-9a-z][0-9a-z.-]{0,63}$/;
  var S3_VERSION_ID_RE = /^[A-Za-z0-9._-]{1,1024}$/; // S3 object version ids are URL-safe
  var SHA_RE = /^[0-9a-f]{64}$/;
  var PARAM_RE = /^[A-Za-z0-9]{1,255}$/;
  var CLOUDFRONT_RE = /^https:\/\/[a-z0-9]{1,63}\.cloudfront\.net$/;

  function need(ok, field, v) { if (!ok) throw new TypeError("VaultDeploy: bad " + field + ": " + String(v).slice(0, 80)); }

  function newVaultId(crypto) {
    var c = crypto || root.crypto;
    if (!c || typeof c.getRandomValues !== "function") throw new TypeError("VaultDeploy.newVaultId needs crypto.getRandomValues");
    var b = c.getRandomValues(new Uint8Array(6)), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }

  function quickCreate(region, templateUrl, stackName, params) {
    var q = "templateURL=" + encodeURIComponent(templateUrl) + "&stackName=" + encodeURIComponent(stackName);
    Object.keys(params).forEach(function (k) {
      need(PARAM_RE.test(k), "parameter name", k);
      var v = params[k];
      if (v === undefined || v === null) return;
      q += "&param_" + k + "=" + encodeURIComponent(String(v));
    });
    return "https://" + region + ".console.aws.amazon.com/cloudformation/home?region=" + region + "#/stacks/create/review?" + q;
  }
  // An index entry for a version: own key only, a sha256, and an S3 object URL whose key names this template, this
  // version and the sha256's first 12 hex digits (cloudformation.aws.a's form).
  var NAMES = { vault: true, "vault-access": true, "vault-edge": true };
  function entry(index, version, name) {
    need(Object.prototype.hasOwnProperty.call(NAMES, name), "template name", name);
    var v = String(version);
    need(VERSION_RE.test(v) && index && typeof index === "object" && Object.prototype.hasOwnProperty.call(index, v), "version (not in the published index)", v);
    var e = index[v], url = e && String(e.url), sha = e && String(e.sha256), vid = e && String(e.versionId);
    need(SHA_RE.test(sha), "index sha256 for " + v, sha);
    need(S3_VERSION_ID_RE.test(vid), "index versionId for " + v, vid);
    var m = S3_PATH_RE.exec(url) || S3_HOST_RE.exec(url), key = m && m[m.length - 1];
    need(key === "templates/" + name + "/" + v + "/" + name + "-" + sha.slice(0, 12) + ".yaml", "index url for " + v + " (templates/" + name + "/" + v + "/" + name + "-<sha256 12>.yaml in S3)", url);
    return { url: url, versionId: vid, sha256: sha, templateUrl: url + "?versionId=" + vid };
  }
  function common(o, name) {
    o = o || {};
    var region = String(o.region), vaultId = String(o.vaultId);
    need(REGION_RE.test(region), "region", region);
    need(VAULT_ID_RE.test(vaultId), "vaultId", vaultId);
    return { region: region, vaultId: vaultId, templateUrl: entry(o.index, o.version, name).templateUrl };
  }
  function vaultStackUrl(o) {
    var c = common(o, "vault"), imageUri = String(o.imageUri), origin = String(o.deployPageOrigin), mode = o.mode === undefined ? "one-stack" : String(o.mode);
    need(IMAGE_RE.test(imageUri), "imageUri", imageUri);
    need(origin.length <= 270 && ORIGIN_RE.test(origin), "deployPageOrigin", origin);
    need(mode === "one-stack" || mode === "access-stack", "mode", mode);
    // Domain parameters stay empty on the first deploy (design 06: adding a domain is a later, separate action).
    return quickCreate(c.region, c.templateUrl, "sws-vault-" + c.vaultId, { VaultId: c.vaultId, DeployMode: mode, ImageUri: imageUri, DeployPageOrigin: origin });
  }
  function accessStackUrl(o) {
    var c = common(o, "vault-access"), params = {};
    var given = o.params && typeof o.params === "object" ? o.params : {};
    Object.keys(given).forEach(function (k) { if (k !== "VaultId") params[k] = given[k]; });
    params.VaultId = c.vaultId;
    return quickCreate(c.region, c.templateUrl, "sws-vault-" + c.vaultId + "-access", params);
  }
  function deployRoleName(vaultId) { need(VAULT_ID_RE.test(String(vaultId)), "vaultId", vaultId); return "sws-vault-" + vaultId + "-deploy"; }

  // Forgiving input (sherpa.aws.a): spaces around it, with or without https://, a trailing slash or two; letters in
  // any case. In v1 the endpoint is a CloudFront default address only (a custom domain is a later step).
  function cleanEndpoint(input) {
    var s = String(input === undefined || input === null ? "" : input).trim();
    if (!s) return { ok: false, reason: "empty" };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
    s = s.replace(/\/+$/, "");
    var lower = s.toLowerCase();
    // A scheme, then a bare host name with an optional port: no path, query, user or other characters.
    if (!/^[a-z][a-z0-9+.-]*:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(lower)) return { ok: false, reason: "not-url" };
    if (!CLOUDFRONT_RE.test(lower)) return { ok: false, reason: "not-cloudfront" };
    return { ok: true, endpoint: lower };
  }

  // Reads at most maxBytes of the body, then stops; true in .over when there was more.
  function readCapped(res, maxBytes) {
    if (res.body && typeof res.body.getReader === "function") {
      var reader = res.body.getReader(), chunks = [], n = 0;
      var step = function () {
        return reader.read().then(function (r) {
          if (r.done) return { bytes: join(chunks, n), over: false };
          n += r.value.length; chunks.push(r.value);
          if (n > maxBytes) { try { reader.cancel(); } catch (e) { /* already closed */ } return { bytes: null, over: true }; }
          return step();
        });
      };
      return step();
    }
    return res.arrayBuffer().then(function (b) { return b.byteLength > maxBytes ? { bytes: null, over: true } : { bytes: new Uint8Array(b), over: false }; });
  }
  function join(chunks, n) { var out = new Uint8Array(n), o = 0; chunks.forEach(function (c) { out.set(c, o); o += c.length; }); return out; }

  function checkHealth(fetch, endpoint, o) {
    o = o || {};
    if (typeof fetch !== "function") return Promise.reject(new TypeError("VaultDeploy.checkHealth needs fetch"));
    var vaultId = String(o.vaultId), index = o.index && typeof o.index === "object" ? o.index : {}, linked = String(o.version);
    if (!VAULT_ID_RE.test(vaultId)) return Promise.reject(new TypeError("VaultDeploy.checkHealth needs this page's vaultId"));
    try { entry(index, linked, "vault"); } catch (err) { return Promise.reject(new TypeError("VaultDeploy.checkHealth needs the linked version, in the index")); }
    var e = cleanEndpoint(endpoint);
    if (!e.ok) return Promise.resolve({ ok: false, reason: e.reason === "empty" ? "not-url" : e.reason });
    var timeoutMs = o.timeoutMs || 10000, maxBytes = o.maxBytes || 4096;
    var ctl = typeof AbortController === "function" ? new AbortController() : null, timer = null;
    var limit = new Promise(function (resolve) { timer = setTimeout(function () { if (ctl) ctl.abort(); resolve({ ok: false, reason: "no-answer" }); }, timeoutMs); });
    var got = Promise.resolve().then(function () {
      return fetch(e.endpoint + "/health", { method: "GET", credentials: "omit", redirect: "error", cache: "no-store", mode: "cors", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined });
    }).then(function (res) {
      if (!res || !res.ok) return { ok: false, reason: "not-a-vault" };
      return readCapped(res, maxBytes).then(function (r) {
        if (r.over) return { ok: false, reason: "too-large" };
        var j; try { j = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(r.bytes)); } catch (err) { return { ok: false, reason: "not-a-vault" }; }
        if (!j || typeof j !== "object" || typeof j.vault_id !== "string" || !VAULT_ID_RE.test(j.vault_id)) return { ok: false, reason: "not-a-vault" };
        if (j.vault_id !== vaultId) return { ok: false, reason: "other-vault", vaultId: j.vault_id };
        var v = typeof j.template_version === "string" ? j.template_version : "", known;
        if (!v || !Object.prototype.hasOwnProperty.call(index, v)) return { ok: false, reason: "old-template", version: v.slice(0, 40) };
        try { known = entry(index, v, "vault"); } catch (err) { return { ok: false, reason: "old-template", version: v.slice(0, 40) }; }
        // /health answers { vault_id, template_version } (vaults.aws.a); a template_sha256, if present, must agree, or
        // the template is not ours (checked first: it is the more serious answer).
        if (j.template_sha256 !== undefined && j.template_sha256 !== known.sha256) return { ok: false, reason: "template-mismatch", version: v.slice(0, 40) };
        if (v !== linked) return { ok: false, reason: "other-template", version: v.slice(0, 40) };
        return { ok: true, vaultId: j.vault_id, version: v, sha256: known.sha256 };
      });
    }, function () { return { ok: false, reason: "no-answer" }; }); // network, DNS, CORS or a refused redirect
    return Promise.race([got, limit]).then(function (r) { clearTimeout(timer); return r; });
  }

  root.VaultDeploy = { newVaultId: newVaultId, vaultStackUrl: vaultStackUrl, accessStackUrl: accessStackUrl, deployRoleName: deployRoleName,
    cleanEndpoint: cleanEndpoint, checkHealth: checkHealth, templateEntry: function (index, version, name) { return entry(index, version, String(name)); } };
})(typeof window !== "undefined" ? window : globalThis);
