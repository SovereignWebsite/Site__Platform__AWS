// The S3 browser: list an account's buckets, walk a bucket's folders, open a file (JSON shown formatted).
// Dinis Cruz, 23 Nov 2026: "can we do a variation of this to show me an S3 browser on the web?"; the read role
// "should also open file[s]" and "should also show JSON well formatted".
// - Buckets are listed through Cloud Control (S3's own ListBuckets does not answer web pages).
// - S3 answers a web page only for a bucket whose CORS rules allow this site. The first time, the page offers a
//   plan that adds one rule (GET and HEAD from this site only), through Cloud Control, on the owner's Approve.
// - Everything from a bucket is shown as text or a picture, never run: names and contents go through
//   textContent, files open as blobs.
(function () {
  "use strict";
  var P = window.Platform, $ = function (id) { return document.getElementById(id); };
  var MAX_SHOW = 5 * 1024 * 1024;
  var state = { acct: null, region: "us-east-1", bucket: null, prefix: "" };

  // Cloud Control: listing and reading work from us-east-1 for buckets in any region (checked 23 Nov 2026);
  // a change must go to the bucket's own region (S3 answers 301 otherwise).
  function cc(c, target, payload, region) {
    region = region || state.region;
    return P.jsonCall(c, "cloudcontrolapi." + region + ".amazonaws.com", "cloudcontrolapi", "CloudApiService." + target, payload, region, "1.0");
  }
  function bucketUrl(bucket, region, query, key) {
    var path = key ? "/" + key.split("/").map(encodeURIComponent).join("/") : "/";
    // Names with dots do not match S3's certificate as a host name: use the path form for those.
    if (bucket.indexOf(".") >= 0) return "https://s3." + region + ".amazonaws.com/" + encodeURIComponent(bucket) + path + (query || "");
    return "https://" + bucket + ".s3." + region + ".amazonaws.com" + path + (query || "");
  }
  function s3get(c, url, region) {
    return SigV4.sign({ method: "GET", url: url, headers: {}, body: "" }, c, region, "s3").then(function (h) { return fetch(url, { headers: h }); });
  }
  function read() { return P.assume(state.acct, "sws-aws-platform-read"); }

  // ---- buckets ----
  function listBuckets() {
    var out = $("s3-buckets"), st = $("s3-status");
    out.textContent = ""; $("s3-objects").textContent = ""; $("s3-file").textContent = ""; P.say(st, "Listing buckets...");
    read().then(function (c) {
      var all = [];
      function page(token) {
        var q = { TypeName: "AWS::S3::Bucket", MaxResults: 100 }; if (token) q.NextToken = token;
        return cc(c, "ListResources", q).then(function (j) {
          (j.ResourceDescriptions || []).forEach(function (r) { all.push(r.Identifier); });
          return j.NextToken ? page(j.NextToken) : all;
        });
      }
      return page(null);
    }).then(function (names) {
      names.sort();
      names.forEach(function (n) {
        var b = P.el("button", { type: "button", text: n, "aria-pressed": "false" });
        b.onclick = function () { Array.prototype.forEach.call(out.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); openBucket(n); };
        out.appendChild(P.el("li", {}, [b]));
      });
      P.say(st, names.length + " bucket" + (names.length === 1 ? "" : "s") + ".", "ok");
    }).catch(function (e) { P.say(st, e.message + (/AccessDenied|not authorized/.test(e.message) ? " (The account needs template v2: see step 3.)" : ""), "bad"); });
  }

  // ---- a bucket: check its CORS rule, offer the plan, then list ----
  function openBucket(name) {
    state.bucket = name; state.prefix = "";
    var st = $("s3-status"), box = $("s3-objects"); box.textContent = ""; $("s3-file").textContent = "";
    P.say(st, "Reading " + name + "'s settings...");
    read().then(function (c) { return cc(c, "GetResource", { TypeName: "AWS::S3::Bucket", Identifier: name }); }).then(function (j) {
      var props = JSON.parse(j.ResourceDescription.Properties || "{}");
      var m = /\.s3\.([a-z0-9-]+)\.amazonaws\.com$/.exec(props.RegionalDomainName || "");
      state.bucketRegion = m ? m[1] : state.region;
      var plan = Plans.corsPlan(props, location.origin);
      if (plan.unchanged) return listObjects();
      showCorsPlan(name, plan);
    }).catch(function (e) { P.say(st, e.message, "bad"); });
  }
  function showCorsPlan(name, plan) {
    var box = $("s3-objects"), st = P.el("p", { class: "status" });
    P.say($("s3-status"), "");
    box.appendChild(P.el("p", { text: name + " does not answer this site yet. S3 lets a web page read a bucket only when the bucket's CORS rules allow it. This plan adds one rule: GET and HEAD, from " + location.origin + " only. Rules already there are kept." }));
    box.appendChild(P.el("h4", { text: "CORS rules now" })); box.appendChild(P.el("pre", { text: plan.before ? JSON.stringify(plan.before, null, 2) : "(none)" }));
    box.appendChild(P.el("h4", { text: "After you approve" })); box.appendChild(P.el("pre", { text: JSON.stringify(plan.after, null, 2) }));
    var go = P.el("button", { type: "button", class: "approve", text: "Approve and add the rule to " + name });
    go.onclick = function () {
      go.disabled = true; P.say(st, "Asking Cloud Control to add the rule...");
      P.assume(state.acct, "sws-aws-platform-change").then(function (c) {
        var r = state.bucketRegion;
        return cc(c, "UpdateResource", { TypeName: "AWS::S3::Bucket", Identifier: name, PatchDocument: JSON.stringify(plan.patch) }, r).then(function (j) {
          var token = j.ProgressEvent.RequestToken;
          function poll(n) {
            return cc(c, "GetResourceRequestStatus", { RequestToken: token }, r).then(function (s) {
              var op = s.ProgressEvent.OperationStatus;
              if ((op === "PENDING" || op === "IN_PROGRESS") && n < 60) return new Promise(function (r) { setTimeout(r, 2000); }).then(function () { return poll(n + 1); });
              if (op !== "SUCCESS") throw new Error("Cloud Control " + op + ": " + (s.ProgressEvent.StatusMessage || ""));
            });
          }
          return poll(0);
        });
      }).then(function () { P.say($("s3-status"), "Applied: " + name + " now answers this site.", "ok"); return openBucket(name); })
        .catch(function (e) { go.disabled = false; P.say(st, e.message, "bad"); });
    };
    box.appendChild(go); box.appendChild(st);
    P.say(st, "This is the plan. Nothing has changed yet.");
  }

  function listObjects(token) {
    var box = $("s3-objects"), st = $("s3-status"), b = state.bucket, region = state.bucketRegion;
    if (!token) box.textContent = "";
    P.say(st, "Listing " + b + "/" + state.prefix + "...");
    read().then(function (c) {
      var q = "?list-type=2&delimiter=%2F&max-keys=500" + (state.prefix ? "&prefix=" + encodeURIComponent(state.prefix) : "") + (token ? "&continuation-token=" + encodeURIComponent(token) : "");
      return s3get(c, bucketUrl(b, region, q), region).then(function (r) {
        return r.text().then(function (t) { var d = new DOMParser().parseFromString(t, "text/xml"); if (!r.ok) throw P.awsError(d, r.status); return d; });
      });
    }).then(function (d) {
      if (!token) {
        var crumbs = P.el("p", { class: "crumbs" }), parts = state.prefix.split("/").filter(Boolean), acc = "";
        var root = P.el("button", { type: "button", class: "linkish", text: b }); root.onclick = function () { state.prefix = ""; listObjects(); };
        crumbs.appendChild(root);
        parts.forEach(function (p) {
          acc += p + "/"; var at = acc;
          var x = P.el("button", { type: "button", class: "linkish", text: p }); x.onclick = function () { state.prefix = at; listObjects(); };
          crumbs.appendChild(document.createTextNode(" / ")); crumbs.appendChild(x);
        });
        box.appendChild(crumbs);
        var filter = P.el("input", { type: "search", class: "filter", placeholder: "Filter this folder", "aria-label": "Filter this folder" });
        filter.oninput = function () {
          var q = filter.value.toLowerCase();
          Array.prototype.forEach.call($("s3-list").rows, function (tr) { tr.hidden = q && tr.textContent.toLowerCase().indexOf(q) < 0; });
        };
        box.appendChild(P.el("div", { class: "toolbar" }, [filter]));
        var table = P.el("table", { class: "s3-table" });
        var head = P.el("thead", {}, [P.el("tr", {}, [P.el("th", { text: "Name" }), P.el("th", { text: "Size" }), P.el("th", { text: "Modified (UTC)" })])]);
        table.appendChild(head); table.appendChild(P.el("tbody", { id: "s3-list" }));
        box.appendChild(P.el("div", { class: "s3-wrap" }, [table]));
      }
      var list = $("s3-list");
      Array.prototype.forEach.call(d.getElementsByTagName("CommonPrefixes"), function (cp) {
        var pfx = cp.getElementsByTagName("Prefix")[0].textContent;
        var x = P.el("button", { type: "button", class: "linkish", text: pfx.slice(state.prefix.length) }); x.onclick = function () { state.prefix = pfx; listObjects(); };
        list.appendChild(P.el("tr", { class: "folder" }, [P.el("td", {}, [x]), P.el("td", { class: "n", text: "" }), P.el("td", { class: "n", text: "" })]));
      });
      Array.prototype.forEach.call(d.getElementsByTagName("Contents"), function (o) {
        var key = o.getElementsByTagName("Key")[0].textContent, size = +o.getElementsByTagName("Size")[0].textContent;
        var when = (o.getElementsByTagName("LastModified")[0] || {}).textContent || "";
        if (key === state.prefix) return;
        var x = P.el("button", { type: "button", class: "linkish", text: key.slice(state.prefix.length) }); x.onclick = function () { openFile(key, size); };
        list.appendChild(P.el("tr", { class: "file" }, [P.el("td", {}, [x]), P.el("td", { class: "n", text: human(size) }), P.el("td", { class: "n", text: when.slice(0, 16).replace("T", " ") })]));
      });
      var nt = d.getElementsByTagName("NextContinuationToken")[0];
      if (nt) { var more = P.el("button", { type: "button", class: "quiet", text: "Load more" }); more.onclick = function () { more.remove(); listObjects(nt.textContent); }; box.appendChild(P.el("div", { class: "row" }, [more])); }
      P.say(st, b + "/" + state.prefix, "ok");
    }).catch(function (e) { P.say(st, e.message + (/Failed to fetch/.test(e.message) ? " (S3 refused the browser: check the bucket's CORS rule and region " + region + ".)" : ""), "bad"); });
  }
  function human(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

  // ---- a file ----
  var TEXT = /\.(txt|md|csv|tsv|log|yaml|yml|xml|html|htm|css|js|mjs|ts|py|sh|toml|ini|cfg|conf|sql|svg)$/i;
  function openFile(key, size) {
    var box = $("s3-file"), st = $("s3-status"); box.textContent = "";
    var name = key.split("/").pop();
    box.appendChild(P.el("h4", { text: key }));
    P.say(st, "Opening " + key + " (" + human(size) + ")...");
    read().then(function (c) { return s3get(c, bucketUrl(state.bucket, state.bucketRegion, "", key), state.bucketRegion); }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw P.awsError(new DOMParser().parseFromString(t, "text/xml"), r.status); });
      var type = (r.headers.get("content-type") || "").split(";")[0];
      return r.blob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        box.appendChild(P.el("p", { class: "row" }, [P.el("a", { class: "button", href: url, download: name, text: "Download" }), P.el("span", { class: "small", text: type + ", " + human(blob.size) })]));
        if (/^image\//.test(type) && type !== "image/svg+xml") { box.appendChild(P.el("img", { src: url, alt: key, class: "s3-img" })); return P.say(st, key, "ok"); }
        if (blob.size > MAX_SHOW) return P.say(st, key + ": too large to show here; use Download.", "ok");
        return blob.text().then(function (text) {
          var json = null;
          if (/json/.test(type) || /\.(json|jsonl|geojson|ipynb)$/i.test(key) || /^\s*[\[{]/.test(text)) { try { json = JSON.parse(text); } catch (e) { json = null; } }
          if (json !== null) { box.appendChild(jsonView(json)); return P.say(st, key + ": JSON, formatted.", "ok"); }
          if (/^text\/|xml|javascript|yaml/.test(type) || TEXT.test(key) || !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 4096))) {
            box.appendChild(P.el("pre", { text: text })); return P.say(st, key, "ok");
          }
          P.say(st, key + ": not text; use Download.", "ok");
        });
      });
    }).catch(function (e) { P.say(st, e.message, "bad"); });
  }

  // JSON, formatted and coloured, built from DOM nodes (never from HTML strings).
  function jsonView(value) {
    var pre = P.el("pre", { class: "json" });
    function span(cls, text) { var s = document.createElement("span"); s.className = cls; s.textContent = text; pre.appendChild(s); }
    function text(t) { pre.appendChild(document.createTextNode(t)); }
    function walk(v, ind) {
      var pad = "  ".repeat(ind + 1), end = "  ".repeat(ind);
      if (Array.isArray(v)) {
        if (!v.length) return text("[]");
        text("[\n"); v.forEach(function (x, i) { text(pad); walk(x, ind + 1); text(i < v.length - 1 ? ",\n" : "\n"); }); text(end + "]");
      } else if (v && typeof v === "object") {
        var ks = Object.keys(v); if (!ks.length) return text("{}");
        text("{\n"); ks.forEach(function (k, i) { text(pad); span("j-key", JSON.stringify(k)); text(": "); walk(v[k], ind + 1); text(i < ks.length - 1 ? ",\n" : "\n"); }); text(end + "}");
      } else if (typeof v === "string") span("j-str", JSON.stringify(v));
      else if (typeof v === "number") span("j-num", String(v));
      else span("j-lit", String(v));
    }
    walk(value, 0);
    return pre;
  }

  // ---- the section ----
  function render() {
    var sec = $("step4"); if (!sec) return;
    var accts = P.accounts();
    sec.hidden = !P.signedIn();
    var sel = $("s3-account"), keep = sel.value; sel.textContent = "";
    accts.forEach(function (a) { sel.appendChild(P.el("option", { value: a.id, text: a.label })); });
    if (keep) sel.value = keep;
    var lb = $("s3-list-buckets"); if (lb) lb.disabled = !accts.length;
  }
  function init() {
    $("s3-list-buckets").onclick = function () {
      state.acct = P.accounts().filter(function (a) { return a.id === $("s3-account").value; })[0];
      state.region = "us-east-1";
      if (state.acct) listBuckets();
    };
    render();
  }
  window.S3Browser = { render: render, jsonView: jsonView };
  init();
})();
