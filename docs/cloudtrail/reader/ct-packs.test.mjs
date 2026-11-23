// Tests for docs/cloudtrail/scenarios/demo-packs.js: each pack's trail read by ct-reader.js and run through
// ct-alarms.js gives the alarms the pack is meant to show, and nothing leaks the attacker's address to the graph.
// Run from the repository root: node docs/cloudtrail/reader/ct-packs.test.mjs
import { readFileSync } from "node:fs";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b)); };
globalThis.window = globalThis;
for (const f of ["./ct-reader.js", "./ct-alarms.js", "../scenarios/demo-packs.js"]) new Function(readFileSync(new URL(f, import.meta.url), "utf8"))();
const R = globalThis.CloudTrailReader, AL = globalThis.CloudTrailAlarms, S = globalThis.CloudTrailScenarios;
let cases = 0; const check = (a, b, m) => { cases++; eq(a, b, m); };
const read = (p) => R.read(S.demoPack(p));

const counts = {};
for (const p of ["baseline", "attack", "surge"]) {
  const rd = read(p);
  counts[p] = rd.events.length;
  check(rd.skipped, 0, p + ": every record reads");
  check(AL.run(rd.events).map((a) => a.rule), S.demoPackAlarms[p], p + ": alarms");
  check(JSON.stringify(S.demoPack(p)) === JSON.stringify(S.demoPack(p)), true, p + ": deterministic");
  check(rd.events.every((e) => e.iso >= "2026-11-22T09:00:00Z" && e.iso < "2026-11-22T12:00:00Z"), true, p + ": inside 09:00 to 12:00");
  check(new Set(rd.events.map((e) => e.id)).size, rd.events.length, p + ": unique eventIDs");
}
check(counts.attack - counts.baseline, 12, "attack adds twelve events to the normal day");
check(counts.surge > 5 * counts.baseline, true, "surge: many more origin fetches");

// the attack's story, as the alarms tell it
const atk = AL.run(read("attack").events);
check(atk.find((a) => a.rule === "refused-burst").events.length, 6, "six refused sign-ins in one burst");
check(atk.find((a) => a.rule === "new-network").events[0].action, "AssumeRoleWithWebIdentity", "new network: the accepted sign-in, not the refused ones");
check(atk.find((a) => a.rule === "new-network").events[0].from.net, "203.0.113.0/24", "new network is the attacker's /24");
check(atk.find((a) => a.rule === "hub-stack-change-applied").events[0].targets[0].name, "sws-aws-platform", "the hub's stack");
// surge: most origin fetches go to one vault's files
const sg = read("surge").events.filter((e) => e.action === "GetObject" && e.who.via === "cloudfront.amazonaws.com");
check(sg.filter((e) => e.raw.requestParameters.key === "vault/vault-demo-001/files").length > sg.length / 2, true, "surge: one vault is hot");
// privacy: the graph never gets an address
check(read("attack").events.map(R.forGraph).some((e) => JSON.stringify(e).includes("203.0.113.66")), false, "attacker's address never reaches the graph");
console.log("ok ct-packs: 3 packs (baseline " + counts.baseline + ", attack " + counts.attack + ", surge " + counts.surge + " events), " + cases + " cases; attack gives " + S.demoPackAlarms.attack.length + " alarms");
