// Screenshot mode (Dinis Cruz, 23 Nov 2026: "can you add a screenshot mode, that masks sensitive data on the
// page"). While it is on, the page hides AWS account IDs, email addresses, the Google account ID and costs,
// in everything shown, including text that appears later; optionally it also blurs bucket and file names.
// Display only: nothing is changed in AWS or in what the page keeps, and turning it off restores the text.
(function () {
  "use strict";
  var KEY = "sws-aws-screenshot", on = false, names = false;
  var original = new WeakMap();
  var RULES = [
    [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "•••@•••"],            // email addresses
    [/\b\d{19,21}\b/g, function (m) { return "•".repeat(m.length); }],                    // Google account IDs
    [/(^|[^\d])(\d{12})(?=[^\d]|$)/g, function (m, a) { return a + "•".repeat(12); }],    // AWS account IDs
    [/\b\d[\d,]*\.\d{2}(\s?(?:USD|EUR|GBP))/g, function (m, cur) { return "•••" + cur; }] // costs
  ];
  function maskText(t) {
    RULES.forEach(function (r) { t = t.replace(r[0], r[1]); });
    return t;
  }
  function maskNode(n) {
    if (n.nodeType !== 3 || !n.nodeValue || !n.nodeValue.trim()) return;
    var p = n.parentNode; if (p && (p.nodeName === "SCRIPT" || p.nodeName === "STYLE")) return;
    var src = original.has(n) ? original.get(n) : n.nodeValue;
    // an element marked data-mask (the Google account ID) is hidden whole, whatever it holds
    var whole = p && p.closest && p.closest("[data-mask]");
    var masked = whole ? "\u2022".repeat(Math.min(src.length, 24)) : maskText(src);
    if (masked !== src) { if (!original.has(n)) original.set(n, src); if (n.nodeValue !== masked) n.nodeValue = masked; }
  }
  function walk(root) {
    if (root.nodeType === 3) return maskNode(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) maskNode(n);
  }
  function restore() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) if (original.has(n)) { n.nodeValue = original.get(n); original.delete(n); }
  }
  var observer = new MutationObserver(function (list) {
    if (!on) return;
    list.forEach(function (m) {
      if (m.type === "characterData") maskNode(m.target);
      else Array.prototype.forEach.call(m.addedNodes, walk);
    });
  });
  function inputs() {
    Array.prototype.forEach.call(document.querySelectorAll("#acct-id, #paste-accounts"), function (i) { i.classList.toggle("masked-input", on); });
  }
  function apply() {
    document.body.classList.toggle("screenshot", on);
    document.body.classList.toggle("screenshot-names", on && names);
    var b = document.getElementById("screenshot-toggle"); if (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); b.textContent = on ? "Screenshot mode: on" : "Screenshot mode"; }
    var bar = document.getElementById("screenshot-bar"); if (bar) bar.hidden = !on;
    var cb = document.getElementById("screenshot-names"); if (cb) cb.checked = names;
    inputs();
    if (on) { walk(document.body); observer.observe(document.body, { subtree: true, childList: true, characterData: true }); }
    else { observer.disconnect(); restore(); }
    try { localStorage.setItem(KEY, JSON.stringify({ on: on, names: names })); } catch (e) { /* none */ }
  }
  function init() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || "{}"); on = !!s.on; names = !!s.names; } catch (e) { /* none */ }
    var b = document.getElementById("screenshot-toggle"); if (b) b.onclick = function () { on = !on; apply(); };
    var cb = document.getElementById("screenshot-names"); if (cb) cb.onchange = function () { names = cb.checked; apply(); };
    apply();
  }
  window.ScreenshotMode = { maskText: maskText };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
