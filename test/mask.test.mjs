// Screenshot mode's masking rules.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = { document: { readyState: "loading", addEventListener() {} }, localStorage: { getItem() { return null; }, setItem() {} }, MutationObserver: function () { this.observe = this.disconnect = () => {}; }, WeakMap };
ctx.window = ctx;
vm.runInNewContext(readFileSync(new URL("../site/mask.js", import.meta.url), "utf8"), ctx);
const m = ctx.ScreenshotMode.maskText, fail = (x) => { console.error("FAIL", x); process.exit(1); };
const cases = [
  ["arn:aws:iam::745506449035:oidc-provider/x", "arn:aws:iam::••••••••••••:oidc-provider/x"],
  ["745506449035--osbot-lambdas--eu-west-2", "••••••••••••--osbot-lambdas--eu-west-2"],
  ["Dinis Cruz · someone@example.org", "Dinis Cruz · •••@•••"],
  ["101331715302361457274", "•".repeat(21)],
  ["56.20 USD", "••• USD"],
  ["repo:SovereignWebsite@358722364/SovereignWebsite__IaC@1464324035:environment:apply", "repo:SovereignWebsite@358722364/SovereignWebsite__IaC@1464324035:environment:apply"],
  ["2026-11-23 01:12", "2026-11-23 01:12"]
];
for (const [a, b] of cases) if (m(a) !== b) fail(JSON.stringify([a, m(a), b]));
console.log("OK (screenshot mode masks)");
