import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = {}; ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(new URL("../site/plan.js", import.meta.url), "utf8"), ctx);
const plan = JSON.parse(readFileSync(new URL("../site/plans/2026-11-22__iac-dns-trust.json", import.meta.url), "utf8"));
const K = "token.actions.githubusercontent.com:sub";
const before = { Version: "2012-10-17", Statement: [{ Effect: "Allow",
  Principal: { Federated: "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com" },
  Action: "sts:AssumeRoleWithWebIdentity",
  Condition: { StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "ForAnyValue:StringEquals": { [K]: ["repo:SovereignWebsite@358722364/SovereignWebsite__Factory@1464324035:environment:apply",
      "repo:SovereignWebsite/SovereignWebsite__Factory:environment:apply"] } } }] };
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const r = ctx.Plans.apply(before, plan);
const subs = r.after.Statement[0].Condition["ForAnyValue:StringEquals"][K];
if (subs.length !== 3 || subs[0] !== plan.add[0] || subs[1] !== before.Statement[0].Condition["ForAnyValue:StringEquals"][K][0]) fail("subjects " + JSON.stringify(subs));
const strip = (p) => { const c = JSON.parse(JSON.stringify(p)); delete c.Statement[0].Condition["ForAnyValue:StringEquals"]; return JSON.stringify(c); };
if (strip(r.after) !== strip(before)) fail("changed something else");
if (before.Statement[0].Condition["ForAnyValue:StringEquals"][K].length !== 2) fail("mutated the input");
if (!ctx.Plans.apply(r.after, plan).unchanged) fail("not idempotent");
const single = JSON.parse(JSON.stringify(before)); delete single.Statement[0].Condition["ForAnyValue:StringEquals"];
single.Statement[0].Condition.StringEquals[K] = "repo:x";
if (ctx.Plans.apply(single, plan).after.Statement[0].Condition.StringEquals[K].length !== 2) fail("single value");
const none = JSON.parse(JSON.stringify(single)); delete none.Statement[0].Condition.StringEquals[K];
try { ctx.Plans.apply(none, plan); fail("accepted a policy without the key"); } catch (e) { if (!/expected one/.test(e.message)) throw e; }
console.log("OK (plan iac-dns-trust)");
// IAM returns the same policy with keys in another order: that is the same policy.
const reordered = JSON.parse(JSON.stringify(before)); const c = reordered.Statement[0].Condition;
reordered.Statement[0].Condition = { "ForAnyValue:StringEquals": c["ForAnyValue:StringEquals"], StringEquals: c.StringEquals };
if (!ctx.Plans.same(before, reordered)) fail("key order treated as a change");
const changed = JSON.parse(JSON.stringify(before)); changed.Statement[0].Condition["ForAnyValue:StringEquals"][K].reverse();
if (ctx.Plans.same(before, changed)) fail("a real change not seen");
console.log("OK (plan same)");
const d = ctx.Plans.lineDiff("a\nb\nc", "a\nx\nc\nd");
if (d.map((x) => x.op + x.line).join(",") !== " a,-b,+x, c,+d") fail("lineDiff " + JSON.stringify(d));
const o = "https://aws.platform.sovereignweb.site";
const p1 = ctx.Plans.corsPlan({}, o); if (p1.patch[0].path !== "/CorsConfiguration") fail("cors new");
const p2 = ctx.Plans.corsPlan({ CorsConfiguration: { CorsRules: [{ Id: "theirs", AllowedOrigins: ["https://x"], AllowedMethods: ["PUT"] }] } }, o);
if (p2.patch[0].path !== "/CorsConfiguration/CorsRules/-" || p2.after.CorsRules.length !== 2 || p2.after.CorsRules[0].Id !== "theirs") fail("cors keep");
if (!ctx.Plans.corsPlan({ CorsConfiguration: p2.after }, o).unchanged) fail("cors idempotent");
console.log("OK (plan diff and cors)");
// Step 5: remove the Factory subject from the live policy shape (plain StringEquals, a list of two).
const rm = JSON.parse(readFileSync(new URL("../site/plans/2026-11-23__iac-dns-trust-remove-factory.json", import.meta.url), "utf8"));
const iac = "repo:SovereignWebsite@358722364/SovereignWebsite__IaC@1464324035:environment:apply";
const live = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Federated: "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com" }, Action: "sts:AssumeRoleWithWebIdentity",
  Condition: { StringEquals: { [K]: [iac, "repo:SovereignWebsite@358722364/SovereignWebsite__Factory@1464324035:environment:apply"], "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" } } }] };
const r5 = ctx.Plans.apply(live, rm);
if (JSON.stringify(r5.after.Statement[0].Condition.StringEquals[K]) !== JSON.stringify([iac]) || r5.after.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] !== "sts.amazonaws.com") fail("remove " + JSON.stringify(r5.after));
if (!ctx.Plans.apply(r5.after, rm).unchanged) fail("remove not idempotent");
try { ctx.Plans.apply({ Statement: [{ Condition: { StringEquals: { [K]: rm.remove[0] } } }] }, rm); fail("removed the last subject"); } catch (e) { if (!/refused/.test(e.message)) throw e; }
console.log("OK (plan remove factory subject)");
if (!ctx.Plans.sameTemplate("A: 1\nParameters:\n  X:\n    Type: String\n    Default: \"v\"\n", "A: 1\nParameters:\n  X:\n    Type: String\n")) fail("sameTemplate defaults");
if (ctx.Plans.sameTemplate("A: 1\n", "A: 2\n")) fail("sameTemplate diff");
console.log("OK (plan same template)");
// IAM reads a list of one back as the bare value: the same policy.
if (!ctx.Plans.same({ a: ["x"] }, { a: "x" }) || ctx.Plans.same({ a: ["x", "y"] }, { a: "x" })) fail("same list-of-one");
console.log("OK (plan same, IAM list of one)");
