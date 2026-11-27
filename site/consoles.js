// The consoles: Costs, Stacks and DNS, IAM roles, Lambda and Firehose, CloudFront, one tab each.
// Dinis Cruz, 27 Nov 2026: "allow me to access all that functionality and features in that simulated environment
// (with ability to also shift to live data for the features that already support it)".
// Every view reads through the API layer (site/api/), over one send: assume the read role, sign with SigV4, deliver
// through AwsTransport (the twin answers in twin mode; AWS otherwise). Reads only: nothing here can change AWS.
// Live AWS: only services checked to answer this site from a browser (CORS) are read live; the others say so and
// offer the twin. Text from AWS reaches the page by textContent only.
(function () {
  "use strict";
  var P = window.Platform, $ = function (id) { return document.getElementById(id); };
  var TWIN = !!(window.AwsTransport && AwsTransport.isTwin());
  var REGIONS = ["eu-west-2", "eu-west-1", "us-east-1", "us-east-2", "us-west-2", "eu-central-1", "ap-southeast-2"];
  // Which services answer a browser on live AWS, as far as checked (CORS). The rest work in the twin only for now.
  var LIVE = { ce: true, budgets: true, cloudformation: true, iam: true, route53: false, lambda: false, firehose: false, logs: false, cloudfront: false };
  var NAMES = { route53: "Route 53", lambda: "Lambda", firehose: "Firehose", logs: "CloudWatch Logs", cloudfront: "CloudFront" };

  // ---- one send for every API ----
  function account(sel) { var id = sel && sel.value; return P.accounts().filter(function (a) { return a.id === id; })[0] || P.accounts()[0]; }
  function sender(acct) {
    return function (req) {
      return P.assume(acct, "sws-aws-platform-read").then(function (c) {
        return SigV4.sign({ method: req.method, url: req.url, headers: req.headers || {}, body: req.body || "" }, c, req.region, req.service);
      }).then(function (h) { return AwsTransport.fetch(req.url, { method: req.method, headers: h, body: req.body || undefined }); });
    };
  }
  function drain(page, max) { return ApiAll(page, { maxItems: max || 500, maxPages: 20 }); }

  // ---- small DOM helpers (text only) ----
  var el = P.el;
  function txt(v) { return v === null || v === undefined || v === "" ? "" : String(v); }
  function when(v) { return v ? String(v).replace("T", " ").replace(/\.\d+Z?$|Z$/, "").replace(/\+0000$/, "").slice(0, 16) : ""; }
  function table(cols, rows, onPick) {
    var tb = el("tbody", {});
    rows.forEach(function (r) {
      var cells = cols.map(function (c, i) {
        var v = txt(c.get(r));
        if (i === 0 && onPick) { var b = el("button", { type: "button", class: "linkish", text: v }); b.onclick = function () { onPick(r, tr); }; return el("td", {}, [b]); }
        return el("td", { class: c.n ? "n" : "", text: v });
      });
      var tr = el("tr", {}, cells); tb.appendChild(tr);
    });
    var t = el("table", { class: "s3-table" }, [el("thead", {}, [el("tr", {}, cols.map(function (c) { return el("th", { text: c.h }); }))]), tb]);
    return el("div", { class: "s3-wrap" }, [t]);
  }
  function kv(pairs) {
    return el("dl", { class: "kv" }, [].concat.apply([], pairs.filter(function (p) { return txt(p[1]) !== ""; }).map(function (p) { return [el("dt", { text: p[0] }), el("dd", { text: txt(p[1]) })]; })));
  }
  function h3(t) { return el("h3", { text: t }); }
  function note(t) { return el("p", { class: "small", text: t }); }
  function fail(st, e) { P.say(st, (e && e.message) || String(e), "bad"); }
  // A part of a view that live AWS cannot show yet: say so, and offer the twin.
  function twinOnly(box, services) {
    var names = services.map(function (s) { return NAMES[s] || s; }).join(" and ");
    var go = el("button", { type: "button", class: "quiet", text: "Open this in the twin" });
    go.onclick = function () { if (P.enterTwin) P.enterTwin(true); };
    box.appendChild(el("div", { class: "card twin-only" }, [
      el("p", { text: names + ": not read from live AWS yet. Whether " + names + " answers this site from a browser has not been checked; until it is, this view runs in the twin (synthetic data) only." }), go]));
  }
  function needsTwin(services) { return !TWIN && services.some(function (s) { return !LIVE[s]; }); }

  // ---- the frame each console shares: account, region (if regional), Load, status, body ----
  function frame(id, opts) {
    var sec = $(id); if (!sec) return null;
    var head = sec.querySelector(".console-controls"), st = sec.querySelector(".status"), body = sec.querySelector(".console-body");
    var sel = el("select", { "aria-label": "Account" }), reg = opts.regional ? el("select", { "aria-label": "Region" }, REGIONS.map(function (r) { return el("option", { value: r, text: r }); })) : null;
    var load = el("button", { type: "button", text: opts.button || "Load" });
    head.textContent = ""; head.appendChild(sel); if (reg) head.appendChild(reg); head.appendChild(load);
    head.appendChild(el("span", { class: "badge " + (TWIN ? "" : "ok"), text: TWIN ? "twin: synthetic data" : "live AWS, read role" }));
    var f = { sec: sec, sel: sel, reg: reg, load: load, st: st, body: body, loaded: false, gen: 0 };
    f.fill = function () {
      var keep = sel.value; sel.textContent = "";
      P.accounts().forEach(function (a) { sel.appendChild(el("option", { value: a.id, text: a.label })); });
      if (keep) sel.value = keep;
      load.disabled = !P.accounts().length;
    };
    f.run = function () {
      var my = ++f.gen; body.textContent = ""; P.say(st, "Reading...");
      var acct = account(sel); if (!acct) return P.say(st, "Add an account first (Accounts tab).", "bad");
      f.loaded = true;
      Promise.resolve(opts.show(f, acct, sender(acct), reg ? reg.value : "us-east-1", function () { return my === f.gen; }))
        .then(function (msg) { if (my === f.gen) P.say(st, msg || "Read.", "ok"); }, function (e) { if (my === f.gen) fail(st, e); });
    };
    load.onclick = f.run; if (reg) reg.onchange = f.run; sel.onchange = f.run;
    return f;
  }
  // A detail area under a table: one at a time, replaced on each pick.
  function detail(f) { var d = f.body.querySelector(".console-detail"); if (!d) { d = el("div", { class: "console-detail" }); f.body.appendChild(d); } d.textContent = ""; return d; }

  // ---- Costs: billing.aws.a's view (site/billing.js) over CostsApi ----
  var costs = frame("console-costs", { button: "Read costs", show: function (f, acct, send) {
    if (!window.SwsBilling || !window.CostsApi) throw new Error("The costs view did not load.");
    var key = SwsBilling.cacheKey(acct.id, new Date());
    return SwsBilling.load(key, function () { return SwsBilling.fetchAll(CostsApi(send, { account: acct.id }), new Date(), acct.id); }).then(function (r) {
      f.body.appendChild(SwsBilling.render(SwsBilling.modelFromApi(r), document));
      f.body.appendChild(note("Each Cost Explorer read is charged by AWS ($0.01 a request); answers are kept for this page's session, and Read costs asks again at most every five minutes." + (TWIN ? " The twin's figures are synthetic." : "")));
      return "Costs read.";
    });
  } });

  // ---- Stacks (CloudFormation) and DNS (Route 53) ----
  var stacks = frame("console-stacks", { regional: true, button: "Read stacks", show: function (f, acct, send, region, live) {
    var cfn = CfnApi(send, { account: acct.id });
    return drain(function (n) { return cfn.stacks(region, { next: n }); }).then(function (r) {
      if (!live()) return;
      f.body.appendChild(h3("Stacks in " + region + " (" + r.items.length + ")"));
      if (!r.items.length) f.body.appendChild(note("No stacks in this region. The platform's own stack is in us-east-1."));
      else f.body.appendChild(table([{ h: "Stack", get: function (s) { return s.name; } }, { h: "Status", get: function (s) { return s.status; } },
        { h: "Created (UTC)", get: function (s) { return when(s.created); } }, { h: "Updated", get: function (s) { return when(s.updated); } }, { h: "Description", get: function (s) { return s.description; } }], r.items,
        function (s) {
          var d = detail(f); d.appendChild(h3(s.name)); P.say(f.st, "Reading " + s.name + "...");
          return Promise.all([cfn.stack(region, s.name), drain(function (n) { return cfn.resources(region, s.name, { next: n }); }), cfn.events(region, s.name, {})]).then(function (x) {
            var st = x[0];
            d.appendChild(kv([["Status", st.status], ["Reason", st.reason], ["Created", when(st.created)], ["Updated", when(st.updated)], ["Description", st.description]]));
            if (st.parameters && st.parameters.length) { d.appendChild(el("h4", { text: "Parameters" })); d.appendChild(table([{ h: "Name", get: function (p) { return p.key; } }, { h: "Value", get: function (p) { return p.value; } }], st.parameters)); }
            if (st.outputs && st.outputs.length) { d.appendChild(el("h4", { text: "Outputs" })); d.appendChild(table([{ h: "Name", get: function (o) { return o.key; } }, { h: "Value", get: function (o) { return o.value; } }, { h: "Export", get: function (o) { return o.exportName; } }], st.outputs)); }
            d.appendChild(el("h4", { text: "What it made (" + x[1].items.length + ")" }));
            d.appendChild(table([{ h: "Logical id", get: function (r) { return r.logicalId; } }, { h: "Type", get: function (r) { return r.type; } }, { h: "Physical id", get: function (r) { return r.physicalId; } }, { h: "Status", get: function (r) { return r.status; } }], x[1].items));
            d.appendChild(el("h4", { text: "Latest events" }));
            d.appendChild(table([{ h: "Time (UTC)", get: function (e) { return when(e.time); } }, { h: "Resource", get: function (e) { return e.logicalId; } }, { h: "Status", get: function (e) { return e.status; } }, { h: "Reason", get: function (e) { return e.reason; } }], x[2].items.slice(0, 12)));
            P.say(f.st, s.name + ": " + x[1].items.length + " resources.", "ok");
          }).catch(function (e) { fail(f.st, e); });
        }));
      // DNS: Route 53 is global; read once with the stacks.
      var dns = el("div", { class: "console-dns" }); f.body.appendChild(dns); dns.appendChild(h3("DNS (Route 53)"));
      if (needsTwin(["route53"])) { twinOnly(dns, ["route53"]); return "Read " + r.items.length + " stacks."; }
      var r53 = Route53Api(send, { account: acct.id });
      return drain(function (n) { return r53.zones({ next: n }); }).then(function (z) {
        if (!live()) return;
        if (!z.items.length) { dns.appendChild(note("No hosted zones.")); return; }
        dns.appendChild(table([{ h: "Zone", get: function (x) { return x.name; } }, { h: "Records", n: true, get: function (x) { return x.recordCount; } }, { h: "Private", get: function (x) { return x.private ? "yes" : "no"; } }, { h: "Comment", get: function (x) { return x.comment; } }], z.items,
          function (zone) {
            var d = detail(f); d.appendChild(h3(zone.name));
            drain(function (n) { return r53.records(zone.id, { next: n }); }).then(function (rr) {
              d.appendChild(table([{ h: "Name", get: function (x) { return x.name; } }, { h: "Type", get: function (x) { return x.type; } }, { h: "TTL", n: true, get: function (x) { return x.ttl; } },
                { h: "Points at", get: function (x) { return x.alias ? "alias: " + (x.alias.dnsName || x.alias.target || JSON.stringify(x.alias)) : (x.values || []).join(", "); } }], rr.items));
            }).catch(function (e) { fail(f.st, e); });
          }));
      }).then(function () { return "Read " + r.items.length + " stacks and the hosted zones."; });
    });
  } });

  // ---- IAM roles ----
  function trustedBy(role) {
    var out = [];
    ((role.trust && role.trust.statements) || []).forEach(function (s) { (s.principals || []).forEach(function (p) { out.push(p.kind + ": " + p.id); }); });
    return out.join(", ");
  }
  var iam = frame("console-iam", { button: "Read roles", show: function (f, acct, send, region, live) {
    var api = IamApi(send);
    return drain(function (n) { return api.roles({ next: n }); }).then(function (r) {
      if (!live()) return;
      f.body.appendChild(h3("Roles (" + r.items.length + ")"));
      f.body.appendChild(table([{ h: "Role", get: function (x) { return x.name; } }, { h: "Trusted by", get: trustedBy }, { h: "Created (UTC)", get: function (x) { return when(x.created); } }, { h: "Description", get: function (x) { return x.description; } }], r.items,
        function (role) {
          var d = detail(f); d.appendChild(h3(role.name));
          Promise.all([api.role(role.name), drain(function (n) { return api.attached(role.name, { next: n }); }), drain(function (n) { return api.inline(role.name, { next: n }); })]).then(function (x) {
            var full = x[0];
            d.appendChild(kv([["ARN", full.arn], ["Created", when(full.created)], ["Last used", full.lastUsed ? when(full.lastUsed.date || full.lastUsed.at) + " " + txt(full.lastUsed.region) : "not recorded"],
              ["Longest session", full.maxSession ? full.maxSession / 3600 + " h" : ""], ["Permissions boundary", full.boundary && (full.boundary.arn || full.boundary)], ["Description", full.description]]));
            d.appendChild(el("h4", { text: "Who may assume it" }));
            d.appendChild(table([{ h: "Effect", get: function (s) { return s.effect; } }, { h: "Principals", get: function (s) { return (s.principals || []).map(function (p) { return p.kind + ": " + p.id; }).join(", "); } },
              { h: "Actions", get: function (s) { return (s.actions || []).join(", "); } }, { h: "Conditions", get: function (s) { return (s.conditions || []).map(function (c) { return c.operator + " " + c.key + " = " + [].concat(c.values || c.value || []).join(" | "); }).join("; "); } }], (full.trust && full.trust.statements) || []));
            d.appendChild(el("h4", { text: "Policies attached (" + x[1].items.length + ")" }));
            d.appendChild(x[1].items.length ? table([{ h: "Policy", get: function (p) { return p.name; } }, { h: "ARN", get: function (p) { return p.arn; } }], x[1].items) : note("None."));
            d.appendChild(el("h4", { text: "Inline policies (" + x[2].items.length + ")" }));
            d.appendChild(x[2].items.length ? note(x[2].items.join(", ")) : note("None."));
          }).catch(function (e) { fail(f.st, e); });
        }));
      return "Read " + r.items.length + " roles.";
    });
  } });

  // ---- Lambda functions, their recent runs (CloudWatch Logs), and Firehose streams ----
  var lambda = frame("console-lambda", { regional: true, button: "Read functions", show: function (f, acct, send, region, live) {
    if (needsTwin(["lambda", "firehose", "logs"])) { twinOnly(f.body, ["lambda", "firehose", "logs"]); return "Twin only for now."; }
    var lam = LambdaApi(send), logs = LogsApi(send), fh = FirehoseApi(send, { account: acct.id });
    return Promise.all([drain(function (n) { return lam.functions(region, { next: n }); }), drain(function (n) { return fh.streams(region, { next: n }); })]).then(function (x) {
      if (!live()) return;
      f.body.appendChild(h3("Functions in " + region + " (" + x[0].items.length + ")"));
      f.body.appendChild(x[0].items.length ? table([{ h: "Function", get: function (fn) { return fn.name; } }, { h: "Runtime", get: function (fn) { return fn.runtime; } }, { h: "Memory MB", n: true, get: function (fn) { return fn.memory; } },
        { h: "Timeout s", n: true, get: function (fn) { return fn.timeout; } }, { h: "Changed (UTC)", get: function (fn) { return when(fn.modified); } }, { h: "Description", get: function (fn) { return fn.description; } }], x[0].items,
        function (fn) {
          var d = detail(f); d.appendChild(h3(fn.name));
          d.appendChild(kv([["Handler", fn.handler], ["Role", fn.role], ["Code size", fn.codeSize + " B"], ["Architecture", (fn.architectures || []).join(", ")], ["Package", fn.packageType]]));
          d.appendChild(el("h4", { text: "Recent runs, last 14 days (from its log group)" }));
          logs.events(region, "/aws/lambda/" + fn.name, { newest: true, start: Date.now() - 14 * 86400000, max: 300 }).then(function (ev) {
            var runs = LogsApi.invocations(ev.items).slice(-20).reverse();
            d.appendChild(runs.length ? table([{ h: "Started (UTC)", get: function (r) { return when(r.start); } }, { h: "Duration ms", n: true, get: function (r) { return r.durationMs; } },
              { h: "Memory used MB", n: true, get: function (r) { return r.maxMemoryMb; } }, { h: "Errors", n: true, get: function (r) { return r.errors; } }, { h: "Request id", get: function (r) { return r.requestId; } }], runs) : note("No runs in its log group."));
          }).catch(function (e) { d.appendChild(note("Log group not read: " + e.message)); });
        }) : note("No functions in this region."));
      f.body.appendChild(h3("Firehose streams in " + region + " (" + x[1].items.length + ")"));
      if (!x[1].items.length) { f.body.appendChild(note("No delivery streams in this region.")); return "Read " + x[0].items.length + " functions."; }
      f.body.appendChild(table([{ h: "Stream", get: function (s) { return s.name; } }], x[1].items, function (s) {
        var d = detail(f); d.appendChild(h3(s.name));
        fh.stream(region, s.name).then(function (st) {
          d.appendChild(kv([["Status", st.status], ["Type", st.type], ["Created", when(st.created)]]));
          d.appendChild(table([{ h: "Writes to", get: function (x) { return x.bucket || x.kind; } }, { h: "Prefix", get: function (x) { return x.prefix; } }, { h: "Compression", get: function (x) { return x.compression; } },
            { h: "Buffer", get: function (x) { return x.bufferSeconds ? x.bufferSeconds + " s or " + x.bufferMb + " MB" : ""; } }, { h: "Processors", get: function (x) { return (x.processors || []).map(function (p) { return p.lambda || p.arn || p.type; }).join(", "); } }], st.destinations || []));
          var dest = (st.destinations || [])[0];
          if (dest && dest.bucket && window.S3Browser && S3Browser.openAt) {
            var go = el("button", { type: "button", class: "quiet", text: "Open its files in the S3 browser" });
            go.onclick = function () { S3Browser.openAt(dest.bucket, dest.prefix || ""); }; d.appendChild(go);
          }
        }).catch(function (e) { fail(f.st, e); });
      }));
      return "Read " + x[0].items.length + " functions and " + x[1].items.length + " streams.";
    });
  } });

  // ---- CloudFront ----
  var cloudfront = frame("console-cloudfront", { button: "Read distributions", show: function (f, acct, send, region, live) {
    if (needsTwin(["cloudfront"])) { twinOnly(f.body, ["cloudfront"]); return "Twin only for now."; }
    var api = CloudFrontApi(send, { account: acct.id });
    return drain(function (n) { return api.distributions({ next: n }); }).then(function (r) {
      if (!live()) return;
      f.body.appendChild(h3("Distributions (" + r.items.length + ")"));
      f.body.appendChild(r.items.length ? table([{ h: "Id", get: function (x) { return x.id; } }, { h: "Domain", get: function (x) { return x.domain; } }, { h: "Aliases", get: function (x) { return (x.aliases || []).join(", "); } },
        { h: "Status", get: function (x) { return x.enabled ? x.status : "disabled"; } }, { h: "Origins", get: function (x) { return (x.origins || []).map(function (o) { return o.domain; }).join(", "); } }], r.items,
        function (dist) {
          var d = detail(f); d.appendChild(h3(dist.id));
          api.distribution(dist.id).then(function (x) {
            d.appendChild(kv([["Domain", x.domain], ["Aliases", (x.aliases || []).join(", ")], ["Price class", x.priceClass], ["Default root", x.defaultRoot], ["Changed", when(x.lastModified)],
              ["Logging", x.logging ? (x.logging.bucket || "on") + " " + txt(x.logging.prefix) : "standard logs off (v2 logs may go to Firehose)"], ["Comment", x.comment]]));
            d.appendChild(el("h4", { text: "Origins" }));
            // Origin custom header values are never shown (iam.aws.a design 06): names only.
            d.appendChild(table([{ h: "Origin", get: function (o) { return o.id; } }, { h: "Domain", get: function (o) { return o.domain; } }, { h: "Kind", get: function (o) { return o.kind; } },
              { h: "Access control", get: function (o) { return o.oac ? "origin access control" : ""; } }, { h: "Custom headers", get: function (o) { return (o.customHeaders || []).map(function (h) { return h.name || h; }).join(", "); } }], x.origins || []));
          }).catch(function (e) { fail(f.st, e); });
        }) : note("No distributions."));
      return "Read " + r.items.length + " distributions.";
    });
  } });

  var all = [costs, stacks, iam, lambda, cloudfront].filter(Boolean);
  // Called by app.js whenever accounts or sign-in change; and on opening a tab in the twin, the view reads itself.
  function render() {
    all.forEach(function (f) { f.sec.hidden = !P.signedIn(); f.fill(); });
  }
  function opened(name) {
    var f = { costs: costs, stacks: stacks, iam: iam, lambda: lambda, cloudfront: cloudfront }[name];
    if (f && TWIN && P.signedIn() && !f.loaded && P.accounts().length) f.run();
  }
  window.Consoles = { render: render, opened: opened, LIVE: LIVE };
  render();
})();
