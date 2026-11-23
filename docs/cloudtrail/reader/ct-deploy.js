// Vault deployments in CloudTrail (Vault deploy plan, step 9: who deployed what, where, when). Groups the reader's
// events (ct-reader.js) by Vault and raises the deployment alarms. Reference implementation by cloudtrail.aws.a,
// kept in docs/ until a code path is agreed. No network, no DOM.
//
// One deployment is one Vault id (12 hex digits, cloudformation.aws.a's vault.yaml 0.4.0): stacks sws-vault-<id>
// and, in access-stack mode, sws-vault-<id>-access (iam.aws.a's vault-access.yaml); every resource is named
// sws-vault-<id>-* and tagged sws-vault=<id>. CloudFormation's own calls carry invokedBy or sourceIPAddress
// cloudformation.amazonaws.com; in access-stack mode they also run as the role sws-vault-<id>-deploy.
// boto3.aws.a (note 09 addendum, b2a8e2c): with a service role, AssumedRole of that role with invokedBy; without one,
// the caller with invokedBy; sourceIPAddress the service's DNS name. Consistent with AWS's pages, no example: confirm on a real trail.
(function (root) {
  "use strict";
  var CFN = "cloudformation.amazonaws.com";
  var VAULT = /sws-vault-([0-9a-f]{12})(?![0-9a-f])/;
  var STACK = /^sws-vault-([0-9a-f]{12})(-access|-alarm)?$/; // -alarm: vault-alarm.yaml, run by the customer in us-east-1
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
  function viaCfn(e) { return e.who.via === CFN || e.from.service === CFN; }
  function isDeployRole(e, id) { return e.who.name === "sws-vault-" + id + "-deploy"; }
  // Access-stack mode: the Vault stack was created or updated with the deploy role as its service role.
  function accessMode(events, id) {
    return events.some(function (e) { var p = e.raw && e.raw.requestParameters; return isControl(e) && stackOf(e) === "sws-vault-" + id && p && typeof p.roleARN === "string" && p.roleARN.slice(-("role/sws-vault-" + id + "-deploy").length) === "role/sws-vault-" + id + "-deploy"; });
  }
  // The access stack's own resources (the deploy role and its boundary), which CloudFormation makes as the customer.
  function accessStackResource(e, id) { var p = (e.raw && e.raw.requestParameters) || {}; return p.roleName === "sws-vault-" + id + "-deploy" || p.policyName === "sws-vault-" + id + "-boundary"; }
  // A call CloudFormation made for this Vault. Always needs CloudFormation's sign (invokedBy or source); the deploy
  // role's name alone is not enough (security.aws.a). In access-stack mode the Vault stack's calls must also run as
  // the deploy role. Stated limit: in one-stack mode another stack touching this Vault's resources looks the same.
  // The alarm stack's resources (vault-alarm.yaml 0.4.3): its cost topic, alarms, kill switch role, function and log
  // group. That stack is always run with the customer's own identity, never the deploy role (R-027).
  function alarmStackResource(e, id) {
    // Named fields only, checked against the stack's own names (security.aws.a, L1): a mention elsewhere, e.g. in a
    // description, tag or policy, does not make a call the alarm stack's.
    var p = (e.raw && e.raw.requestParameters) || {}, v = "sws-vault-" + id;
    var alarms = set([v + "-requests", v + "-requests-slow", v + "-killswitch-errors"]);
    var names = Array.isArray(p.alarmNames) ? p.alarmNames : [];
    return p.name === v + "-cost" || (typeof p.topicArn === "string" && p.topicArn.slice(-(v.length + 6)) === ":" + v + "-cost")
      || alarms[p.alarmName] === 1 || (names.length > 0 && names.every(function (n) { return alarms[n] === 1; }))
      || p.roleName === v + "-killswitch" || p.functionName === v + "-killswitch" || p.logGroupName === "/aws/lambda/" + v + "-killswitch";
  }
  function byCloudFormation(e, id, access) { return viaCfn(e) && (!access || isDeployRole(e, id) || accessStackResource(e, id) || alarmStackResource(e, id)); }
  // The kill switch doing its one job, and only that (security.aws.a, L2): concurrency set to 0, a distribution
  // disabled, or the sws-vault-paused tag. An unpause, or any other value, stays a direct change.
  function pausedTagOnly(p) {
    var keys = [];
    if (p.tags && Array.isArray(p.tags.items)) keys = p.tags.items.map(function (t) { return t && (t.key || t.Key); }); // CloudFront
    else if (p.tags && typeof p.tags === "object") keys = Object.keys(p.tags); // Lambda
    return keys.length > 0 && keys.every(function (k) { return k === "sws-vault-paused"; });
  }
  function killSwitch(e, id) {
    if (e.who.name !== "sws-vault-" + id + "-killswitch" || e.failed) return false;
    var p = (e.raw && e.raw.requestParameters) || {}, a = e.action || "";
    if (/^PutFunctionConcurrency/.test(a)) return Number(p.reservedConcurrentExecutions) === 0 && p.reservedConcurrentExecutions !== null && p.reservedConcurrentExecutions !== "";
    if (/^UpdateDistribution/.test(a)) return !!p.distributionConfig && (p.distributionConfig.enabled === false || p.distributionConfig.enabled === "false");
    if (/^TagResource/.test(a)) return pausedTagOnly(p);
    return false;
  }
  function isControl(e) { return e.service === "cloudformation" && CONTROL[e.action] === 1 && !!stackOf(e); }
  // A management change to the Vault's resources made by someone, not by CloudFormation. The Vault's own API role
  // writing its data is the Vault working, not a change to it; data events are left out for the same reason.
  function direct(e, id, access) {
    return e.change && e.category !== "Data" && e.service !== "cloudformation" && !byCloudFormation(e, id, access) && e.who.name !== "sws-vault-" + id + "-api" && !killSwitch(e, id);
  }
  function isOutOfBand(e, id, access) { return !e.failed && direct(e, id, access); }
  // Reads that reveal the Vault's token: the secret, or the function's configuration where O3 keeps it.
  function tokenRead(e, id) {
    return ((e.service === "secretsmanager" && e.action === "GetSecretValue") || (e.service === "lambda" && /^GetFunction(Configuration)?(\d|$)/.test(e.action || "")))
      && !viaCfn(e) && e.who.name !== "sws-vault-" + id + "-api";
  }

  // Returns deployments, latest activity first:
  // { id, account, mode, regions, stacks: { name: last control action }, first, last, by, state, counts, events }.
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
      var d = by[id], ev = d.events.slice().sort(function (a, b) { return a.time - b.time; }), lastApply = null, failedAfter = false, access = accessMode(ev, id);
      var counts = { calls: ev.length, failed: 0, byCloudFormation: 0, outOfBand: 0 };
      ev.forEach(function (e) {
        if (d.regions.indexOf(e.region) < 0 && e.service !== "iam" && e.service !== "cloudfront") d.regions.push(e.region); // global services
        if (e.failed) counts.failed++;
        if (byCloudFormation(e, id, access)) { counts.byCloudFormation++; if (e.failed && lastApply) failedAfter = true; }
        else if (isOutOfBand(e, id, access)) counts.outOfBand++;
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
      return { id: id, account: d.account, mode: access ? "access-stack" : "one-stack", regions: d.regions, stacks: d.stacks, first: ev[0].time, last: ev[ev.length - 1].time,
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
      match: function (e, id, opts, access) { return isOutOfBand(e, id, access); } },
    { id: "vault-deploy-role-outside-cloudformation", level: "high",
      words: "A Vault's deploy role acted without CloudFormation. It trusts only CloudFormation, so its credentials are loose or its trust was changed.",
      match: function (e, id) { return isDeployRole(e, id) && !viaCfn(e); } },
    { id: "vault-root-activity", level: "high",
      words: "The account root acted on a Vault's resources.",
      match: function (e) { return e.who.kind === "root"; } },
    { id: "vault-change-not-approved", level: "high",
      words: "A Vault's stack was applied by someone, or at a time, that no approved change covers.",
      match: function (e, id, opts) { return Array.isArray(opts.approvals) && isControl(e) && APPLY[e.action] === 1 && !e.failed && !approved(e, id, opts.approvals); } },
    { id: "vault-deleted", level: "medium",
      words: "A Vault's stack, its data bucket, or its log group (the Vault's own audit trail) was deleted.",
      match: function (e, id) {
        var p = (e.raw && e.raw.requestParameters) || {};
        return !e.failed && ((isControl(e) && e.action === "DeleteStack") || (e.service === "s3" && e.action === "DeleteBucket")
          || (e.service === "logs" && e.action === "DeleteLogGroup" && p.logGroupName === "/aws/lambda/sws-vault-" + id + "-api")); // vault.yaml 0.4.5: rollback may delete it
      } },
    { id: "vault-deploy-refused", level: "medium",
      words: "A step of a Vault's deployment was refused, by AWS or by the deploy role's limits.",
      match: function (e, id, opts, access) { return !!e.failed && (isControl(e) || byCloudFormation(e, id, access)); } },
    { id: "vault-direct-change-refused", level: "medium",
      words: "Someone tried, and was refused, to change a Vault's resources directly.",
      match: function (e, id, opts, access) { return !!e.failed && direct(e, id, access); } },
    { id: "vault-paused", level: "medium",
      words: "The Vault's kill switch paused it: its function was throttled to 0 or its distribution disabled, after the cost alarm fired.",
      match: function (e, id) { return killSwitch(e, id) && /^(PutFunctionConcurrency|UpdateDistribution)/.test(e.action); } },
    { id: "vault-token-read", level: "medium",
      words: "A Vault's token, or the function configuration that holds it, was read by someone other than CloudFormation or the Vault itself.",
      match: function (e, id) { return tokenRead(e, id); } }
  ];

  // Returns alarms, newest first: { rule, level, words, vault, events, time }.
  function alarms(deployments, opts) {
    opts = opts || {};
    var out = [];
    deployments.forEach(function (d) {
      var access = d.mode === "access-stack";
      RULES.forEach(function (r) {
        d.events.filter(function (e) { return r.match(e, d.id, opts, access); }).forEach(function (e) {
          out.push({ rule: r.id, level: r.level, words: r.words, vault: d.id, events: [e], time: e.time });
        });
      });
    });
    return out.sort(function (a, b) { return b.time - a.time; });
  }

  root.CloudTrailDeployments = { group: group, alarms: alarms, vaultOf: vaultOf,
    rules: RULES.map(function (r) { return { id: r.id, level: r.level, words: r.words }; }) };
})(typeof window !== "undefined" ? window : globalThis);
