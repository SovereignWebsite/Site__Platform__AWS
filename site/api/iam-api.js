// IamApi: IAM's role reads as plain objects (design 04, work/architect.aws.a 77d26be), over the same send as S3Api.
// IAM is global: iam.amazonaws.com, signed for us-east-1, Query protocol (form body, XML answer), paged by Marker.
// Reads only: no users, groups or access keys, and no policy evaluation (design 04, "Out, on purpose").
//
//   var api = IamApi(send);
//   api.roles({ next, max })        -> { items: [role summary], next }   ListRoles, which carries each role's trust
//   api.role(name)                  -> role summary + { lastUsed, boundary }   GetRole, for what ListRoles lacks
//   role summary = { name, arn, path, created, description, maxSession, serviceLinked, trust }
//   api.attached(name, { next })    -> { items: [{ name, arn }], next }
//   api.inline(name, { next })      -> { items: [name], next }
//   api.inlineDocument(name, policy)-> policy document (parsed JSON, as AWS wrote it)
//   api.policyDocument(arn)         -> { version, document, awsManaged }   (GetPolicy, then its default version)
//   api.providers()                 -> [{ arn, url, urlDerived: true }]     (ARNs only from AWS; url read from the ARN)
//   api.provider(arn)               -> { arn, url, clientIds, created }      GetOpenIDConnectProvider (for aud conditions)
//   trust = { statements: [{ effect, actions, notActions, principals: [{ kind, id }], notPrincipals, conditions: [{ op, key, values }] }] }
//           kind: "service" | "aws" | "federated" | "canonical"; read, never judged.
//   lastUsed: { when, region }, or null: IAM tracks 400 days, so null means "not used in the last 400 days", never
//   "never used" (design 04, from boto3.aws.a). boundary: { type, arn } or null; a view that shows a role's policies
//   shows its boundary beside them. serviceLinked: the role sits under /aws-service-role/ (AWS manages it).
//   IamApi.all = ApiAll (site/api/all.js), to drain roles(), attached() or inline() with a cap.
//
// Policy documents (from any call) go through decodeURIComponent, then JSON.parse: AWS's notes say they are
// URL-encoded and its samples show plain JSON, and decoding plain JSON leaves it as it is; values stay as AWS wrote them, with only
// Statement, Action, Principal ids and condition values made arrays. Errors: an Error "Code: Message", .code,
// .status; a CORS TypeError passes through. awsManaged documents may be a summary or placeholder where the source
// does not carry AWS's text: the page points to AWS's documentation for those.
(function (root) {
  "use strict";
  var ENDPOINT = "https://iam.amazonaws.com/", REGION = "us-east-1", VERSION = "2010-05-08";
  function unescape(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }[e];
    });
  }
  function blocks(xml, tag) {
    var out = [], re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g"), m;
    while ((m = re.exec(xml))) out.push(m[1]);
    return out;
  }
  function text(xml, tag) { var b = blocks(xml, tag)[0]; return b === undefined ? "" : unescape(b); }
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  function arr(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function doc(encoded) { return JSON.parse(decodeURIComponent(encoded)); }

  function trust(d) {
    return { statements: arr(d && d.Statement).map(function (s) {
      function principals(p) {
        if (p === undefined) return [];
        if (p === "*") return [{ kind: "aws", id: "*" }];
        var KIND = { Service: "service", AWS: "aws", Federated: "federated", CanonicalUser: "canonical" }, out = [];
        Object.keys(p).forEach(function (k) { arr(p[k]).forEach(function (id) { out.push({ kind: KIND[k] || k.toLowerCase(), id: id }); }); });
        return out;
      }
      var conditions = [];
      Object.keys(s.Condition || {}).forEach(function (op) {
        Object.keys(s.Condition[op]).forEach(function (key) { conditions.push({ op: op, key: key, values: arr(s.Condition[op][key]) }); });
      });
      return { effect: s.Effect, actions: arr(s.Action), notActions: arr(s.NotAction), principals: principals(s.Principal),
        notPrincipals: principals(s.NotPrincipal), conditions: conditions };
    }) };
  }
  function roleSummary(m) {
    var path = text(m, "Path"), d = text(m, "AssumeRolePolicyDocument");
    return { name: text(m, "RoleName"), arn: text(m, "Arn"), path: path, created: text(m, "CreateDate"),
      description: text(m, "Description"), maxSession: Number(text(m, "MaxSessionDuration")) || null,
      serviceLinked: path.indexOf("/aws-service-role/") === 0, trust: d ? trust(doc(d)) : { statements: [] } };
  }

  function IamApi(send) {
    if (typeof send !== "function") throw new TypeError("IamApi needs a send function");
    function call(action, params) {
      var q = new URLSearchParams(Object.assign({ Action: action, Version: VERSION }, params || {})).toString();
      return send({ service: "iam", region: REGION, method: "POST", url: ENDPOINT, body: q,
        headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" } }).then(function (r) {
        return r.text().then(function (t) {
          if (!r.ok) throw fail(text(t, "Code") || "HTTP " + r.status, text(t, "Message") || "no message", r.status);
          return t;
        });
      });
    }
    function paged(action, params, opts, listTag, item) {
      opts = opts || {};
      var p = Object.assign({}, params);
      if (opts.next) p.Marker = opts.next;
      if (opts.max) p.MaxItems = String(Math.min(Math.max(1, opts.max | 0), 1000));
      return call(action, p).then(function (t) {
        var list = blocks(t, listTag)[0] || "";
        return { items: blocks(list, "member").map(item), next: text(t, "IsTruncated") === "true" ? text(t, "Marker") || null : null };
      });
    }
    function roles(opts) { return paged("ListRoles", {}, opts, "Roles", roleSummary); }
    function role(name) {
      return call("GetRole", { RoleName: name }).then(function (t) {
        var m = blocks(t, "Role")[0] || "", lu = blocks(m, "RoleLastUsed")[0], when = lu ? text(lu, "LastUsedDate") : "";
        var r = roleSummary(m), pb = blocks(m, "PermissionsBoundary")[0];
        r.lastUsed = when ? { when: when, region: text(lu, "Region") || null } : null;
        r.boundary = pb && text(pb, "PermissionsBoundaryArn") ? { type: text(pb, "PermissionsBoundaryType") || null, arn: text(pb, "PermissionsBoundaryArn") } : null;
        return r;
      });
    }
    function attached(name, opts) {
      return paged("ListAttachedRolePolicies", { RoleName: name }, opts, "AttachedPolicies", function (m) { return { name: text(m, "PolicyName"), arn: text(m, "PolicyArn") }; });
    }
    function inline(name, opts) { return paged("ListRolePolicies", { RoleName: name }, opts, "PolicyNames", function (m) { return unescape(m); }); }
    function inlineDocument(name, policy) {
      return call("GetRolePolicy", { RoleName: name, PolicyName: policy }).then(function (t) { return doc(text(t, "PolicyDocument")); });
    }
    function policyDocument(arn) {
      return call("GetPolicy", { PolicyArn: arn }).then(function (t) {
        var v = text(t, "DefaultVersionId");
        return call("GetPolicyVersion", { PolicyArn: arn, VersionId: v }).then(function (t2) {
          return { version: v, document: doc(text(t2, "Document")), awsManaged: /^arn:aws:iam::aws:policy\//.test(arn) };
        });
      });
    }
    function providers() {
      return call("ListOpenIDConnectProviders").then(function (t) {
        return blocks(blocks(t, "OpenIDConnectProviderList")[0] || "", "member").map(function (m) {
          var a = text(m, "Arn"); return { arn: a, url: a.split(":oidc-provider/")[1] || null, urlDerived: true };
        });
      });
    }
    function provider(arn) {
      return call("GetOpenIDConnectProvider", { OpenIDConnectProviderArn: arn }).then(function (t) {
        return { arn: arn, url: text(t, "Url"), clientIds: blocks(blocks(t, "ClientIDList")[0] || "", "member").map(unescape), created: text(t, "CreateDate") || null };
      });
    }
    return { roles: roles, role: role, attached: attached, inline: inline, inlineDocument: inlineDocument, policyDocument: policyDocument, providers: providers, provider: provider };
  }
  IamApi.trust = trust;
  IamApi.all = function (page, opts) { return root.ApiAll(page, opts); };
  root.IamApi = IamApi;
})(typeof window !== "undefined" ? window : globalThis);
