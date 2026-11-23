// Vault deployments in CloudTrail (Vault deploy plan, step 9: who deployed what, where, when). Groups the reader's
// events (ct-reader.js) by Vault and raises the deployment alarms. Reference implementation by cloudtrail.aws.a,
// kept in docs/ until a code path is agreed. No network, no DOM.
//
// One deployment is one Vault id (12 hex digits, cloudformation.aws.a's vault.yaml 0.4.0): stacks sws-vault-<id>
// and, in access-stack mode, sws-vault-<id>-access (iam.aws.a's vault-access.yaml); every resource is named
// sws-vault-<id>-* and tagged sws-vault=<id>. CloudFormation's own calls carry invokedBy or sourceIPAddress
// cloudformation.amazonaws.com; in access-stack mode they also run as the role sws-vault-<id>-deploy.
// *To check* (boto3.aws.a): the exact userIdentity of CloudFormation's calls in one-stack mode (no service role).
(function (root) {
  "use strict";
  var CFN = "cloudformation.amazonaws.com";
  var VAULT = /sws-vault-([0-9a-f]{12})(?![0-9a-f])/;
  var STACK = /^sws-vault-([0-9a-f]{12})(-access)?$/;
  function set(names) { var o = Object.create(null); names.forEach(function (n) { o[n] = 1; }); return o; }
  var CONTROL = set(["CreateStack", "UpdateStack", "DeleteStack", "CreateChangeSet", "ExecuteChangeSet", "ContinueUpdateRollback", "CancelUpdateStack"]);
  var APPLY = set(["CreateStack", "UpdateStack", "DeleteStack", "ExecuteChangeSet", "ContinueUpdateRollback"]); // calls that change resources

  // The Vault id an event is about, or null: from a target, the request parameters, or the identity's role name.
  function vaultOf(e) {
    var i, m;
    for (i = 0; i < e.targets.length; i++) { m = VAULT.exec(e.targets[i].name || "") || VAULT.exec(e.targets[i].id || ""); if (m) return m[1]; }
    var p = e.raw && e.raw.requestParameters;
    if (p) { m = VAULT.exec(JSON.stringify(p)); if (m) return m[1]; }
    m = VAULT.exec(e.who.name || "");
    return m ? m[1] : null;
  }
  function stackOf(e) { var t = e.targets.filter(function (t) { return t.type === "stack" && STACK.test(t.name); })[0]; return t ? t.name : null; }
  function byCloudFormation(e, id) {
    return e.who.via === CFN || e.from.service === CFN || e.who.name === "sws-vault-" + id + "-deploy";
  }
  function isControl(e) { return e.service === "cloudformation" && CONTROL[e.action] === 1 && !!stackOf(e); }
  // A management change to the Vault's resources made by someone, not by CloudFormation. The Vault's own API role
  // writing its data is the Vault working, not a change to it; data events are left out for the same reason.
  function isOutOfBand(e, id) {
    return e.change && !e.failed && e.category !== "Data" && e.service !== "cloudformation" && !byCloudFormation(e, id) && e.who.name !== "sws-vault-" + id + "-api";
  }

  // Returns deployments, latest activity first:
  // { id, account, regions, stacks: { name: last control action }, first, last, by, state, counts, events }.
  // state is the last applied control call: created, updated, deleted, or failed when it was refused or a
  // CloudFormation call after it failed; "prepared" when only change sets were made.
  function group(events) {
    var by = Object.create(null), order = [];
    events.forEach(function (e) {
      var id = vaultOf(e); if (!id) return;
      if (!by[id]) { by[id] = { id: id, account: e.account, regions: [], stacks: Object.create(null), events: [] }; order.push(id); }
      by[id].events.push(e);
    });
    return order.map(function (id) {
      var d = by[id], ev = d.events.slice().sort(function (a, b) { return a.time - b.time; }), lastApply = null, failedAfter = false;
      var counts = { calls: ev.length, failed: 0, byCloudFormation: 0, outOfBand: 0 };
      ev.forEach(function (e) {
        if (d.regions.indexOf(e.region) < 0 && e.service !== "iam") d.regions.push(e.region); // IAM is global
        if (e.failed) counts.failed++;
        if (byCloudFormation(e, id)) { counts.byCloudFormation++; if (e.failed && lastApply) failedAfter = true; }
        else if (isOutOfBand(e, id)) counts.outOfBand++;
        if (isControl(e)) {
          d.stacks[stackOf(e)] = e.action + (e.failed ? " (refused)" : "");
          if (APPLY[e.action] === 1 || e.failed) { lastApply = e; failedAfter = false; }
          if (!d.by && !e.failed && APPLY[e.action] === 1) d.by = e.who;
        }
      });
      var state = !lastApply ? (Object.keys(d.stacks).length ? "prepared" : "unknown")
        : lastApply.failed || failedAfter ? "failed"
        : lastApply.action === "DeleteStack" ? "deleted"
        : lastApply.action === "CreateStack" ? "created" : "updated";
      return { id: id, account: d.account, regions: d.regions, stacks: d.stacks, first: ev[0].time, last: ev[ev.length - 1].time,
        by: d.by || null, state: state, counts: counts, events: ev.slice().reverse() };
    }).sort(function (a, b) { return b.last - a.last; });
  }

  // opts.approvals (optional): [{ vault, from, to, by }] with times in ms and by an ARN or role/user name; when
  // given, every applied control call needs one whose window holds it (and whose by matches, if set).
  function approved(e, id, approvals) {
    return approvals.some(function (a) {
      return a.vault === id && e.time >= a.from && e.time <= a.to && (!a.by || a.by === e.who.arn || a.by === e.who.name);
    });
  }
  var RULES = [
    { id: "vault-out-of-band-change", level: "high",
      words: "A Vault's resources were changed directly, not through its CloudFormation stack, so the stack no longer describes what runs.",
      match: function (e, id) { return isOutOfBand(e, id); } },
    { id: "vault-change-not-approved", level: "high",
      words: "A Vault's stack was applied by someone, or at a time, that no approved change covers.",
      match: function (e, id, opts) { return Array.isArray(opts.approvals) && isControl(e) && APPLY[e.action] === 1 && !e.failed && !approved(e, id, opts.approvals); } },
    { id: "vault-deleted", level: "medium",
      words: "A Vault's stack or its data bucket was deleted.",
      match: function (e, id) { return !e.failed && ((isControl(e) && e.action === "DeleteStack") || (e.service === "s3" && e.action === "DeleteBucket")); } },
    { id: "vault-deploy-refused", level: "medium",
      words: "A step of a Vault's deployment was refused, by AWS or by the deploy role's limits.",
      match: function (e, id) { return !!e.failed && (isControl(e) || byCloudFormation(e, id)); } }
  ];

  // Returns alarms, newest first: { rule, level, words, vault, events, time }.
  function alarms(deployments, opts) {
    opts = opts || {};
    var out = [];
    deployments.forEach(function (d) {
      RULES.forEach(function (r) {
        d.events.filter(function (e) { return r.match(e, d.id, opts); }).forEach(function (e) {
          out.push({ rule: r.id, level: r.level, words: r.words, vault: d.id, events: [e], time: e.time });
        });
      });
    });
    return out.sort(function (a, b) { return b.time - a.time; });
  }

  root.CloudTrailDeployments = { group: group, alarms: alarms, vaultOf: vaultOf,
    rules: RULES.map(function (r) { return { id: r.id, level: r.level, words: r.words }; }) };
})(typeof window !== "undefined" ? window : globalThis);
