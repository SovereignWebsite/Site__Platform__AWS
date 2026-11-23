// Simple colour coding for known text files (Dinis Cruz, 23 Nov 2026: "can you add simple color coding to known
// file[s] like [YAML] and json"). One ordered set of patterns per language; the text is cut into spans built
// as DOM nodes (textContent), never HTML, so a file's contents can never run. Large files are shown plain.
(function (root) {
  "use strict";
  var MAX = 300 * 1024;
  var STR = "\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'";
  var NUM = "\\b-?(?:0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b";
  function kw(words) { return "\\b(?:" + words.split(" ").join("|") + ")\\b"; }
  // Each rule: [class, pattern]. Earlier rules win.
  var LANGS = {
    yaml: [["com", "#.*"], ["key", "^[ \\t-]*[^\\s#:'\"][^:#\\n]*?(?=:(?:\\s|$))"], ["str", STR], ["tag", "!\\w+"],
      // literals and numbers only as a whole value (after "key:" or "- "), not inside prose
      ["lit", "(?<=(?::|^\\s*-)\\s*)(?:true|false|null|yes|no|on|off|True|False|Null|~)(?=\\s*(?:#|$))"],
      ["num", "(?<=(?::|^\\s*-)\\s*)-?\\d+(?:\\.\\d+)?(?=\\s*(?:#|$))"], ["punc", "^\\s*-(?=\\s)|[|>][-+]?$"]],
    json: [["key", "\"(?:[^\"\\\\\\n]|\\\\.)*\"(?=\\s*:)"], ["str", STR], ["lit", kw("true false null")], ["num", NUM]],
    js: [["com", "//.*|/\\*[\\s\\S]*?\\*/"], ["str", STR + "|`(?:[^`\\\\]|\\\\.)*`"],
      ["kw", kw("const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false interface type enum implements public private readonly")], ["num", NUM]],
    py: [["com", "#.*"], ["str", "\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?'''|[rbfu]?(?:" + STR + ")"],
      ["kw", kw("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield None True False self async await global nonlocal assert del")], ["fn", "@[\\w.]+"], ["num", NUM]],
    sh: [["com", "#.*"], ["str", STR], ["var", "\\$\\{[^}]*\\}|\\$\\w+"],
      ["kw", kw("if then else elif fi for in do done while case esac function return export local set echo exit")], ["num", NUM]],
    ini: [["com", "[#;].*"], ["tag", "^\\s*\\[[^\\]\\n]*\\]"], ["key", "^\\s*[\\w.\\-\"']+(?=\\s*=)"], ["str", STR], ["lit", kw("true false")], ["num", NUM]],
    xml: [["com", "<!--[\\s\\S]*?-->"], ["tag", "</?[\\w:.-]+|/?>"], ["key", "\\b[\\w:.-]+(?==)"], ["str", STR]],
    css: [["com", "/\\*[\\s\\S]*?\\*/"], ["str", STR], ["key", "[\\w-]+(?=\\s*:[^{]*;)"], ["tag", "[.#]?[\\w-]+(?=[^{};]*\\{)"], ["num", NUM + "(?:px|em|rem|%|vh|vw|s|ms)?"]],
    sql: [["com", "--.*|/\\*[\\s\\S]*?\\*/"], ["str", STR],
      ["kw", "(?i)\\b(?:select|from|where|and|or|not|insert|into|values|update|set|delete|create|table|drop|alter|join|left|right|inner|outer|on|group|by|order|having|limit|as|null|is|in|like|distinct|union|all|primary|key|index|view)\\b"], ["num", NUM]],
    md: [["tag", "^#{1,6} .*"], ["kw", "\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__"], ["str", "`[^`\\n]+`"], ["fn", "\\[[^\\]\\n]*\\]\\([^)\\n]*\\)"], ["com", "^>.*"]],
    log: [["bad", "\\b(?:ERROR|FATAL|CRITICAL|Error|Exception|Traceback)\\b.*"], ["warn", "\\b(?:WARN|WARNING)\\b"], ["num", "\\b\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?Z?\\b"], ["str", STR]]
  };
  var EXT = { yaml: "yaml", yml: "yaml", json: "json", geojson: "json", js: "js", mjs: "js", cjs: "js", ts: "js", tsx: "js", jsx: "js",
    py: "py", sh: "sh", bash: "sh", zsh: "sh", toml: "ini", ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "ini",
    xml: "xml", html: "xml", htm: "xml", svg: "xml", plist: "xml", css: "css", scss: "css", sql: "sql", md: "md", markdown: "md", log: "log" };

  function compile(rules) {
    var flags = "gm", src = rules.map(function (r) {
      var p = r[1]; if (p.indexOf("(?i)") === 0) { p = p.slice(4); flags = "gmi"; }
      return "(" + p + ")"; // every pattern uses only non-capturing groups, so group i is rule i
    }).join("|");
    return new RegExp(src, flags);
  }
  var cache = {};
  function langFor(name) {
    var n = name.toLowerCase(), base = n.split("/").pop();
    if (base === "dockerfile" || base === "makefile") return "sh";
    return EXT[(base.split(".").pop() || "")] || null;
  }
  // Returns a <pre> with coloured spans, or null if the language is unknown or the text too large.
  function highlight(name, text, doc) {
    var lang = langFor(name); if (!lang || text.length > MAX) return null;
    var rules = LANGS[lang], re = cache[lang] || (cache[lang] = compile(rules));
    var pre = doc.createElement("pre"); pre.className = "code lang-" + lang;
    var last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      if (m.index > last) pre.appendChild(doc.createTextNode(text.slice(last, m.index)));
      for (var i = 1; i < m.length; i++) if (m[i] !== undefined) break;
      var s = doc.createElement("span"); s.className = "t-" + rules[i - 1][0]; s.textContent = m[0];
      pre.appendChild(s); last = m.index + m[0].length;
    }
    if (last < text.length) pre.appendChild(doc.createTextNode(text.slice(last)));
    return pre;
  }
  root.Highlight = { highlight: highlight, langFor: langFor };
})(typeof window !== "undefined" ? window : globalThis);
