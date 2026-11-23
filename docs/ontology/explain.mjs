#!/usr/bin/env node
// The "connected to" panel for one asset, as plain text, read from a twin graph: what a first-time user should
// see when they open a node (ontology doc, "What a user gets from this"). A reference for the UIs, not a UI.
// ontology.aws.a@SovereignWebsite.dinis, 23 Nov 2026.
//
//   node docs/ontology/explain.mjs <node id or label> [--pack attack|surge]
//   node docs/ontology/explain.mjs --check      every node explains, and every relation has both readings
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Each relation read from either end (ontology doc, section 3 and later), so the panel reads naturally both ways.
const READ = {
  in: ["is in", "contains"], holds: ["holds", "is held by"], made_by: ["was made by", "made"],
  writes_to: ["writes to", "receives from"], logs_to: ["sends its logs to", "receives logs from"],
  serves_from: ["serves from", "is the origin of"], packages: ["is the code of", "runs code from"],
  trusts: ["trusts", "is trusted by"], allows_subject: ["may be assumed by", "may assume"],
  has_policy: ["has", "is attached to"], acted_as: ["was done as", "did"], acted_on: ["acted on", "was acted on by"],
  records: ["records", "is recorded in"], refers_to: ["names", "is named in"], part_of: ["is part of", "is made of"],
  signed_in_via: ["signed in via", "was used to sign in for"], seen_in: ["is seen in", "shows"],
  targeted: ["targeted", "was targeted by"], runs_as: ["runs as", "is the role of"],
  transforms_with: ["transforms records with", "transforms records for"],
};
const HOW = { api: "AWS answered", template: "the stack's template says", content: "read from inside a file",
  naming: "guessed from a name", comment: "only a code comment says", curated: "the ontologist says" };

const args = process.argv.slice(2);
const pack = args.includes("--pack") ? args[args.indexOf("--pack") + 1] : "baseline";
const file = join(HERE, pack === "baseline" ? "twin-graph.json" : "twin-graph." + pack + ".json");
const g = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(g.nodes.map((n) => [n.id, n]));
const name = (n) => n.type === "object" ? n.label.split("/").pop() : n.label;

function panel(n) {
  const facts = Object.entries(n).filter(([k]) => !["id", "type", "label", "altitude", "trust", "backend", "note", "cfn_type"].includes(k))
    .map(([k, v]) => k.replace(/_/g, " ") + ": " + (typeof v === "object" ? JSON.stringify(v) : v));
  const out = [n.label + "  (" + n.type.replace(/_/g, " ") + ", " + n.altitude + ", " + n.trust + (n.backend === "twin" ? ", synthetic" : "") + ")"];
  if (n.note) out.push("  note: " + n.note);
  if (facts.length) out.push("  " + facts.join("; "));
  const lines = [];
  for (const e of g.edges) {
    const fwd = e.from === n.id, back = e.to === n.id;
    if (!fwd && !back) continue;
    const other = byId.get(fwd ? e.to : e.from);
    const words = READ[e.rel][fwd ? 0 : 1];
    const mark = e.trust === "verified" ? "  " : e.trust === "curated" ? "~ " : "? ";
    lines.push({ g: e.trust + "|" + words + "|" + other.type + "|" + e.evidence + "|" + e.source, mark, words, otype: other.type.replace(/_/g, " "), oname: name(other), how: HOW[e.evidence] + ": " + e.source,
      k: (e.trust === "verified" ? 0 : e.trust === "curated" ? 2 : 1) + words + name(other),
      t: mark + words + " " + name(other) + " (" + other.type.replace(/_/g, " ") + ")   [" + HOW[e.evidence] + ": " + e.source + "]" });
  }
  lines.sort((a, b) => (a.k < b.k ? -1 : 1));
  // More than three links of the same kind read as one line with a count, first and last: a user wants
  // "holds 9 log files", not nine rows.
  const groups = [];
  for (const l of lines) {
    const last = groups[groups.length - 1];
    if (last && last.g === l.g) last.items.push(l); else groups.push({ g: l.g, items: [l] });
  }
  for (const gr of groups) {
    if (gr.items.length <= 3) out.push(...gr.items.map((l) => "  " + l.t));
    else { const f = gr.items[0], z = gr.items[gr.items.length - 1];
      out.push("  " + f.mark + f.words + " " + gr.items.length + " " + f.otype + "s: " + f.oname + " ... " + z.oname + "   [" + f.how + "]"); }
  }
  out.push("  (no mark: AWS confirmed;  ?: claimed, from files or names, check before acting;  ~: the ontologist's word)");
  return out.join("\n");
}

if (args.includes("--check")) {
  const missing = Object.keys(READ).length && [...new Set(g.edges.map((e) => e.rel))].filter((r) => !READ[r] || READ[r].length !== 2);
  if (missing.length) { console.error("relations without both readings: " + missing.join(", ")); process.exit(1); }
  g.nodes.forEach(panel);
  console.log("explain: " + g.nodes.length + " nodes, " + Object.keys(READ).length + " relations read both ways (" + pack + ")");
} else {
  const q = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--pack");
  const n = byId.get(q) || g.nodes.find((x) => x.label === q) || g.nodes.find((x) => q && x.label.includes(q));
  if (!n) { console.error("no node matches: " + q); process.exit(2); }
  console.log(panel(n));
}
