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

  function apply(policy, plan) {
    if (plan.action === "iam.add_oidc_subjects") return addOidcSubjects(policy, plan);
    throw new Error("unknown plan action " + plan.action);
  }

  root.Plans = { apply: apply };
})(typeof window !== "undefined" ? window : globalThis);
