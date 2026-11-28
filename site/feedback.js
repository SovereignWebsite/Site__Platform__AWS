// Feedback: a lane from the site to the agents. Dinis Cruz, 28 Nov 2026: "add an feedback lane to this site ... a) a way
// for me to give you (and the other agents) feedback directly from the site b) allow me to share with you non sensitive
// data (like lambda deployments Ids and other data like cloudfront) so that you can understand exactly what we have".
// Version 1 needs no server and no new host: the page writes the feedback and, if asked, a snapshot of chosen parts of the
// account (read here with the read role, account ID masked by default), shows exactly what will be shared, and sends it
// only when the owner clicks: as an issue on the site's own repository (public), or copied for any session. aws.c reads
// the issues and passes each to the agent it names. Nothing is sent by itself; nothing is kept.
(function () {
  "use strict";
  var P = window.Platform, $ = function (id) { return document.getElementById(id); }, el = P.el;
  var REPO = "https://github.com/SovereignWebsite/Site__Platform__AWS";
  var TWIN = !!(window.AwsTransport && AwsTransport.isTwin());
  var TO = [["aws.c", "aws.c (the site, the twin, every tab)"], ["team", "the whole AWS team"], ["billing", "billing (the Costs tab)"],
    ["iam", "IAM and access"], ["s3", "the S3 browser"], ["ux", "design and usability"], ["security", "security"], ["vaults", "vaults and SG/Send"]];
  // What can be attached: each reads a little through the API layer, with the read role, and returns lines of text.
  var PARTS = [
    { id: "lambda", label: "Lambda functions (names, runtime, memory, last change)", svc: ["lambda"], read: function (send, acct, region) {
      return ApiAll(function (n) { return LambdaApi(send).functions(region, { next: n }); }, { maxItems: 200 }).then(function (r) {
        return ["Lambda functions in " + region + " (" + r.items.length + "):"].concat(r.items.map(function (f) { return "- " + f.name + " | " + f.runtime + " | " + f.memory + " MB | timeout " + f.timeout + " s | changed " + f.modified + " | " + (f.codeSha256 || ""); }));
      });
    } },
    { id: "cloudfront", label: "CloudFront distributions (ids, domains, aliases, origins)", svc: ["cloudfront"], read: function (send, acct) {
      return ApiAll(function (n) { return CloudFrontApi(send, { account: acct.id }).distributions({ next: n }); }, { maxItems: 200 }).then(function (r) {
        return ["CloudFront distributions (" + r.items.length + "):"].concat(r.items.map(function (d) { return "- " + d.id + " | " + d.domain + " | aliases " + ((d.aliases || []).join(", ") || "none") + " | " + (d.enabled ? d.status : "disabled") + " | origins " + (d.origins || []).map(function (o) { return o.domain; }).join(", "); }));
      });
    } },
    { id: "stacks", label: "CloudFormation stacks (names, status, last change)", svc: ["cloudformation"], read: function (send, acct, region) {
      var api = CfnApi(send, { account: acct.id }), regions = region === "us-east-1" ? ["us-east-1"] : [region, "us-east-1"];
      return Promise.all(regions.map(function (rg) { return ApiAll(function (n) { return api.stacks(rg, { next: n }); }, { maxItems: 200 }).then(function (r) { return [rg, r.items]; }); })).then(function (all) {
        return [].concat.apply([], all.map(function (x) { return ["Stacks in " + x[0] + " (" + x[1].length + "):"].concat(x[1].map(function (st) { return "- " + st.name + " | " + st.status + " | " + (st.updated || st.created); })); }));
      });
    } },
    { id: "route53", label: "Route 53 zones (names, record counts)", svc: ["route53"], read: function (send, acct) {
      return ApiAll(function (n) { return Route53Api(send, { account: acct.id }).zones({ next: n }); }, { maxItems: 200 }).then(function (r) {
        return ["Route 53 hosted zones (" + r.items.length + "):"].concat(r.items.map(function (z) { return "- " + z.name + " | " + z.recordCount + " records | " + (z.private ? "private" : "public"); }));
      });
    } },
    { id: "costs", label: "This month's costs by service (one Cost Explorer read: $0.01)", svc: ["ce"], read: function (send, acct) {
      var now = new Date(), start = now.toISOString().slice(0, 8) + "01", end = now.toISOString().slice(0, 10);
      if (start === end) return Promise.resolve(["Costs: the month has just started; nothing to show yet."]);
      return CostsApi(send, { account: acct.id }).usage({ start: start, end: end, granularity: "MONTHLY", groupBy: "SERVICE", maxPages: 2 }).then(function (r) {
        var g = ((r.items || [])[0] || {}).groups || [];
        g = g.slice().sort(function (a, b) { return b.amount - a.amount; });
        return ["Costs this month so far, by service (" + start + " to " + end + "):"].concat(g.map(function (x) { return "- " + x.key + ": " + x.amount.toFixed(2) + " " + x.unit; }));
      });
    } }
  ];
  function maskIds(text, keep) { return keep ? text : text.replace(/\b(\d{8})(\d{4})\b/g, function (m, a, b) { return "********" + b; }); }

  function build() {
    var sec = $("feedback"); if (!sec) return;
    var box = sec.querySelector(".feedback-body"); box.textContent = "";
    var to = el("select", { id: "fb-to", "aria-label": "For" }, TO.map(function (t) { return el("option", { value: t[0], text: t[1] }); }));
    var title = el("input", { id: "fb-title", type: "text", placeholder: "In a few words", "aria-label": "Subject", maxlength: "120" });
    var msg = el("textarea", { id: "fb-msg", rows: "6", placeholder: "What works, what does not, what you want next", "aria-label": "Your feedback" });
    var acct = el("select", { "aria-label": "Account" }), region = el("select", { "aria-label": "Region" }, ["eu-west-2", "eu-west-1", "us-east-1", "us-east-2", "us-west-2", "eu-central-1"].map(function (r) { return el("option", { value: r, text: r }); }));
    P.accounts().forEach(function (a) { acct.appendChild(el("option", { value: a.id, text: a.label })); });
    var checks = PARTS.map(function (p) {
      var c = el("input", { type: "checkbox", id: "fb-part-" + p.id, value: p.id });
      var ok = !window.Consoles || p.svc.every(function (s) { return window.Consoles.liveOk(s); });
      if (!ok) c.disabled = true;
      return el("label", { class: "fb-part" }, [c, document.createTextNode(" " + p.label + (ok ? "" : " (not read from live AWS yet: see the browser check on its tab)"))]);
    });
    var keepIds = el("input", { type: "checkbox", id: "fb-keep-ids" });
    var preview = el("pre", { class: "fb-preview", "aria-label": "What will be shared" }), st = el("p", { class: "status", role: "status" });
    var prepare = el("button", { type: "button", text: "Prepare: read the parts and show what will be shared" });
    var copy = el("button", { type: "button", class: "quiet", text: "Copy", disabled: "" });
    var send = el("button", { type: "button", text: "Send as an issue on the site's repository", disabled: "" });
    var text = "";
    prepare.onclick = function () {
      var a = P.accounts().filter(function (x) { return x.id === acct.value; })[0];
      var chosen = PARTS.filter(function (p) { return $("fb-part-" + p.id).checked; });
      if (!msg.value.trim() && !chosen.length) return P.say(st, "Write something, or choose a part of the account to share.", "bad");
      if (chosen.length && !a) return P.say(st, "Add an account first (Accounts tab) to share parts of it.", "bad");
      P.say(st, chosen.length ? "Reading " + chosen.length + " part" + (chosen.length === 1 ? "" : "s") + " with the read role..." : "");
      var sender = a && window.Consoles ? window.Consoles.sender(a) : null;
      Promise.all(chosen.map(function (p) { return p.read(sender, a, region.value).catch(function (e) { return [p.label + ": not read (" + e.message + ")"]; }); })).then(function (parts) {
        var lines = ["For: " + to.value, "From: the site's owner, on " + location.host + (TWIN ? " (twin: synthetic data)" : ""), "When: " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", "", msg.value.trim()];
        if (a) lines.push("", "Account: " + a.label + " (" + a.id + ")");
        parts.forEach(function (p) { lines.push(""); lines = lines.concat(p); });
        text = maskIds(lines.join("\n"), keepIds.checked);
        preview.textContent = text; copy.disabled = false; send.disabled = false;
        P.say(st, "This is exactly what will be shared. Check it, then send or copy.", "ok");
      });
    };
    copy.onclick = function () {
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"))).then(function () { P.say(st, "Copied. Paste it into any session.", "ok"); }, function () { P.say(st, "Select the text above and copy it.", "bad"); });
    };
    send.onclick = function () {
      var t = "[" + to.value + "] " + (title.value.trim() || msg.value.trim().split("\n")[0].slice(0, 80) || "Feedback from the site");
      var body = text + "\n\n(Sent from the site's Feedback tab.)";
      var url = REPO + "/issues/new?labels=feedback&title=" + encodeURIComponent(t) + "&body=" + encodeURIComponent(body);
      if (url.length > 7500) { // too long for a link: open the issue with the message, and put the rest on the clipboard
        var shortBody = msg.value.trim() + "\n\n(The account details were copied to the clipboard: paste them below this line.)";
        url = REPO + "/issues/new?labels=feedback&title=" + encodeURIComponent(t) + "&body=" + encodeURIComponent(shortBody);
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
        P.say(st, "Too long for one link: the issue opens with your message, and the details are on the clipboard to paste in.", "ok");
      }
      window.open(url, "_blank", "noopener");
    };
    box.appendChild(el("div", { class: "card fb-card" }, [
      el("div", { class: "row" }, [el("label", { for: "fb-to", text: "For " }), to]),
      el("div", { class: "row" }, [title]), msg,
      el("h3", { text: "Share parts of this account (optional)" }),
      note("Read here with the read role and shown to you before anything leaves the page. Only names, ids and settings: no file contents, no secrets."),
      el("div", { class: "row" }, [acct, region]),
      el("div", { class: "fb-parts" }, checks),
      el("label", { class: "fb-part" }, [keepIds, document.createTextNode(" Show the full 12-digit account ID (masked to the last four by default)")]),
      el("div", { class: "row" }, [prepare]), st, preview,
      el("div", { class: "row" }, [send, copy]),
      note("The issue is public on GitHub, so share nothing you would not publish. It opens on GitHub for you to check and submit; aws.c reads it and passes it to the agent it names.")
    ]));
  }
  function note(t) { return el("p", { class: "small", text: t }); }
  // Built when first shown, and again only if the accounts change (so a half-written message is not lost otherwise).
  var builtFor = null;
  window.Feedback = { render: function () {
      var sec = $("feedback"); if (!sec) return; sec.hidden = !P.signedIn();
      var key = P.accounts().map(function (a) { return a.id; }).join(",");
      if (P.signedIn() && builtFor !== key) { builtFor = key; build(); }
    },
    rebuild: build, mask: maskIds };
  window.Feedback.render();
})();
