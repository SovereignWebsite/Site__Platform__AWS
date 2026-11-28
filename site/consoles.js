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
  var LIVE = { ce: true, budgets: true, cloudformation: true, iam: true, route53: false, lambda: false, firehose: false, logs: false, cloudfront: false, cloudtrail: false };
  var NAMES = { route53: "Route 53", lambda: "Lambda", firehose: "Firehose", logs: "CloudWatch Logs", cloudfront: "CloudFront", cloudtrail: "CloudTrail" };
  // The browser check (Dinis, 28 Nov 2026: "set up the CORS check for the twin-only services"): one read call per
  // service with the read role. A service that answers at all (even "access denied") allows this site from a browser;
  // one the browser blocks fails with a TypeError and no answer. A service seen to answer is read live in this
  // browser from then on (kept in localStorage: a convenience, not a secret); aws.c then records it in LIVE above.
  var CORS_KEY = "sws-aws-cors", checked = {};
  try { checked = JSON.parse(localStorage.getItem(CORS_KEY) || "{}") || {}; } catch (e) { checked = {}; }
  function liveOk(s) { return LIVE[s] || (checked[s] && checked[s].answers); }

  // ---- one send for every API ----
  function account(sel) { var id = sel && sel.value; return P.accounts().filter(function (a) { return a.id === id; })[0] || P.accounts()[0]; }
  function sender(acct, role) {
    return function (req) {
      return P.assume(acct, role || "sws-aws-platform-read").then(function (c) {
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
  // A part of a view that live AWS cannot show yet: say so, offer the browser check, and offer the twin.
  function twinOnly(box, services, f) {
    var names = services.map(function (s) { return NAMES[s] || s; }).join(" and ");
    var go = el("button", { type: "button", class: "quiet", text: "Open this in the twin" });
    go.onclick = function () { if (P.enterTwin) P.enterTwin(true); };
    var check = el("button", { type: "button", text: "Check now: does AWS answer this site?" });
    var out = el("div", {});
    check.onclick = function () {
      check.disabled = true;
      corsCheck(account(f.sel), f.reg ? f.reg.value : "eu-west-2", out).then(function () {
        check.disabled = false;
        if (services.every(liveOk)) f.run();
      });
    };
    box.appendChild(el("div", { class: "card twin-only" }, [
      el("p", { text: names + ": not read from live AWS yet. Whether " + names + " answers this site from a browser has not been checked; until it is, this view runs in the twin (synthetic data) only." }),
      el("p", { class: "small", text: "The check makes one read call to each of Route 53, Lambda, Firehose, CloudWatch Logs, CloudFront and CloudTrail with the read role (listing at most one item each). It changes nothing in AWS." }),
      el("div", { class: "row" }, [check, go]), out]));
  }
  var PROBES = {
    route53: function (send, acct) { return Route53Api(send, { account: acct.id }).zones({ max: 1 }); },
    lambda: function (send, acct, region) { return LambdaApi(send).functions(region, { max: 1 }); },
    firehose: function (send, acct, region) { return FirehoseApi(send, { account: acct.id }).streams(region, { max: 1 }); },
    logs: function (send, acct, region) { return LogsApi(send).groups(region, { max: 1 }); },
    cloudfront: function (send, acct) { return CloudFrontApi(send, { account: acct.id }).distributions({ max: 1 }); },
    cloudtrail: function (send, acct, region) { return CloudTrailApi(send).events(region, { max: 1 }); }
  };
  // Runs every probe, shows each result, and keeps what it learnt. Resolves when all have answered or failed.
  function corsCheck(acct, region, out) {
    out.textContent = ""; if (!acct) { out.appendChild(note("Add an account first (Accounts tab).")); return Promise.resolve(); }
    var send = sender(acct), rows = [];
    var tb = el("tbody", {});
    out.appendChild(el("div", { class: "s3-wrap" }, [el("table", { class: "s3-table" }, [el("thead", {}, [el("tr", {}, [el("th", { text: "Service" }), el("th", { text: "Answers this site?" }), el("th", { text: "What AWS said" })])]), tb])]));
    return Promise.all(Object.keys(PROBES).map(function (s) {
      var cell = el("td", { text: "checking..." }), said = el("td", { text: "" });
      tb.appendChild(el("tr", {}, [el("td", { text: NAMES[s] }), cell, said]));
      return Promise.resolve().then(function () { return PROBES[s](send, acct, region); }).then(function () {
        return { answers: true, said: "answered (" + region + ")" };
      }, function (e) {
        var m = (e && e.message) || String(e);
        // A TypeError with no answer is the browser refusing the cross-site call (or no network).
        if (e instanceof TypeError && /fetch|network|load failed/i.test(m)) return { answers: false, said: "the browser blocked it: no CORS answer (" + m + ")" };
        return { answers: true, said: "answered with an error, so it allows this site; the read role may lack this action: " + m };
      }).then(function (r) {
        r.at = new Date().toISOString(); r.region = region; checked[s] = r; rows.push([s, r]);
        cell.textContent = r.answers ? "yes" : "no"; said.textContent = r.said;
      });
    })).then(function () {
      try { localStorage.setItem(CORS_KEY, JSON.stringify(checked)); } catch (e) { /* kept for this page only */ }
      out.appendChild(note("Kept in this browser: services that answered are now read live here. Send the table to aws.c so it can be recorded for everyone."));
    });
  }
  function needsTwin(services) { return !TWIN && services.some(function (s) { return !liveOk(s); }); }

  // ---- the frame each console shares: account, region (if regional), Load, status, body ----
  function frame(id, opts) {
    var sec = $(id); if (!sec) return null;
    var head = sec.querySelector(".console-controls"), st = sec.querySelector(".status"), body = sec.querySelector(".console-body");
    var sel = el("select", { "aria-label": "Account" }), reg = opts.regional ? el("select", { "aria-label": "Region" }, REGIONS.map(function (r) { return el("option", { value: r, text: r }); })) : null;
    if (reg && opts.region) reg.value = opts.region;
    var extra = opts.controls ? opts.controls() : [];
    var load = el("button", { type: "button", text: opts.button || "Load" });
    head.textContent = ""; head.appendChild(sel); if (reg) head.appendChild(reg); extra.forEach(function (x) { head.appendChild(x); }); head.appendChild(load);
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
    load.onclick = f.run; if (reg) reg.onchange = f.run; sel.onchange = f.run; extra.forEach(function (x) { if (x.tagName === "SELECT") x.onchange = f.run; });
    f.extra = extra;
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
      if (needsTwin(["route53"])) { twinOnly(dns, ["route53"], f); return "Read " + r.items.length + " stacks."; }
      return dnsManager(f, acct, send, dns, live).then(function () { return "Read " + r.items.length + " stacks and the hosted zones."; });
    });
  } });

  // ---- DNS: Route 53 zones and records, read with the read role; changed with the change role after Approve ----
  // Dinis Cruz, 28 Nov 2026: create a hosted zone, view a zone's records, add (and change, and delete) NS, A, CNAME and
  // TXT records from this UI. Every change is shown first as a plan (what the zone holds now, what it will hold after,
  // and what it costs); nothing is sent until Approve. Template v2.2's change role allows exactly these changes.
  var TYPES = ["A", "CNAME", "TXT", "NS"];
  function dnsManager(f, acct, send, dns, live) {
    var r53 = Route53Api(send, { account: acct.id });
    function changer() { return Route53Changes(sender(acct, "sws-aws-platform-change")); }
    function hint(e) { return /AccessDenied|not authorized/i.test(e.message) ? " (The change role needs template v2.2: approve it on the Plans tab.)" : ""; }
    // A plan card: lines before, lines after, a note, and Approve, which runs go() and shows its result.
    function planCard(box, title, before, after, notes, go) {
      box.textContent = "";
      var st = el("p", { class: "status" }), approve = el("button", { type: "button", class: "approve", text: "Approve: make this change" });
      var cancel = el("button", { type: "button", class: "quiet", text: "Cancel" });
      cancel.onclick = function () { box.textContent = ""; };
      box.appendChild(el("div", { class: "card plan-card" }, [el("h4", { text: title }), P.diffView(before, after), el("div", {}, notes.map(note)), el("div", { class: "row" }, [approve, cancel]), st]));
      approve.onclick = function () {
        approve.disabled = true; P.say(st, "Asking AWS with the change role...");
        Promise.resolve().then(go).then(function (msg) { P.say(st, msg, "ok"); cancel.textContent = "Close"; }, function (e) { approve.disabled = false; P.say(st, e.message + hint(e), "bad"); });
      };
    }
    function waitInSync(api, id) {
      var tries = 0;
      function poll() { return api.change(id).then(function (c) { if (c.status === "INSYNC" || ++tries > 20) return c; return new Promise(function (res) { setTimeout(res, 3000); }).then(poll); }); }
      return poll();
    }
    function recLine(r) { return r.name + "  " + r.type + "  " + (r.ttl === null ? "" : r.ttl + " s  ") + (r.alias ? "alias " + r.alias.dnsName : (r.values || []).join("  ")); }
    function full(name, zoneName) { var n = String(name || "").trim().toLowerCase().replace(/\.$/, ""), z = zoneName.replace(/\.$/, ""); return (!n || n === "@" ? z : n === z || n.slice(-(z.length + 1)) === "." + z ? n : n + "." + z) + "."; }
    function quoteTxt(v) { v = v.trim(); return /^".*"$/.test(v) ? v : "\"" + v.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\""; }

    function openZone(zone) {
      var d = detail(f); d.appendChild(h3(zone.name + (zone.comment ? "  (" + zone.comment + ")" : "")));
      var plan = el("div", {});
      return Promise.all([drain(function (n) { return r53.records(zone.id, { next: n }); }), r53.zone(zone.id).catch(function () { return null; })]).then(function (x) {
        var records = x[0].items, info = x[1];
        if (info && info.nameServers && info.nameServers.length) d.appendChild(kv([["Name servers (give these to your domain's registrar)", info.nameServers.join("  ")]]));
        var tb = el("tbody", {});
        records.forEach(function (rec) {
          var acts = el("td", {});
          var editable = TYPES.indexOf(rec.type) >= 0 && !rec.alias && !(rec.type === "NS" && rec.name === zone.name);
          if (editable) {
            var ch = el("button", { type: "button", class: "linkish", text: "Change" }); ch.onclick = function () { fill(rec); };
            var del = el("button", { type: "button", class: "linkish", text: "Delete" });
            del.onclick = function () {
              planCard(plan, "Delete " + rec.type + " " + rec.name, records.map(recLine).join("\n"), records.filter(function (o) { return o !== rec; }).map(recLine).join("\n"),
                ["Route 53 deletes only an exact match (name, type, TTL and values), as shown. Takes effect within about a minute; resolvers may keep the old answer for up to its TTL (" + rec.ttl + " s)."],
                function () { var api = changer(); return api.changeRecords(zone.id, [{ action: "DELETE", record: { name: rec.name, type: rec.type, ttl: rec.ttl, values: rec.values } }], "deleted from aws.platform.sovereignweb.site")
                  .then(function (c) { return waitInSync(api, c.id); }).then(function (c) { openZone(zone); return "Deleted (" + c.status + ")."; }); });
            };
            acts.appendChild(ch); acts.appendChild(document.createTextNode(" ")); acts.appendChild(del);
          }
          tb.appendChild(el("tr", {}, [el("td", { text: rec.name }), el("td", { text: rec.type }), el("td", { class: "n", text: rec.ttl === null ? "" : String(rec.ttl) }),
            el("td", { text: rec.alias ? "alias: " + rec.alias.dnsName : (rec.values || []).join(", ") }), acts]));
        });
        d.appendChild(el("div", { class: "s3-wrap" }, [el("table", { class: "s3-table" }, [el("thead", {}, [el("tr", {}, ["Name", "Type", "TTL", "Points at", ""].map(function (h) { return el("th", { text: h }); }))]), tb])]));

        // Add or change a record
        var name = el("input", { type: "text", placeholder: "name (blank for " + zone.name.replace(/\.$/, "") + ")", "aria-label": "Record name" });
        var type = el("select", { "aria-label": "Record type" }, TYPES.map(function (t) { return el("option", { value: t, text: t }); }));
        var ttl = el("input", { type: "number", min: "0", value: "300", "aria-label": "TTL in seconds", class: "ttl" });
        var vals = el("textarea", { rows: "3", placeholder: "A: IPv4 addresses, one per line. CNAME: one host name. TXT: one text per line (quotes added for you). NS: name servers, one per line.", "aria-label": "Values" });
        var show = el("button", { type: "button", text: "Show the plan" });
        function fill(rec) { name.value = rec.name.replace(/\.$/, ""); type.value = rec.type; ttl.value = rec.ttl; vals.value = rec.type === "TXT" ? rec.values.map(function (v) { return v.replace(/^"|"$/g, ""); }).join("\n") : rec.values.join("\n"); vals.focus(); }
        show.onclick = function () {
          var nm = full(name.value, zone.name), tp = type.value, t = Number(ttl.value);
          var values = vals.value.split("\n").map(function (v) { return v.trim(); }).filter(Boolean).map(function (v) { return tp === "TXT" ? quoteTxt(v) : tp === "A" ? v : v.replace(/\.$/, ""); });
          var existing = records.filter(function (o) { return o.name === nm && o.type === tp; })[0];
          var change = { action: existing ? "UPSERT" : "CREATE", record: { name: nm, type: tp, ttl: t, values: values } };
          if (!Route53Changes.checkChange(change)) return planCard(plan, "Not a valid " + tp + " record", "", "", ["Check the name, the TTL and the values: A needs IPv4 addresses, CNAME exactly one host name, NS host names, TXT up to 255 characters per line."], function () { throw new Error("Fix the record first."); });
          if (tp === "CNAME" && records.some(function (o) { return o.name === nm && o.type !== "CNAME"; })) return planCard(plan, "A CNAME cannot share its name", "", "", ["DNS does not allow a CNAME on a name that has other records (" + nm + ")."], function () { throw new Error("Choose another name."); });
          var after = records.filter(function (o) { return o !== existing; }).concat([{ name: nm, type: tp, ttl: t, values: values }]);
          planCard(plan, (existing ? "Change " : "Add ") + tp + " " + nm, records.map(recLine).join("\n"), after.map(recLine).join("\n"),
            [(existing ? "Replaces the record now there (UPSERT)." : "Adds a new record (CREATE).") + " Takes effect within about a minute; resolvers may keep an old answer for up to its TTL."],
            function () { var api = changer(); return api.changeRecords(zone.id, [change], "from aws.platform.sovereignweb.site").then(function (c) { return waitInSync(api, c.id); }).then(function (c) { openZone(zone); return (existing ? "Changed" : "Added") + " (" + c.status + ")."; }); });
        };
        d.appendChild(el("h4", { text: "Add or change a record" }));
        d.appendChild(el("div", { class: "dns-form" }, [el("div", { class: "row" }, [name, type, ttl]), vals, el("div", { class: "row" }, [show])]));
        d.appendChild(plan);
      }).catch(function (e) { fail(f.st, e); });
    }

    return drain(function (n) { return r53.zones({ next: n }); }).then(function (z) {
      if (!live()) return;
      if (!z.items.length) dns.appendChild(note("No hosted zones yet."));
      else dns.appendChild(table([{ h: "Zone", get: function (x) { return x.name; } }, { h: "Records", n: true, get: function (x) { return x.recordCount; } }, { h: "Private", get: function (x) { return x.private ? "yes" : "no"; } }, { h: "Comment", get: function (x) { return x.comment; } }], z.items, openZone));
      // Create a hosted zone
      var dom = el("input", { type: "text", placeholder: "domain, for example example.org", "aria-label": "Domain for the new zone" });
      var com = el("input", { type: "text", placeholder: "a note for you (optional)", "aria-label": "Comment" });
      var show = el("button", { type: "button", text: "Show the plan" }), plan = el("div", {});
      show.onclick = function () {
        var n = dom.value.trim().toLowerCase().replace(/\.$/, "");
        if (!/^([a-z0-9_-]+\.)+[a-z]{2,63}$/.test(n)) return planCard(plan, "Not a domain name", "", "", ["Type a domain such as example.org or shop.example.org."], function () { throw new Error("Fix the domain first."); });
        var same = z.items.filter(function (x) { return x.name === n + "."; });
        planCard(plan, "Create the public hosted zone " + n, z.items.map(function (x) { return x.name; }).join("\n"), z.items.map(function (x) { return x.name; }).concat([n + ".  (new)"]).join("\n"),
          [(same.length ? "There is already a zone for " + n + ": a second one is allowed, but only one can be the one your registrar points at. " : "") +
            "Cost: $0.50 a month for the zone, charged in full for any part of a month (and per million queries). AWS gives it four name servers; to make it live, set those at the registrar of " + n + ". It starts with its NS and SOA records only."],
          function () {
            var api = changer();
            return api.createZone(n, { comment: com.value.trim() }).then(function (r) {
              return waitInSync(api, r.change.id).then(function () {
                dns.textContent = ""; dns.appendChild(h3("DNS (Route 53)"));
                return dnsManager(f, acct, send, dns, live).then(function () { openZone(r.zone); return "Created " + n + ". Name servers: " + r.nameServers.join(", ") + "."; });
              });
            });
          });
      };
      dns.appendChild(el("h4", { text: "Create a hosted zone" }));
      dns.appendChild(el("div", { class: "row dns-form" }, [dom, com, show]));
      dns.appendChild(plan);
    });
  }

  // ---- IAM roles ----
  function trustedBy(role) {
    var out = [];
    ((role.trust && role.trust.statements) || []).forEach(function (s) { (s.principals || []).forEach(function (p) { out.push(p.kind + ": " + p.id); }); });
    return out.join(", ");
  }
  // ---- Who has access: the people this site's two roles trust, and what each role lets them do ----
  // Dinis, 28 Nov 2026: "a view that shows all the users that we have mapped (and authorized) and what they can do".
  // Read from AWS itself: the Google subjects in the trust of sws-aws-platform-read and -change, and the policies on
  // each role. A Google subject cannot be turned back into a name or an email; the signed-in user is shown as "you".
  var DOES = {
    ViewOnlyAccess: "see the list and settings of most AWS resources (not what is inside them)",
    SecurityAudit: "read security settings: IAM, logging, encryption, network rules",
    "costs-read": "read costs, forecasts and budgets",
    "s3-browse": "list every bucket and open any file in S3",
    "dns-role-trust-only": "change who the DNS deploy role trusts, nothing else",
    "s3-cors": "add this site's CORS rule to a bucket so it can be browsed here",
    "self-update": "update this platform's own stack, through a CloudFormation change set"
  };
  var PLATFORM = [["sws-aws-platform-read", "Read"], ["sws-aws-platform-change", "Change (each change shown as a plan; nothing happens until Approve)"]];
  function googleSubjects(role) {
    var out = { subs: [], aud: [] };
    ((role.trust && role.trust.statements) || []).forEach(function (st) {
      if (st.effect !== "Allow" || !(st.principals || []).some(function (p) { return p.id === "accounts.google.com"; })) return;
      (st.conditions || []).forEach(function (c) {
        if (c.key === "accounts.google.com:sub") out.subs = out.subs.concat(c.values || []);
        if (c.key === "accounts.google.com:aud") out.aud = out.aud.concat(c.values || []);
      });
    });
    return out;
  }
  function whoHasAccess(api, box, live) {
    var me = P.me() || {};
    return Promise.all(PLATFORM.map(function (pr) {
      return Promise.all([api.role(pr[0]), drain(function (n) { return api.attached(pr[0], { next: n }); }), drain(function (n) { return api.inline(pr[0], { next: n }); })])
        .then(function (x) { return { name: pr[0], label: pr[1], role: x[0], policies: x[1].items.map(function (p) { return p.name; }).concat(x[2].items) }; },
          function (e) { return { name: pr[0], label: pr[1], error: e.message }; });
    })).then(function (roles) {
      if (!live()) return;
      box.appendChild(h3("Who has access to this account through this site"));
      var people = {};
      roles.forEach(function (r) { if (r.role) googleSubjects(r.role).subs.forEach(function (s) { (people[s] = people[s] || []).push(r); }); });
      var subs = Object.keys(people);
      if (!subs.length) box.appendChild(note(roles.some(function (r) { return r.error; }) ? "The platform roles could not be read: " + roles.map(function (r) { return r.error; }).filter(Boolean).join("; ") : "No Google account is trusted by this site's roles."));
      else box.appendChild(table([
        { h: "Person (Google account)", get: function (s) { return s === me.sub ? "you" + (me.email ? " (" + me.email + ")" : "") : "another Google account, ID ending " + s.slice(-6); } },
        { h: "Can use", get: function (s) { return people[s].map(function (r) { return r.label.split(" (")[0]; }).join(" and "); } },
        { h: "So they can", get: function (s) { return people[s].map(function (r) { return r.policies.map(function (p) { return DOES[p] || p; }).join("; "); }).join("; "); } }
      ], subs));
      roles.forEach(function (r) {
        if (!r.role) return;
        box.appendChild(el("h4", { text: r.label.split(" (")[0] + " role (" + r.name + ")" }));
        box.appendChild(table([{ h: "Policy", get: function (p) { return p; } }, { h: "Lets the role", get: function (p) { return DOES[p] || "(see the policy in IAM)"; } }], r.policies));
      });
      box.appendChild(note("Read live from IAM: these roles trust only Google sign-ins to this site's app (audience) for the Google account IDs above, for one hour at a time. A Google account ID cannot be turned back into a name, so others show by the end of their ID. Who may assume the roles changes only by changing the account's stack."));
    });
  }
  var iam = frame("console-iam", { button: "Read roles", show: function (f, acct, send, region, live) {
    var api = IamApi(send), access = el("div", { class: "console-access" });
    f.body.appendChild(access);
    var who = whoHasAccess(api, access, live).catch(function (e) { access.appendChild(note("Who has access could not be read: " + e.message)); });
    return who.then(function () { return drain(function (n) { return api.roles({ next: n }); }); }).then(function (r) {
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
              { h: "Actions", get: function (s) { return (s.actions || []).join(", "); } }, { h: "Conditions", get: function (s) { return (s.conditions || []).map(function (c) { return (c.op || c.operator) + " " + c.key + " = " + [].concat(c.values || c.value || []).join(" | "); }).join("; "); } }], (full.trust && full.trust.statements) || []));
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
    if (needsTwin(["lambda", "firehose", "logs"])) { twinOnly(f.body, ["lambda", "firehose", "logs"], f); return "Twin only for now."; }
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
    if (needsTwin(["cloudfront"])) { twinOnly(f.body, ["cloudfront"], f); return "Twin only for now."; }
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

  // ---- Activity: CloudTrail's event history, what this site's browser sessions (and everyone else) did ----
  // The page assumes its roles with session name sws-aws-platform, so CloudTrail's Username for those calls is that name:
  // "This site's sessions" is exactly what was done through this site. Sign-ins themselves (AssumeRoleWithWebIdentity)
  // carry the Google account as Username and show under Everything. LookupEvents is regional: global services such as
  // IAM, STS and Cost Explorer are recorded in us-east-1. Each read is one LookupEvents call per 50 events, up to 200.
  var activity = frame("console-activity", { regional: true, region: "us-east-1", button: "Read activity",
    controls: function () { return [el("select", { "aria-label": "Show" }, [el("option", { value: "site", text: "This site's sessions" }), el("option", { value: "changes", text: "Changes only (no reads)" }), el("option", { value: "all", text: "Everything" })])]; },
    show: function (f, acct, send, region, live) {
      if (needsTwin(["cloudtrail"])) { twinOnly(f.body, ["cloudtrail"], f); return "Twin only for now."; }
      var api = CloudTrailApi(send), which = f.extra[0].value;
      var attribute = which === "site" ? { key: "Username", value: "sws-aws-platform" } : which === "changes" ? { key: "ReadOnly", value: "false" } : null;
      return ApiAll(function (n) { return api.events(region, { attribute: attribute, next: n, max: 50 }); }, { maxItems: 200, maxPages: 4 }).then(function (r) {
        if (!live()) return;
        f.body.appendChild(h3((which === "site" ? "Done through this site" : which === "changes" ? "Changes" : "Everything") + " in " + region + ", newest first (" + r.items.length + (r.capped ? ", the latest 200" : "") + ")"));
        if (!r.items.length) { f.body.appendChild(note("Nothing recorded in " + region + " for this choice in the last 90 days. IAM, STS and Cost Explorer are recorded in us-east-1.")); return "No events."; }
        f.body.appendChild(table([{ h: "Time (UTC)", get: function (e) { return when(e.time); } }, { h: "Who", get: function (e) { return e.actor; } },
          { h: "Did", get: function (e) { return e.name; } }, { h: "Service", get: function (e) { return String(e.source || "").replace(".amazonaws.com", ""); } },
          { h: "Kind", get: function (e) { return e.readOnly ? "read" : "change"; } },
          { h: "On", get: function (e) { var p = e.record.requestParameters || {}; return e.resources.map(function (x) { return x.name; }).join(", ") || p.roleName || p.bucketName || p.stackName || p.typeName || p.roleArn || ""; } }], r.items,
          function (e) {
            var d = detail(f); d.appendChild(h3(e.name + " at " + when(e.time) + " UTC"));
            d.appendChild(kv([["Who", e.actor], ["Kind", e.readOnly ? "read" : "change"], ["Region", e.region], ["From", e.record.sourceIPAddress], ["Event id", e.id]]));
            d.appendChild(el("h4", { text: "The CloudTrail record" }));
            d.appendChild(window.S3Browser && S3Browser.jsonView ? S3Browser.jsonView(e.record) : el("pre", { text: JSON.stringify(e.record, null, 2) }));
          }));
        return "Read " + r.items.length + " events.";
      });
    } });

  var all = [costs, stacks, iam, lambda, cloudfront, activity].filter(Boolean);
  // Called by app.js whenever accounts or sign-in change; and on opening a tab in the twin, the view reads itself.
  function render() {
    all.forEach(function (f) { f.sec.hidden = !P.signedIn(); f.fill(); });
  }
  function opened(name) {
    var f = { costs: costs, stacks: stacks, iam: iam, lambda: lambda, cloudfront: cloudfront, activity: activity }[name];
    if (f && TWIN && P.signedIn() && !f.loaded && P.accounts().length) f.run();
  }
  window.Consoles = { render: render, opened: opened, LIVE: LIVE, corsCheck: corsCheck, checked: function () { return checked; }, liveOk: function (svc) { return TWIN || !!liveOk(svc); }, sender: sender };
  render();
})();
