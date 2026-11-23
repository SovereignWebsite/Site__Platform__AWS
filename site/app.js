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

  // ---- Step 1: Google sign-in (Google Identity Services; the ID token stays in memory) ----
  function decodeJwt(t) {
    var p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  }
  // Keep the session across a refresh, sealed with this device's key (sealed-store.js). Expired parts are dropped.
  function persist() {
    if (!window.SealedStore || !SealedStore.available() || !mem.idToken) return Promise.resolve();
    var exp = mem.claims.exp * 1000;
    Object.keys(mem.creds).forEach(function (k) { exp = Math.max(exp, mem.creds[k].expiration); });
    return SealedStore.seal("session", { idToken: mem.idToken, creds: mem.creds }, exp).catch(function () { /* memory only */ });
  }
  function restore() {
    if (!window.SealedStore || !SealedStore.available()) return Promise.resolve();
    return SealedStore.open("session").then(function (s) {
      if (!s) return;
      var now = Date.now();
      Object.keys(s.creds || {}).forEach(function (k) { if (s.creds[k].expiration - now > 60 * 1000) mem.creds[k] = s.creds[k]; });
      if (s.idToken && decodeJwt(s.idToken).exp * 1000 - now > 60 * 1000) showSignedIn(s.idToken, true);
      else if (Object.keys(mem.creds).length) { $("who").textContent = "Your Google sign-in has expired; AWS credentials still valid are kept until they end. Sign in again for new ones."; $("step1-done").hidden = false; renderAccounts(); }
    }).catch(function () {});
  }
  function onGoogle(resp) { showSignedIn(resp.credential, false); persist(); }
  function showSignedIn(token, restored) {
    mem.idToken = token;
    mem.claims = decodeJwt(token);
    $("restored").hidden = !restored;
    $("who").textContent = "Signed in with Google as " + (mem.claims.email || "your account") + ".";
    $("sub").textContent = mem.claims.sub;
    $("step1-done").hidden = false;
    renderAccounts();
  }
  function initGoogle() {
    if (!cfg.googleClientId) { $("no-client").hidden = false; return; }
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = function () {
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogle, auto_select: false });
      google.accounts.id.renderButton($("google-button"), { theme: "outline", size: "large", text: "signin_with" });
    };
    document.head.appendChild(s);
  }

  // ---- Accounts, on this device only ----
  // Account IDs are sealed in the sealed store too (kept ten years; Forget this device deletes them).
  var TEN_YEARS = 10 * 365 * 24 * 3600 * 1000;
  var accounts = [];
  function saveAccounts(a) {
    if (window.SealedStore && SealedStore.available()) return SealedStore.seal("accounts", a, Date.now() + TEN_YEARS).catch(function () {});
  }
  function loadAccounts() {
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
  function assume(acct, role) {
    var key = acct.id + "/" + role, c = mem.creds[key];
    if (c && c.expiration - Date.now() > 5 * 60 * 1000) return Promise.resolve(c);
    if (!mem.idToken) return Promise.reject(new Error("Sign in with Google first."));
    var body = new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: roleArn(acct, role),
      RoleSessionName: "sws-aws-platform", WebIdentityToken: mem.idToken, DurationSeconds: "3600"
    }).toString();
    return fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, doc: new DOMParser().parseFromString(t, "text/xml") }; }); })
      .then(function (x) {
        if (!x.ok) throw awsError(x.doc, x.status);
        c = { accessKeyId: xmlText(x.doc, "AccessKeyId"), secretAccessKey: xmlText(x.doc, "SecretAccessKey"),
              sessionToken: xmlText(x.doc, "SessionToken"), expiration: Date.parse(xmlText(x.doc, "Expiration")) };
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
      .then(function (h) { return fetch(url, { method: "POST", headers: h, body: body }); })
      .then(function (r) { return r.text().then(function (t) { var d = new DOMParser().parseFromString(t, "text/xml"); if (!r.ok) throw awsError(d, r.status); return d; }); });
  }
  function jsonCall(creds, host, service, target, payload) {
    var url = "https://" + host + "/", body = JSON.stringify(payload);
    var headers = { "content-type": "application/x-amz-json-1.1", "x-amz-target": target };
    return SigV4.sign({ method: "POST", url: url, headers: headers, body: body }, creds, "us-east-1", service)
      .then(function (h) { return fetch(url, { method: "POST", headers: h, body: body }); })
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

  function readAccount(acct, out) {
    say(out, "Asking STS for one-hour read-only credentials...");
    assume(acct, "sws-aws-platform-read").then(function (c) {
      return queryCall(c, "sts.amazonaws.com", "sts", { Action: "GetCallerIdentity", Version: "2011-06-15" }).then(function (d) {
        if (!acct.ready) { acct.ready = true; saveAccounts(accounts); }
        var lines = ["Signed in to AWS as " + xmlText(d, "Arn") + ", until " + new Date(c.expiration).toLocaleTimeString() + "."];
        var now = new Date(), start = now.toISOString().slice(0, 8) + "01", end = now.toISOString().slice(0, 10);
        if (start === end) return say(out, lines.join(" "), "ok");
        return jsonCall(c, "ce.us-east-1.amazonaws.com", "ce", "AWSInsightsIndexService.GetCostAndUsage",
          { TimePeriod: { Start: start, End: end }, Granularity: "MONTHLY", Metrics: ["UnblendedCost"] })
          .then(function (j) {
            var t = j.ResultsByTime && j.ResultsByTime[0] && j.ResultsByTime[0].Total.UnblendedCost;
            if (t) lines.push("Cost this month so far: " + Number(t.Amount).toFixed(2) + " " + t.Unit + ".");
            say(out, lines.join(" "), "ok");
          }, function (e) { lines.push("Costs not read (" + e.message + ")."); say(out, lines.join(" "), "ok"); });
      });
    }).catch(function (e) { say(out, e.message + (/AccessDenied|InvalidIdentityToken/.test(e.message) ? " Has this account been set up (step 2)?" : ""), "bad"); });
  }

  function renderAccounts() {
    var list = $("accounts"); list.textContent = "";
    $("step2").hidden = !mem.idToken;
    accounts.forEach(function (acct, i) {
      var out = el("p", { class: "status" });
      var read = el("button", { type: "button", text: "Read this account" }); read.onclick = function () { readAccount(acct, out); };
      var rm = el("button", { type: "button", class: "quiet", text: "Forget on this device" });
      rm.onclick = function () { accounts.splice(i, 1); saveAccounts(accounts); renderAccounts(); renderPlans(); };
      var setup = setupLinks(acct);
      if (acct.ready) setup = el("details", {}, [el("summary", { class: "small", text: "Set up again (CloudFormation)" }), setup]);
      list.appendChild(el("li", {}, [el("strong", { text: acct.label }), el("span", { class: "small", text: " (account ending " + acct.id.slice(-4) + (acct.ready ? ", set up" : "") + ")" }),
        el("div", { class: "row" }, [read, rm]), out, setup]));
    });
    renderPlans();
  }
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
  function renderPlans() {
    var box = $("plans"); box.textContent = "";
    $("step3").hidden = !mem.idToken || !accounts.length;
    plans.forEach(function (plan) {
      var sel = el("select", {}, accounts.map(function (a) { return el("option", { value: a.id, text: a.label }); }));
      var show = el("button", { type: "button", text: "Show the plan against this account" });
      var out = el("div", {}), st = el("p", { class: "status" });
      show.onclick = function () { showPlan(plan, accounts.filter(function (a) { return a.id === sel.value; })[0], out, st); };
      box.appendChild(el("li", {}, [el("strong", { text: plan.title }), el("p", { class: "small", text: plan.why }),
        el("p", { class: "small", text: "Adds: " + plan.add.join(", ") + ". Keeps " + plan.keep + ". Never touches " + plan.never + "." }),
        el("div", { class: "row" }, [sel, show]), out, st]));
    });
  }
  function showPlan(plan, acct, out, st) {
    out.textContent = ""; say(st, "Reading the role as it is now, with the change role...");
    assume(acct, plan.role).then(function (c) {
      return getRole(c, plan.target_role).then(function (before) {
        var r = Plans.apply(before, plan);
        if (r.unchanged) return say(st, "Nothing to do: " + plan.target_role + " already trusts " + plan.add.join(", ") + ".", "ok");
        out.appendChild(el("h4", { text: "Now" })); out.appendChild(el("pre", { text: JSON.stringify(before, null, 2) }));
        out.appendChild(el("h4", { text: "After you approve" })); out.appendChild(el("pre", { text: JSON.stringify(r.after, null, 2) }));
        var go = el("button", { type: "button", class: "approve", text: "Approve and apply to " + plan.target_role });
        go.onclick = function () {
          go.disabled = true; say(st, "Applying...");
          // Re-read first: if the role changed since the plan was shown, stop.
          getRole(c, plan.target_role).then(function (again) {
            if (!Plans.same(again, before)) throw new Error("The role changed since the plan was shown. Show the plan again.");
            return queryCall(c, "iam.amazonaws.com", "iam", { Action: "UpdateAssumeRolePolicy", Version: "2010-05-08",
              RoleName: plan.target_role, PolicyDocument: JSON.stringify(r.after) });
          }).then(function () { return getRole(c, plan.target_role); }).then(function (now) {
            var ok = r.added.every(function (s) { return JSON.stringify(now).indexOf(JSON.stringify(s)) >= 0; });
            say(st, ok ? "Applied and checked: " + plan.target_role + " now trusts " + r.added.join(", ") + "." : "Applied, but the check did not find the new subject. Read the role again.", ok ? "ok" : "bad");
          }).catch(function (e) { go.disabled = false; say(st, e.message, "bad"); });
        };
        out.appendChild(go);
        say(st, "This is the plan. Nothing has changed yet.", "");
      });
    }).catch(function (e) { say(st, e.message, "bad"); });
  }
  fetch("plans/index.json").then(function (r) { return r.json(); }).then(function (ix) {
    return Promise.all(ix.plans.map(function (id) { return fetch("plans/" + id + ".json").then(function (r) { return r.json(); }); }));
  }).then(function (p) { plans = p; renderPlans(); });

  $("sign-out").onclick = function () {
    mem.idToken = null; mem.claims = null; mem.creds = {};
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    $("step1-done").hidden = true; renderAccounts();
    if (window.SealedStore) SealedStore.forget("session");
  };
  $("forget-device").onclick = function () {
    $("sign-out").onclick();
    accounts = []; renderAccounts();
    if (window.SealedStore) SealedStore.forgetDevice().then(function () { say($("store-status"), "This device's key and everything sealed with it are deleted.", "ok"); });
  };
  initGoogle();
  loadAccounts().then(restore).then(renderAccounts);
})();
