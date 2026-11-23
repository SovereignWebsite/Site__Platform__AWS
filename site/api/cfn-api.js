// CfnApi: CloudFormation's stack reads as plain objects (design 03, part 1 and refinements 1 to 3; cloudformation.aws.a's
// sketch in docs/cloudformation/2026-11-23__seed-and-read-api.md), over the same send as S3Api. Regional:
// cloudformation.<region>.amazonaws.com, Query protocol (form body, XML answer), Version 2010-05-15, paged by NextToken.
// Reads only: no change sets, no drift detection, no templates (plans and Approve do changes, design 01).
//
//   var api = CfnApi(send, { account });
//   api.stacks(region, { next, deleted })   -> { items: [stack], next }                       ListStacks
//   api.stack(region, nameOrArn)            -> stack + { parameters, outputs }                DescribeStacks
//   api.resources(region, stack, { next })  -> { items: [resource], next }                    ListStackResources
//   api.events(region, stack, { next })     -> { items: [event], next }, newest first         DescribeStackEvents
//   api.exports(region, { next })           -> { items: [{ name, value, stackArn, stack }], next }   ListExports
//   api.importers(region, exportName, { next }) -> { items: [stackName], next }              ListImports
//   stack    = { name, arn, region, status, reason, created, updated, description }
//   resource = { logicalId, physicalId, type, status, reason, updated, arn, arnDerived }
//   event    = { id, time, logicalId, physicalId, type, status, reason }
//   parameters: [{ key, value }]; outputs: [{ key, value, exportName, description }]
//   CfnApi.all = ApiAll (site/api/all.js), to drain any list method with a cap.
//
// stacks() leaves out DELETE_COMPLETE stacks (ListStacks keeps them for 90 days) unless { deleted: true }, so a page
// can hold fewer items than AWS sent; next still says whether there are more. A stack's arn is AWS's StackId.
// Resource ARNs (refinement 1): ListStackResources gives physical ids only. A physical id that is already an ARN is
// used as it is; for the types below the ARN is derived and marked arnDerived (it can be wrong, e.g. a role with a
// path, so the owning service's own answer overrides it in the graph); any other type, or one that needs the
// account when it is not known, gets urn:sws:cfn-resource:<stack>/<logicalId>, never a guess, where <stack> is the
// stack argument as given (pass the stack's ARN, from stacks(), for an id that is stable across regions and names).
// importers(): CloudFormation answers ValidationError "... is not imported by any stack" for an export no stack
// imports; that is { items: [], next: null } here, not an error. next is CloudFormation's NextToken, opaque.
// Errors: an Error whose message is "Code: Message", with .code and .status; a CORS TypeError passes through.
(function (root) {
  "use strict";
  var VERSION = "2010-05-15", REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/, ARN_RE = /^arn:aws[a-z-]*:/;
  function unescape(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e[0] === "#") { var c = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; }
      return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }[e];
    });
  }
  function blocks(xml, tag) {
    var out = [], re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g"), m;
    while ((m = re.exec(xml))) out.push(m[1]);
    return out;
  }
  // Text of the first element; null when absent or empty (CloudFormation leaves optional fields out).
  function text(xml, tag) { var b = blocks(xml, tag)[0]; return b === undefined || b === "" ? null : unescape(b); }
  // The <member> elements directly inside the first <tag>. Members nest (DescribeStacks: a stack's Parameters and
  // Outputs are members inside the stack's member), so this counts depth instead of matching the nearest close.
  function members(xml, tag) {
    var open = new RegExp("<" + tag + "(?:\\s[^>]*)?>").exec(xml);
    if (!open) return [];
    // The first </tag> after the open one ends it (no element in these answers nests inside one of its own name).
    var out = [], depth = 0, start = -1, re = /<(\/?)member>/g, m, end = xml.indexOf("</" + tag + ">", open.index);
    if (end < 0) return [];
    re.lastIndex = open.index + open[0].length;
    while ((m = re.exec(xml))) {
      if (m.index > end) break;
      if (!m[1]) { if (depth++ === 0) start = re.lastIndex; }
      else if (--depth === 0) out.push(xml.slice(start, m.index));
      else if (depth < 0) break;
    }
    return out;
  }
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  var DERIVE = {
    "AWS::S3::Bucket": function (id) { return "arn:aws:s3:::" + id; },
    "AWS::Route53::HostedZone": function (id) { return "arn:aws:route53:::hostedzone/" + id; },
    "AWS::IAM::Role": function (id, region, account) { return account && "arn:aws:iam::" + account + ":role/" + id; },
    "AWS::CloudFront::Distribution": function (id, region, account) { return account && "arn:aws:cloudfront::" + account + ":distribution/" + id; },
    "AWS::Lambda::Function": function (id, region, account) { return account && "arn:aws:lambda:" + region + ":" + account + ":function:" + id; }
  };

  function CfnApi(send, opts) {
    if (typeof send !== "function") throw new TypeError("CfnApi needs a send function");
    var account = opts && opts.account;
    function call(region, action, params) {
      if (!REGION_RE.test(String(region))) return Promise.reject(new TypeError("not an AWS region: " + region)); // it goes into a signed host name
      var body = new URLSearchParams({ Action: action, Version: VERSION });
      Object.keys(params || {}).forEach(function (k) { if (params[k] !== undefined && params[k] !== null && params[k] !== "") body.set(k, params[k]); });
      return send({ service: "cloudformation", region: region, method: "POST", url: "https://cloudformation." + region + ".amazonaws.com/",
        headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }).then(function (r) {
        return r.text().then(function (t) {
          if (r.ok) return t;
          throw fail(text(t, "Code") || "HTTP " + r.status, text(t, "Message") || "no message", r.status);
        });
      });
    }
    function need(v, what) { if (typeof v !== "string" || !v) throw new TypeError(what + " is required"); return v; }
    function stackOf(member, region) {
      // Top-level fields only: an output, tag or parameter has fields of the same names (Description) inside it.
      var m = member.replace(/<(Parameters|Outputs|Tags|Capabilities|NotificationARNs|RollbackConfiguration|DriftInformation)>[\s\S]*?<\/\1>/g, "");
      var arn = text(m, "StackId"), r = /^arn:aws[a-z-]*:cloudformation:([a-z0-9-]+):/.exec(arn || "");
      return { name: text(m, "StackName"), arn: arn, region: r ? r[1] : region, status: text(m, "StackStatus"), reason: text(m, "StackStatusReason"),
        created: text(m, "CreationTime"), updated: text(m, "LastUpdatedTime"), description: text(m, "TemplateDescription") || text(m, "Description") };
    }

    function stacks(region, o) {
      o = o || {};
      return call(region, "ListStacks", { NextToken: o.next }).then(function (t) {
        return { items: members(t, "StackSummaries").map(function (m) { return stackOf(m, region); })
          .filter(function (s) { return o.deleted || s.status !== "DELETE_COMPLETE"; }), next: text(t, "NextToken") };
      });
    }
    function stack(region, name) {
      try { need(name, "stack name or ARN"); } catch (e) { return Promise.reject(e); }
      return call(region, "DescribeStacks", { StackName: name }).then(function (t) {
        var m = members(t, "Stacks")[0];
        if (m === undefined) throw fail("ValidationError", "Stack with id " + name + " does not exist", 400);
        var s = stackOf(m, region);
        s.parameters = members(m, "Parameters").map(function (p) { return { key: text(p, "ParameterKey"), value: text(p, "ParameterValue") }; });
        s.outputs = members(m, "Outputs").map(function (p) {
          return { key: text(p, "OutputKey"), value: text(p, "OutputValue"), exportName: text(p, "ExportName"), description: text(p, "Description") };
        });
        return s;
      });
    }
    function resourceArn(type, physicalId, logicalId, region, stackRef) {
      if (physicalId && ARN_RE.test(physicalId)) return { arn: physicalId, arnDerived: false };
      var d = physicalId && Object.prototype.hasOwnProperty.call(DERIVE, type) ? DERIVE[type](physicalId, region, account) : null;
      if (d) return { arn: d, arnDerived: true };
      return { arn: "urn:sws:cfn-resource:" + stackRef + "/" + logicalId, arnDerived: false };
    }
    function resources(region, name, o) {
      o = o || {};
      try { need(name, "stack name or ARN"); } catch (e) { return Promise.reject(e); }
      return call(region, "ListStackResources", { StackName: name, NextToken: o.next }).then(function (t) {
        return { items: members(t, "StackResourceSummaries").map(function (m) {
          var type = text(m, "ResourceType"), physicalId = text(m, "PhysicalResourceId"), logicalId = text(m, "LogicalResourceId");
          var a = resourceArn(type, physicalId, logicalId, region, name);
          return { logicalId: logicalId, physicalId: physicalId, type: type, status: text(m, "ResourceStatus"), reason: text(m, "ResourceStatusReason"),
            updated: text(m, "LastUpdatedTimestamp"), arn: a.arn, arnDerived: a.arnDerived };
        }), next: text(t, "NextToken") };
      });
    }
    function events(region, name, o) {
      o = o || {};
      try { need(name, "stack name or ARN"); } catch (e) { return Promise.reject(e); }
      return call(region, "DescribeStackEvents", { StackName: name, NextToken: o.next }).then(function (t) {
        return { items: members(t, "StackEvents").map(function (m) {
          return { id: text(m, "EventId"), time: text(m, "Timestamp"), logicalId: text(m, "LogicalResourceId"), physicalId: text(m, "PhysicalResourceId"),
            type: text(m, "ResourceType"), status: text(m, "ResourceStatus"), reason: text(m, "ResourceStatusReason") };
        }), next: text(t, "NextToken") };
      });
    }
    function exports_(region, o) {
      o = o || {};
      return call(region, "ListExports", { NextToken: o.next }).then(function (t) {
        return { items: members(t, "Exports").map(function (m) {
          var arn = text(m, "ExportingStackId"), s = /:stack\/([^/]+)\//.exec(arn || "");
          return { name: text(m, "Name"), value: text(m, "Value"), stackArn: arn, stack: s ? s[1] : null };
        }), next: text(t, "NextToken") };
      });
    }
    function importers(region, exportName, o) {
      o = o || {};
      try { need(exportName, "export name"); } catch (e) { return Promise.reject(e); }
      return call(region, "ListImports", { ExportName: exportName, NextToken: o.next }).then(function (t) {
        return { items: members(t, "Imports").map(unescape), next: text(t, "NextToken") };
      }, function (e) {
        if (e && e.code === "ValidationError" && /is not imported by any stack/.test(e.message)) return { items: [], next: null };
        throw e;
      });
    }
    return { stacks: stacks, stack: stack, resources: resources, events: events, exports: exports_, importers: importers };
  }
  CfnApi.all = function (page, opts) { return root.ApiAll(page, opts); };
  root.CfnApi = CfnApi;
})(typeof window !== "undefined" ? window : globalThis);
