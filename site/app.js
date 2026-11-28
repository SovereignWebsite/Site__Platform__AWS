// AWS Platform Sovereign Website: sign in with Google, get one-hour AWS credentials from STS,
// read an account, and apply a plan only after the owner approves it.
// Tokens and credentials live in this page's memory only: never stored, logged or sent anywhere
// but to Google and AWS. Account IDs are kept on this device only (localStorage), never on the page.
(function () {
  "use strict";
  var cfg = window.SITE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var mem = { idToken: null, claims: null, creds: {} }; // creds[accountId + role] = { ... expiration }
  var STORE = "sws-aws-accounts";

  function say(el, text, cls) { el.textContent = text; el.className = "status " + (cls || ""); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }

  // ---- Tabs (the chosen one is remembered in this browser; a convenience only) ----
  var currentTab = "accounts";
  try { currentTab = localStorage.getItem("sws-aws-tab") || "accounts"; } catch (e) { /* none */ }
  function setTab(name) {
    currentTab = name;
    try { localStorage.setItem("sws-aws-tab", name); } catch (e) { /* none */ }
    Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (b) { var on = b.getAttribute("data-tab") === name; b.setAttribute("aria-selected", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-panel]"), function (p) { p.classList.toggle("off", !!mem.idToken && p.getAttribute("data-panel") !== name); });
    if (window.Consoles) Consoles.opened(name);
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (b) { b.onclick = function () { setTab(b.getAttribute("data-tab")); }; });
  // Arrow keys move between tabs (WAI-ARIA tabs pattern); only the selected tab is in the Tab order.
  $("tabs").addEventListener("keydown", function (ev) {
    var all = Array.prototype.slice.call(document.querySelectorAll("[data-tab]")), i = all.indexOf(document.activeElement);
    if (i < 0) return;
    var j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[ev.key];
    if (j === undefined) return;
    ev.preventDefault(); j = (j + all.length) % all.length; all[j].focus(); setTab(all[j].getAttribute("data-tab"));
  });

  // ---- Twin mode: a synthetic AWS (twin.js) behind the same calls; its own identity and accounts ----
  var TWIN = window.AwsTransport && AwsTransport.isTwin();
  function rec(name) { return TWIN ? "twin-" + name : name; }
  // The twin opens on S3, where its synthetic data is (sherpa.aws.c, walk 02).
  if (TWIN) currentTab = "s3";
  function b64u(o) { return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function twinToken() { return b64u({ alg: "none", typ: "JWT" }) + "." + b64u({ sub: "000000000000000000001", name: "Twin visitor", email: "visitor@twin.example", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".twin"; }
  function enterTwin(on) { AwsTransport.setTwin(on); location.href = location.pathname + (on ? "?twin" : "?aws"); }

  // ---- Step 1: Google sign-in (Google Identity Services; the ID token stays in memory) ----
  function decodeJwt(t) {
    var p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  }
  // Keep the session across a refresh, sealed with this device's key (sealed-store.js). Expired parts are dropped.
  function persist() {
    if (!window.SealedStore || !SealedStore.available() || !mem.idToken) return Promise.resolve();
    // Change-role credentials are never sealed (security.aws.c, R-003): after a reload, changing AWS needs a
    // fresh assume. Only the ID token and read-role credentials are kept.
    var keep = {}, exp = mem.claims.exp * 1000;
    Object.keys(mem.creds).forEach(function (k) { if (!/\/sws-aws-platform-change$/.test(k)) { keep[k] = mem.creds[k]; exp = Math.max(exp, mem.creds[k].expiration); } });
    return SealedStore.seal(rec("session"), { idToken: mem.idToken, creds: keep }, exp).catch(function () { /* memory only */ });
  }
  function restore() {
    if (!window.SealedStore || !SealedStore.available()) return Promise.resolve();
    return SealedStore.open(rec("session")).then(function (s) {
      if (!s) return;
      var now = Date.now();
      // Change-role credentials are never restored, even from a record an older build sealed (security R-013 a).
      Object.keys(s.creds || {}).forEach(function (k) { if (!/\/sws-aws-platform-change$/.test(k) && s.creds[k].expiration - now > 60 * 1000) mem.creds[k] = s.creds[k]; });
      if (s.idToken && decodeJwt(s.idToken).exp * 1000 - now > 60 * 1000) showSignedIn(s.idToken, true);
      else if (Object.keys(mem.creds).length) { $("who").textContent = "Your Google sign-in has expired; AWS credentials still valid are kept until they end. Sign in again for new ones."; $("step1-done").hidden = false; renderAccounts(); }
    }).catch(function () {});
  }
  function onGoogle(resp) { showSignedIn(resp.credential, false); persist(); }
  function showSignedIn(token, restored) {
    mem.idToken = token;
    mem.claims = decodeJwt(token);
    $("restored").hidden = !restored;
    $("signed-out-hero").hidden = true;
    scheduleRenew();
    $("who").textContent = (mem.claims.name ? mem.claims.name + " \u00b7 " : "") + (mem.claims.email || "your Google account");
    $("avatar").textContent = ((mem.claims.name || mem.claims.email || "?").trim()[0] || "?").toUpperCase();
    $("tabs").hidden = false; setTab(currentTab);
    $("sub").textContent = mem.claims.sub;
    $("step1-done").hidden = false;
    renderAccounts();
  }
  // Automatic sign-in (Dinis, 23 Nov 2026: "make it so it sends these automatically when it knows me so I
  // don't have to click"): with auto_select, Google signs the owner in without a click when this browser has
  // signed in here before and has one such account; a minute before the ID token ends, it is asked again.
  // Sign out turns it off (disableAutoSelect) until the next sign-in by hand.
  var gisReady, renewTimer = null;
  function autoSignIn() {
    if (TWIN) { if (!mem.idToken) { showSignedIn(twinToken(), false); persist(); } return; }
    if (mem.idToken || !window.google || !google.accounts) return;
    google.accounts.id.prompt();
  }
  function scheduleRenew() {
    if (renewTimer) clearTimeout(renewTimer);
    if (!mem.claims) return;
    var wait = mem.claims.exp * 1000 - Date.now() - 60 * 1000;
    renewTimer = setTimeout(function () { mem.idToken = null; $("signed-out-hero").hidden = false; autoSignIn(); }, Math.max(wait, 0));
  }
  function initGoogle() {
    if (TWIN) { gisReady = Promise.resolve(); return; }
    if (!cfg.googleClientId) { $("no-client").hidden = false; gisReady = Promise.resolve(); return; }
    var ready;
    gisReady = new Promise(function (r) { ready = r; });
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = function () {
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogle, auto_select: true, use_fedcm_for_prompt: true, cancel_on_tap_outside: false });
      google.accounts.id.renderButton($("google-button"), { theme: "outline", size: "large", text: "signin_with" });
      ready();
    };
    document.head.appendChild(s);
  }

  // ---- Accounts, on this device only ----
  // Account IDs are sealed in the sealed store too (kept ten years; Forget this device deletes them).
  var TEN_YEARS = 10 * 365 * 24 * 3600 * 1000;
  var accounts = [];
  function saveAccounts(a) {
    if (TWIN) return Promise.resolve();
    if (window.SealedStore && SealedStore.available()) return SealedStore.seal("accounts", a, Date.now() + TEN_YEARS).catch(function () {});
  }
  function loadAccounts() {
    if (TWIN) { accounts = [{ id: AwsTwin.account, label: "Twin account (synthetic)", ready: true, twin: true }]; return Promise.resolve(); }
    var old = null;
    try { old = JSON.parse(localStorage.getItem(STORE) || "null"); localStorage.removeItem(STORE); } catch (e) { /* none */ }
    if (!window.SealedStore || !SealedStore.available()) { accounts = old || []; return Promise.resolve(); }
    return SealedStore.open("accounts").then(function (a) {
      accounts = a || old || [];
      if (old && !a) saveAccounts(accounts);
    }).catch(function () { accounts = old || []; });
  }

  function roleArn(acct, role) { return "arn:aws:iam::" + acct.id + ":role/" + role; }

  // ---- STS: the Google ID token for one-hour credentials (an unsigned call) ----
  function xmlText(doc, tag) { var n = doc.getElementsByTagName(tag)[0]; return n ? n.textContent : ""; }
  function awsError(doc, status) {
    return new Error((xmlText(doc, "Code") || ("HTTP " + status)) + ": " + (xmlText(doc, "Message") || "no message"));
  }
  var pending = {};
  function assume(acct, role) {
    var key = acct.id + "/" + role, c = mem.creds[key];
    if (c && c.expiration - Date.now() > 5 * 60 * 1000) return Promise.resolve(c);
    if (!mem.idToken) return Promise.reject(new Error("Sign in with Google first."));
    if (pending[key]) return pending[key]; // one STS call for callers asking at the same time
    var p = assumeNow(acct, role, key);
    pending[key] = p;
    p.then(function () { delete pending[key]; }, function () { delete pending[key]; });
    return p;
  }
  function assumeNow(acct, role, key) {
    var c;
    var body = new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: roleArn(acct, role),
      RoleSessionName: "sws-aws-platform", WebIdentityToken: mem.idToken, DurationSeconds: "3600"
    }).toString();
    var asked = mem.idToken;
    return AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, doc: new DOMParser().parseFromString(t, "text/xml") }; }); })
      .then(function (x) {
        if (!x.ok) throw awsError(x.doc, x.status);
        c = { accessKeyId: xmlText(x.doc, "AccessKeyId"), secretAccessKey: xmlText(x.doc, "SecretAccessKey"),
              sessionToken: xmlText(x.doc, "SessionToken"), expiration: Date.parse(xmlText(x.doc, "Expiration")) };
        // Signed out (or signed in as someone else) while STS answered: drop them (security R-013 b).
        if (mem.idToken !== asked) throw new Error("Signed out while AWS was answering; nothing kept.");
        mem.creds[key] = c;
        persist();
        return c;
      });
  }

  // ---- Signed calls (query API for STS and IAM, JSON for Cost Explorer) ----
  function queryCall(creds, host, service, params) {
    var url = "https://" + host + "/", body = new URLSearchParams(params).toString();
    var headers = { "content-type": "application/x-www-form-urlencoded; charset=utf-8" };
    return SigV4.sign({ method: "POST", url: url, headers: headers, body: body }, creds, "us-east-1", service)
      .then(function (h) { return AwsTransport.fetch(url, { method: "POST", headers: h, body: body }); })
      .then(function (r) { return r.text().then(function (t) { var d = new DOMParser().parseFromString(t, "text/xml"); if (!r.ok) throw awsError(d, r.status); return d; }); });
  }
  function jsonCall(creds, host, service, target, payload, region, jsonVersion) {
    var url = "https://" + host + "/", body = JSON.stringify(payload);
    var headers = { "content-type": "application/x-amz-json-" + (jsonVersion || "1.1"), "x-amz-target": target };
    return SigV4.sign({ method: "POST", url: url, headers: headers, body: body }, creds, region || "us-east-1", service)
      .then(function (h) { return AwsTransport.fetch(url, { method: "POST", headers: h, body: body }); })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.__type || r.status) + ": " + (j.message || j.Message || "")); return j; }); });
  }
  function getRole(creds, name) {
    return queryCall(creds, "iam.amazonaws.com", "iam", { Action: "GetRole", Version: "2010-05-08", RoleName: name })
      .then(function (d) { return JSON.parse(decodeURIComponent(xmlText(d, "AssumeRolePolicyDocument"))); });
  }

  // ---- Step 2: accounts: set up (CloudFormation) and read ----
  function templateWithDefaults(text) {
    return text
      .replace(/(\n  GoogleClientId:\n    Type: String\n)/, "$1    Default: \"" + cfg.googleClientId + "\"\n")
      .replace(/(\n  GoogleSub:\n    Type: String\n)/, "$1    Default: \"" + mem.claims.sub + "\"\n");
  }
  function setupLinks(acct) {
    var box = el("div", { class: "setup" });
    var region = "us-east-1";
    if (cfg.templateUrl) {
      var q = "#/stacks/quickcreate?templateURL=" + encodeURIComponent(cfg.templateUrl) + "&stackName=sws-aws-platform" +
        "&param_GoogleClientId=" + encodeURIComponent(cfg.googleClientId) + "&param_GoogleSub=" + encodeURIComponent(mem.claims.sub);
      box.appendChild(el("a", { class: "button", target: "_blank", rel: "noopener",
        href: "https://" + region + ".console.aws.amazon.com/cloudformation/home?region=" + region + q, text: "Set up this account in AWS" }));
      box.appendChild(el("p", { class: "small", text: "Opens CloudFormation in your AWS console with the template and your Google ID filled in. Sign in to that account, tick that the stack creates IAM roles, and press Create stack." }));
    } else {
      var dl = el("button", { type: "button", text: "1. Download this account's template" });
      dl.onclick = function () {
        acct.sub = mem.claims.sub; saveAccounts(accounts);
        fetch("cloudformation/bootstrap.yaml").then(function (r) { return r.text(); }).then(function (t) {
          var a = el("a", { download: "sws-aws-platform.yaml", href: URL.createObjectURL(new Blob([templateWithDefaults(t)], { type: "text/yaml" })) });
          document.body.appendChild(a); a.click(); a.remove();
        });
      };
      box.appendChild(dl);
      box.appendChild(el("a", { class: "button", target: "_blank", rel: "noopener",
        href: "https://" + region + ".console.aws.amazon.com/cloudformation/home?region=" + region + "#/stacks/create", text: "2. Open CloudFormation in AWS" }));
      box.appendChild(el("p", { class: "small", text: "Choose Upload a template file, pick the file, name the stack sws-aws-platform; both parameters are already filled in. Tick that the stack creates IAM roles and press Create stack. This is the one console visit; after it, everything happens here." }));
    }
    return box;
  }

  function stat(k, v) { return el("div", { class: "stat" }, [el("span", { class: "k", text: k }), el("span", { class: "v", text: v })]); }
  function wrongGoogle(acct) { return acct.sub && mem.claims && acct.sub !== mem.claims.sub; }
  function readAccount(acct, out, onReady) {
    out.textContent = ""; var st = el("p", { class: "status", text: "Asking STS for one-hour read-only credentials..." }); out.appendChild(st);
    assume(acct, "sws-aws-platform-read").then(function (c) {
      return queryCall(c, "sts.amazonaws.com", "sts", { Action: "GetCallerIdentity", Version: "2011-06-15" }).then(function (d) {
        if (!acct.ready || acct.sub !== mem.claims.sub) { acct.ready = true; acct.sub = mem.claims.sub; saveAccounts(accounts); if (onReady) onReady(); }
        var arn = xmlText(d, "Arn"), stats = el("div", { class: "stats" }, [stat("Role", (arn.split(":assumed-role/")[1] || arn).split("/")[0]), stat("Until", new Date(c.expiration).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }))]);
        out.textContent = ""; out.appendChild(stats);
        var line = el("p", { class: "small", text: "Signed in to AWS as " + arn + "." }); out.appendChild(line);
        var now = new Date(), start = now.toISOString().slice(0, 8) + "01", end = now.toISOString().slice(0, 10);
        if (start === end) return;
        return jsonCall(c, "ce.us-east-1.amazonaws.com", "ce", "AWSInsightsIndexService.GetCostAndUsage",
          { TimePeriod: { Start: start, End: end }, Granularity: "MONTHLY", Metrics: ["UnblendedCost"] })
          .then(function (j) {
            var t = j.ResultsByTime && j.ResultsByTime[0] && j.ResultsByTime[0].Total.UnblendedCost;
            if (t) stats.appendChild(stat(TWIN ? "Cost this month so far (synthetic)" : "Cost this month so far", Number(t.Amount).toFixed(2) + " " + t.Unit));
          }, function (e) { stats.appendChild(stat("Cost this month", "not read (" + e.message + ")")); });
      });
    }).catch(function (e) {
      var hint = "";
      if (/AccessDenied|InvalidIdentityToken|not authorized/.test(e.message))
        hint = wrongGoogle(acct) ? " This account trusts the Google account ID ending " + acct.sub.slice(-6) + "; you are signed in as the one ending " + mem.claims.sub.slice(-6) + ". Sign out and sign in with that account."
          : " Has this account been set up with the Google account you are signed in with now (ID ending " + mem.claims.sub.slice(-6) + ")?";
      say(st, e.message + hint, "bad");
    });
  }

  function renderAccounts() {
    var list = $("accounts"); list.textContent = "";
    $("step2").hidden = !mem.idToken;
    var other = accounts.filter(wrongGoogle);
    $("identity-warning").hidden = !other.length;
    if (other.length) $("identity-warning").textContent = other.map(function (a) { return a.label; }).join(", ") + (other.length === 1 ? " was" : " were") + " set up with another Google account (ID ending " + other[0].sub.slice(-6) + "). You are signed in as the one ending " + mem.claims.sub.slice(-6) + ": sign out and sign in with that account to use " + (other.length === 1 ? "it." : "them.");
    accounts.forEach(function (acct, i) {
      var out = el("div", {});
      var read = el("button", { type: "button", text: "Read this account" });
      var rm = el("button", { type: "button", class: "quiet", text: "Forget" });
      rm.onclick = function () { accounts.splice(i, 1); saveAccounts(accounts); renderAccounts(); renderPlans(); };
      var setup = acct.twin ? el("p", { class: "small", text: "A synthetic account: already set up, nothing to do in AWS. It is read for you here; its buckets are on the S3 tab." }) : setupLinks(acct);
      if (acct.ready && !acct.twin) setup = el("details", { class: "setup-again" }, [el("summary", { text: "Set up again (CloudFormation)" }), setup]);
      var badge = wrongGoogle(acct) ? el("span", { class: "badge warn", text: "other Google account" }) : acct.ready ? el("span", { class: "badge ok", text: "set up" }) : el("span", { class: "badge", text: "not set up yet" });
      read.onclick = function () {
        readAccount(acct, out, function () {
          badge.className = "badge ok"; badge.textContent = "set up";
          if (setup.tagName !== "DETAILS" && !acct.twin) { var d = el("details", { class: "setup-again" }, [el("summary", { text: "Set up again (CloudFormation)" })]); setup.replaceWith(d); d.appendChild(setup); setup = d; }
          $("identity-warning").hidden = !accounts.filter(wrongGoogle).length;
        });
      };
      list.appendChild(el("li", {}, [el("div", { class: "card-head" }, [el("strong", { text: acct.label }), badge]),
        el("p", { class: "small" }, [document.createTextNode("Account ending "), el("span", { "data-mask": "", text: acct.id.slice(-4) })]),
        el("div", { class: "row" }, acct.twin ? [read] : [read, rm]), out, setup]));
      if (acct.twin && mem.idToken) read.onclick();
    });
    renderPlans();
    if (window.S3Browser) S3Browser.render();
    if (window.Consoles) Consoles.render();
    // No account yet (a new user, or a new browser): say what to do first, open on Accounts, and in every other tab
    // say why it is empty instead of showing an empty picker (Dinis's screenshots, 28 Nov 2026).
    var none = !!mem.idToken && !accounts.length && !TWIN;
    $("first-steps").hidden = !none;
    document.body.classList.toggle("no-accounts", none);
    Array.prototype.forEach.call(document.querySelectorAll("[data-panel]"), function (p) {
      var name = p.getAttribute("data-panel"), n = p.querySelector(".needs-account");
      if (name === "accounts" || name === "about") return;
      if (none && !n) {
        var go = el("button", { type: "button", text: "Add your AWS account" }); go.onclick = function () { setTab("accounts"); $("acct-label").focus(); };
        var tw = el("button", { type: "button", class: "quiet", text: "Try it on the twin" }); tw.onclick = function () { enterTwin(true); };
        n = el("div", { class: "card needs-account" }, [el("p", { text: "No AWS account is connected in this browser yet, so there is nothing to show here." }), el("div", { class: "row" }, [go, tw])]);
        var head = p.querySelector(".panel-head"); head.parentNode.insertBefore(n, head.nextSibling);
      }
      if (n) n.hidden = !none;
    });
    if (none && currentTab !== "accounts" && currentTab !== "about") currentTab = "accounts";
    setTab(currentTab);
  }
  $("copy-accounts").onclick = function () {
    var text = JSON.stringify(accounts.map(function (a) { return { label: a.label, id: a.id }; }));
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard")))
      .then(function () { say($("move-status"), "Copied " + accounts.length + " account" + (accounts.length === 1 ? "" : "s") + ".", "ok"); })
      .catch(function () { $("paste-accounts").value = text; say($("move-status"), "Copy it from the box below.", ""); });
  };
  $("import-accounts").onclick = function () {
    var list; try { list = JSON.parse($("paste-accounts").value); } catch (e) { return say($("move-status"), "That is not a list copied from this site.", "bad"); }
    if (!Array.isArray(list)) return say($("move-status"), "That is not a list copied from this site.", "bad");
    var added = 0;
    list.forEach(function (a) {
      var id = String(a && a.id || "").replace(/\D/g, "");
      if (id.length === 12 && !accounts.some(function (b) { return b.id === id; })) { accounts.push({ id: id, label: String(a.label || "AWS account").slice(0, 60) }); added++; }
    });
    saveAccounts(accounts); $("paste-accounts").value = ""; renderAccounts();
    say($("move-status"), added + " account" + (added === 1 ? "" : "s") + " added.", "ok");
  };
  $("add-account").onsubmit = function (ev) {
    ev.preventDefault();
    var id = $("acct-id").value.replace(/\D/g, ""), label = $("acct-label").value.trim() || "AWS account";
    if (id.length !== 12) { say($("add-status"), "An AWS account ID has 12 digits.", "bad"); return; }
    if (accounts.some(function (a) { return a.id === id; })) { say($("add-status"), "Already listed.", "bad"); return; }
    accounts.push({ id: id, label: label }); saveAccounts(accounts);
    $("acct-id").value = ""; $("acct-label").value = ""; say($("add-status"), "");
    renderAccounts();
  };

  // ---- Step 3: plans, applied only on the owner's click ----
  var plans = [];
  // Each plan checks AWS when shown: Waiting for you (it would change something) or Done (AWS already holds
  // what it asks for). Done plans move to the history below.
  function checkPlan(plan, acct) {
    return assume(acct, plan.role).then(function (c) {
      if (plan.action === "cloudformation.update_stack") {
        return Promise.all([
          cfn(c, { Action: "GetTemplate", StackName: plan.stack, TemplateStage: "Original" }).then(function (d) { return xmlText(d, "TemplateBody"); }),
          fetch(plan.template).then(function (r) { return r.text(); })
        ]).then(function (t) { return Plans.sameTemplate(t[0], t[1]) ? "done" : "waiting"; });
      }
      return getRole(c, plan.target_role).then(function (now) { return Plans.apply(now, plan).unchanged ? "done" : "waiting"; });
    });
  }
  var BADGE = { checking: ["badge", "checking..."], waiting: ["badge warn", "Waiting for you"], done: ["badge ok", "Done"],
    blocked: ["badge", "Not possible yet"], error: ["badge bad", "Could not check"] };
  var planChecks = [], planGen = 0;
  function recheckPlans() { planChecks.forEach(function (f) { f(); }); }
  function renderPlans() {
    planChecks = []; var gen = ++planGen;
    var box = $("plans"), hist = $("plans-done"); box.textContent = ""; hist.textContent = "";
    $("step3").hidden = !mem.idToken || !accounts.length;
    $("plans-history").hidden = true;
    function count() { var n = hist.children.length; $("plans-done-count").textContent = n; $("plans-history").hidden = !n; }
    plans.forEach(function (plan) {
      var sel = el("select", { "aria-label": "Account" }, accounts.map(function (a) { return el("option", { value: a.id, text: a.label }); }));
      var show = el("button", { type: "button", text: "Show the plan against this account" });
      var out = el("div", {}), st = el("p", { class: "status" }), badge = el("span", { class: "badge" });
      var li = el("li", { "data-plan": plan.id }, [el("div", { class: "card-head" }, [el("strong", { text: plan.title }), badge]), el("p", { class: "small", text: plan.why }),
        el("p", { class: "small", text: plan.summary || ("Adds: " + plan.add.join(", ") + ". Keeps " + plan.keep + ". Never touches " + plan.never + ".") }),
        el("div", { class: "row" }, [sel, show]), out, st]);
      function acct() { return accounts.filter(function (a) { return a.id === sel.value; })[0]; }
      function set(state, why) {
        if (gen !== planGen) return; // a check from an earlier drawing of the list: ignore it
        badge.className = BADGE[state][0]; badge.textContent = BADGE[state][1]; badge.title = why || "";
        var to = state === "done" ? hist : box;
        if (li.parentNode !== to) { to.appendChild(li); count(); }
      }
      function check() {
        if (!mem.idToken || !acct()) return;
        set("checking");
        checkPlan(plan, acct()).then(function (s) { set(s); }, function (e) { set(/^refused/.test(e.message) ? "blocked" : "error", e.message); });
      }
      show.onclick = function () { showPlan(plan, acct(), out, st, recheckPlans); };
      planChecks.push(check);
      sel.onchange = check;
      box.appendChild(li);
      check();
    });
    count();
  }
  // A diff: changed lines in colour with a few lines of context; long unchanged runs fold to "...".
  // norm: how two lines are compared. JSON diffs ignore a trailing comma; templates (YAML) compare lines exactly,
  // because there a comma can change meaning (security R-012).
  function jsonLine(l) { return l.replace(/,\s*$/, ""); }
  function diffView(a, b, norm) {
    // a line that differs only by its trailing comma (JSON lists) counts as unchanged
    var d = Plans.lineDiff(a, b, norm), pre = el("pre", { class: "diff" }), CTX = 3;
    var near = d.map(function () { return false; });
    d.forEach(function (x, i) { if (x.op !== " ") for (var k = Math.max(0, i - CTX); k <= Math.min(d.length - 1, i + CTX); k++) near[k] = true; });
    var skipped = 0;
    function flush() { if (skipped) { pre.appendChild(el("span", { class: "fold", text: "   ... " + skipped + " unchanged line" + (skipped === 1 ? "" : "s") + "\n" })); skipped = 0; } }
    d.forEach(function (x, i) {
      if (!near[i]) { skipped++; return; }
      flush();
      pre.appendChild(el("span", { class: x.op === "+" ? "add" : x.op === "-" ? "del" : "same", text: (x.op === " " ? "  " : x.op + " ") + x.line + "\n" }));
    });
    flush();
    return pre;
  }
  function showPlan(plan, acct, out, st, onApplied) {
    if (plan.action === "cloudformation.update_stack") return showStackPlan(plan, acct, out, st, onApplied);
    out.textContent = ""; say(st, "Reading the role as it is now, with the change role...");
    assume(acct, plan.role).then(function (c) {
      return getRole(c, plan.target_role).then(function (before) {
        var r = Plans.apply(before, plan);
        if (r.unchanged) return say(st, "Nothing to do: " + plan.target_role + " already " + (plan.add ? "trusts " + plan.add.join(", ") : "no longer trusts " + plan.remove.join(", ")) + ".", "ok");
        out.appendChild(el("h4", { text: "What changes (- removed, + added)" }));
        out.appendChild(diffView(JSON.stringify(before, null, 2), JSON.stringify(r.after, null, 2), jsonLine));
        out.appendChild(el("details", { class: "full" }, [el("summary", { text: "The whole policy, now and after" }),
          el("h4", { text: "Now" }), el("pre", { text: JSON.stringify(before, null, 2) }),
          el("h4", { text: "After you approve" }), el("pre", { text: JSON.stringify(r.after, null, 2) })]));
        var go = el("button", { type: "button", class: "approve", text: "Approve and apply to " + plan.target_role });
        go.onclick = function () {
          go.disabled = true; say(st, "Applying...");
          // Re-read first: if the role changed since the plan was shown, stop.
          getRole(c, plan.target_role).then(function (again) {
            if (!Plans.same(again, before)) throw new Error("The role changed since the plan was shown. Show the plan again.");
            return queryCall(c, "iam.amazonaws.com", "iam", { Action: "UpdateAssumeRolePolicy", Version: "2010-05-08",
              RoleName: plan.target_role, PolicyDocument: JSON.stringify(r.after) });
          }).then(function () {
            // Checked by reading the role back: it must hold the planned policy. IAM can take a few seconds to
            // show a change, so read up to five times.
            function readBack(n) {
              return getRole(c, plan.target_role).then(function (now) {
                if (Plans.same(now, r.after) || n >= 4) return now;
                return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return readBack(n + 1); });
              });
            }
            return readBack(0);
          }).then(function (now) {
            var ok = Plans.same(now, r.after);
            if (ok && onApplied) setTimeout(onApplied, 1500);
            say(st, ok ? (TWIN ? "Applied and checked in the twin (synthetic, not your AWS): " : "Applied and checked: ") + plan.target_role + (r.added ? " now trusts " + r.added.join(", ") : " no longer trusts " + r.removed.join(", ")) + "." : "Applied, but the role read back differs from the plan. Read it again.", ok ? "ok" : "bad");
          }).catch(function (e) { go.disabled = false; say(st, e.message, "bad"); });
        };
        out.appendChild(go);
        say(st, "This is the plan. Nothing has changed yet.", "");
      });
    }).catch(function (e) { say(st, e.message, "bad"); });
  }
  // A plan that updates this platform's own CloudFormation stack: the template AWS holds now beside the site's,
  // then AWS's own change set (what it will add, modify or replace), then Execute. Two approvals.
  var CFN = "cloudformation.us-east-1.amazonaws.com";
  function cfn(c, params) { params.Version = "2010-05-15"; return queryCall(c, CFN, "cloudformation", params); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pollChangeSet(c, plan, name, n) {
    return cfn(c, { Action: "DescribeChangeSet", StackName: plan.stack, ChangeSetName: name }).then(function (d) {
      var status = xmlText(d, "Status");
      if (/PENDING|IN_PROGRESS/.test(status) && n < 60) return wait(2000).then(function () { return pollChangeSet(c, plan, name, n + 1); });
      return d;
    });
  }
  function pollStack(c, plan, st, n) {
    return cfn(c, { Action: "DescribeStacks", StackName: plan.stack }).then(function (d) {
      var status = xmlText(d, "StackStatus");
      say(st, "Stack " + plan.stack + ": " + status);
      if (/IN_PROGRESS/.test(status) && n < 150) return wait(4000).then(function () { return pollStack(c, plan, st, n + 1); });
      return status;
    });
  }
  function showStackPlan(plan, acct, out, st, onApplied) {
    out.textContent = ""; say(st, "Reading the stack's template as it is now, with the change role...");
    assume(acct, plan.role).then(function (c) {
      return Promise.all([
        cfn(c, { Action: "GetTemplate", StackName: plan.stack, TemplateStage: "Original" }).then(function (d) { return xmlText(d, "TemplateBody"); }),
        fetch(plan.template).then(function (r) { return r.text(); })
      ]).then(function (t) {
        var before = t[0], after = t[1];
        if (Plans.sameTemplate(before, after)) return say(st, "Nothing to do: " + plan.stack + " already runs this site's template.", "ok");
        out.appendChild(el("h4", { text: "The template: what changes (- removed, + added)" })); out.appendChild(diffView(before, after));
        var go = el("button", { type: "button", class: "approve", text: "1. Approve: ask AWS what this will change" });
        go.onclick = function () {
          go.disabled = true; say(st, "Asking CloudFormation for a change set (nothing changes yet)...");
          var name = "sws-aws-platform-" + Date.now();
          var params = { Action: "CreateChangeSet", StackName: plan.stack, ChangeSetName: name, ChangeSetType: "UPDATE", TemplateBody: after,
            "Capabilities.member.1": "CAPABILITY_NAMED_IAM" };
          (plan.parameters || []).forEach(function (k, i) { params["Parameters.member." + (i + 1) + ".ParameterKey"] = k; params["Parameters.member." + (i + 1) + ".UsePreviousValue"] = "true"; });
          cfn(c, params).then(function () { return pollChangeSet(c, plan, name, 0); }).then(function (d) {
            if (xmlText(d, "Status") !== "CREATE_COMPLETE") throw new Error("Change set " + xmlText(d, "Status") + ": " + xmlText(d, "StatusReason"));
            var list = el("ul", {});
            Array.prototype.forEach.call(d.getElementsByTagName("ResourceChange"), function (rc) {
              var t = function (tag) { var n = rc.getElementsByTagName(tag)[0]; return n ? n.textContent : ""; };
              list.appendChild(el("li", { text: t("Action") + " " + t("LogicalResourceId") + " (" + t("ResourceType") + ")" + (t("Replacement") ? ", replacement: " + t("Replacement") : "") }));
            });
            out.appendChild(el("h4", { text: "AWS says this will change" })); out.appendChild(list);
            var run = el("button", { type: "button", class: "approve", text: "2. Approve: execute the change set" });
            run.onclick = function () {
              run.disabled = true; say(st, "Executing...");
              cfn(c, { Action: "ExecuteChangeSet", StackName: plan.stack, ChangeSetName: name })
                .then(function () { return pollStack(c, plan, st, 0); })
                .then(function (status) { if (/_COMPLETE$/.test(status) && !/ROLLBACK/.test(status) && onApplied) setTimeout(onApplied, 1500); say(st, /_COMPLETE$/.test(status) && !/ROLLBACK/.test(status) ? (TWIN ? "Applied and checked in the twin (synthetic, not your AWS): " : "Applied and checked: ") + plan.stack + " is " + status + "." : "Stack ended " + status + ": see its events in CloudFormation.", /ROLLBACK|FAILED/.test(status) ? "bad" : "ok"); })
                .catch(function (e) { run.disabled = false; say(st, e.message, "bad"); });
            };
            out.appendChild(run);
            say(st, "AWS's change set is ready. Nothing has changed yet.", "");
          }).catch(function (e) { go.disabled = false; say(st, e.message, "bad"); });
        };
        out.appendChild(go);
        say(st, "This is the plan. Nothing has changed yet.", "");
      });
    }).catch(function (e) { say(st, e.message + (/AccessDenied|not authorized/.test(e.message) ? " (The stack must run template v2 or later before it can update itself; the first update to v2 is made in the console.)" : ""), "bad"); });
  }

  fetch("plans/index.json").then(function (r) { return r.json(); }).then(function (ix) {
    return Promise.all(ix.plans.map(function (id) { return fetch("plans/" + id + ".json").then(function (r) { return r.json(); }); }));
  }).then(function (p) { plans = p; renderPlans(); });

  $("sign-out").onclick = function () {
    mem.idToken = null; mem.claims = null; mem.creds = {};
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    $("step1-done").hidden = true; $("signed-out-hero").hidden = false; $("tabs").hidden = true; renderAccounts();
    if (renewTimer) clearTimeout(renewTimer);
    if (window.SealedStore) SealedStore.forget(rec("session"));
  };
  $("forget-device").onclick = function () {
    $("sign-out").onclick();
    accounts = []; renderAccounts();
    if (window.SealedStore) SealedStore.forgetDevice().then(function () { say($("store-status"), "This device's key and everything sealed with it are deleted.", "ok"); });
  };
  if ($("twin-enter")) $("twin-enter").onclick = function () { enterTwin(true); };
  if ($("first-steps-twin")) $("first-steps-twin").onclick = function () { enterTwin(true); };
  if ($("twin-leave")) $("twin-leave").onclick = function () { enterTwin(false); };
  $("twin-bar").hidden = !TWIN;
  // In the twin, Leave the twin is the way out; sign out and forget this device belong to real sign-in.
  if (TWIN) { $("sign-out").hidden = true; $("forget-device").hidden = true; $("add-account").hidden = true; $("twin-add-note").hidden = false;
    $("twin-add-leave").onclick = function () { enterTwin(false); }; if ($("plans-twin-note")) $("plans-twin-note").hidden = false; }
  if (TWIN && window.AwsTwin) {
    var ps = $("twin-pack");
    Object.keys(AwsTwin.packs).forEach(function (k) { ps.appendChild(el("option", { value: k, text: AwsTwin.packs[k].title })); });
    ps.value = AwsTwin.pack(); $("twin-pack-about").textContent = AwsTwin.packs[ps.value].about;
    // Where a pack shows: one click to the place (sherpa.aws.c, walk 02).
    var see = AwsTwin.packs[ps.value].see, sb = $("twin-pack-see");
    if (see) {
      sb.hidden = false; sb.textContent = "See it in " + see.label;
      sb.onclick = function () { setTab("s3"); if (window.S3Browser) S3Browser.openAt(AwsTwin.buckets[see.bucket], see.prefix); };
    }
    // A pack is a whole world: loading one reloads the page on it.
    ps.onchange = function () { AwsTwin.usePack(ps.value); location.href = location.pathname + "?twin&pack=" + ps.value; };
  }
  window.Platform = { me: function () { return mem.claims ? { sub: mem.claims.sub, email: mem.claims.email, name: mem.claims.name } : null; }, enterTwin: enterTwin, diffView: diffView, jsonLine: jsonLine, assume: assume, jsonCall: jsonCall, xmlText: xmlText, awsError: awsError, el: el, say: say,
    accounts: function () { return accounts; }, signedIn: function () { return !!mem.idToken; } };
  initGoogle();
  loadAccounts().then(restore).then(renderAccounts).then(function () { return gisReady; }).then(autoSignIn);
})();
