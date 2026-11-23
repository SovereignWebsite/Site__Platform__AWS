// Colour coding: each known language yields the expected kinds of spans, the text is kept exactly,
// and markup in a file stays text.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ctx = {}; ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(new URL("../site/highlight.js", import.meta.url), "utf8"), ctx);
// a tiny DOM: enough for createElement / createTextNode / appendChild / textContent
const doc = { createTextNode: (t) => ({ text: t }), createElement: (tag) => ({ tag, kids: [], className: "", set textContent(v) { this.kids = [{ text: v }]; }, appendChild(k) { this.kids.push(k); } }) };
const flat = (n) => n.text !== undefined ? n.text : n.kids.map(flat).join("");
const kinds = (pre) => new Set(pre.kids.filter((k) => k.tag).map((k) => k.className));
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const cases = {
  "t.yaml": ['AWSTemplateFormatVersion: "2010-09-09"\n# note\nParameters:\n  Count: 3\n  On: true\n  - item\n', ["t-key", "t-str", "t-com", "t-num", "t-lit"]],
  "t.py": ['def f(x):\n    # c\n    return "s" + 1\n', ["t-kw", "t-com", "t-str", "t-num"]],
  "t.js": ['const a = `x`; // c\nif (a) return 2;\n', ["t-kw", "t-str", "t-com", "t-num"]],
  "t.sh": ['export A=1 # c\necho $A ${B} "s"\n', ["t-kw", "t-com", "t-str", "t-var"]],
  "t.toml": ['[tool]\nname = "x" # c\n', ["t-tag", "t-key", "t-str", "t-com"]],
  "t.html": ['<!-- c --><a href="x">t</a>', ["t-com", "t-tag", "t-key", "t-str"]],
  "t.sql": ["SELECT a FROM t WHERE b = 'x' -- c\n", ["t-kw", "t-str", "t-com"]],
  "t.md": ["# Title\n**bold** `code` [l](u)\n", ["t-tag", "t-kw", "t-str", "t-fn"]],
  "t.log": ["2026-11-23 01:00:00 ERROR boom\nWARN x\n", ["t-num", "t-bad", "t-warn"]]
};
for (const [name, [text, want]] of Object.entries(cases)) {
  const pre = ctx.Highlight.highlight(name, text, doc);
  if (!pre) fail(name + ": not highlighted");
  if (flat(pre) !== text) fail(name + ": text changed");
  const got = kinds(pre); for (const w of want) if (!got.has(w)) fail(name + ": no " + w + " in " + [...got]);
}
if (ctx.Highlight.highlight("x.bin", "abc", doc) !== null) fail("unknown type coloured");
const evil = '<img src=x onerror="alert(1)">';
const e = ctx.Highlight.highlight("e.html", evil, doc); if (flat(e) !== evil || e.kids.some((k) => k.tag && k.tag !== "span")) fail("markup not kept as text");
console.log("OK (highlight: yaml, py, js, sh, toml, html, sql, md, log)");
