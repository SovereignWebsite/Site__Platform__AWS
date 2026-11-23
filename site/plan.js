// Plans: pure functions that turn what AWS holds now into what it will hold after the change.
// No network here, so the same code is tested in CI and run in the page.
(function (root) {
  "use strict";

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function asList(v) { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }

  // iam.add_oidc_subjects: add subjects to the one statement whose condition lists plan.condition_key.
  // Refuses if there is not exactly one such statement. Changes nothing else.
  function addOidcSubjects(policy, plan) {
    var after = clone(policy);
    var found = [];
    asList(after.Statement).forEach(function (st) {
      Object.keys(st.Condition || {}).forEach(function (op) {
        if (Object.prototype.hasOwnProperty.call(st.Condition[op], plan.condition_key)) found.push({ st: st, op: op });
      });
    });
    if (found.length !== 1) throw new Error("expected one condition on " + plan.condition_key + ", found " + found.length);
    var f = found[0];
    if (!/^(ForAnyValue:)?String(Equals|Like)$/.test(f.op)) throw new Error("unexpected condition operator " + f.op);
    var subs = asList(f.st.Condition[f.op][plan.condition_key]);
    var added = plan.add.filter(function (s) { return subs.indexOf(s) < 0; });
    if (!added.length) return { after: after, added: [], unchanged: true };
    // A single value under a plain StringEquals becomes a list: IAM treats a list as "any of".
    f.st.Condition[f.op][plan.condition_key] = plan.add.filter(function (s) { return added.indexOf(s) >= 0; }).concat(subs);
    return { after: after, added: added, unchanged: false };
  }

  // iam.remove_oidc_subjects: remove subjects from that same statement. Refuses to remove the last one,
  // and changes nothing else.
  function removeOidcSubjects(policy, plan) {
    var after = clone(policy), found = [];
    asList(after.Statement).forEach(function (st) {
      Object.keys(st.Condition || {}).forEach(function (op) {
        if (Object.prototype.hasOwnProperty.call(st.Condition[op], plan.condition_key)) found.push({ st: st, op: op });
      });
    });
    if (found.length !== 1) throw new Error("expected one condition on " + plan.condition_key + ", found " + found.length);
    var f = found[0], subs = asList(f.st.Condition[f.op][plan.condition_key]);
    var removed = subs.filter(function (s) { return plan.remove.indexOf(s) >= 0; });
    if (!removed.length) return { after: after, removed: [], unchanged: true };
    var kept = subs.filter(function (s) { return plan.remove.indexOf(s) < 0; });
    if (!kept.length) throw new Error("refused: that would leave the role trusting no subject at all");
    f.st.Condition[f.op][plan.condition_key] = kept.length === 1 ? kept[0] : kept;
    return { after: after, removed: removed, unchanged: false };
  }

  function apply(policy, plan) {
    if (plan.action === "iam.add_oidc_subjects") return addOidcSubjects(policy, plan);
    if (plan.action === "iam.remove_oidc_subjects") return removeOidcSubjects(policy, plan);
    throw new Error("unknown plan action " + plan.action);
  }

  // Same content, whatever the order of object keys (IAM does not keep it); arrays keep their order.
  function canonical(x) {
    if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ":" + canonical(x[k]); }).join(",") + "}";
    return JSON.stringify(x);
  }
  function same(a, b) { return canonical(a) === canonical(b); }

  // Line diff (longest common subsequence): [{ op: " " | "-" | "+", line }].
  function lineDiff(a, b) {
    var x = a.replace(/\r/g, "").split("\n"), y = b.replace(/\r/g, "").split("\n"), n = x.length, m = y.length, i, j;
    var L = []; for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { out.push({ op: " ", line: x[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ op: "-", line: x[i] }); i++; }
      else { out.push({ op: "+", line: y[j] }); j++; }
    }
    for (; i < n; i++) out.push({ op: "-", line: x[i] });
    for (; j < m; j++) out.push({ op: "+", line: y[j] });
    return out;
  }

  // The CORS rule that lets this site list and open a bucket's objects, as a Cloud Control JSON patch.
  // Adds one rule (Id sws-aws-platform) and keeps every rule already there; nothing if it is already present.
  var CORS_ID = "sws-aws-platform";
  function corsRule(origin) {
    return { Id: CORS_ID, AllowedOrigins: [origin], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"],
      ExposedHeaders: ["ETag", "Content-Type", "Content-Length", "Last-Modified"], MaxAge: 3000 };
  }
  function corsPlan(props, origin) {
    var before = (props && props.CorsConfiguration) || null;
    var rules = (before && before.CorsRules) || [];
    if (rules.some(function (r) { return r.Id === CORS_ID && (r.AllowedOrigins || []).indexOf(origin) >= 0; }))
      return { unchanged: true, before: before, after: before, patch: [] };
    var rule = corsRule(origin);
    var after = { CorsRules: rules.concat([rule]) };
    var patch = before && before.CorsRules ? [{ op: "add", path: "/CorsConfiguration/CorsRules/-", value: rule }]
      : [{ op: "add", path: "/CorsConfiguration", value: { CorsRules: [rule] } }];
    return { unchanged: false, before: before, after: after, patch: patch };
  }

  root.Plans = { apply: apply, same: same, lineDiff: lineDiff, corsPlan: corsPlan };
})(typeof window !== "undefined" ? window : globalThis);
