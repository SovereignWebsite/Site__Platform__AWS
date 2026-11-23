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
  var state = { acct: null, region: "us-east-1", bucket: null, prefix: "", view: 0, file: 0 };
  // Quick clicks: each new view (buckets, a bucket, a folder) and each file opened takes a number; an answer that
  // comes back after a newer click is dropped, so a slow, older answer never lands under the newer one.
  function newView(alsoFile) { if (alsoFile) state.file++; return ++state.view; }

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
  function s3get(c, url, region, extra) {
    return SigV4.sign({ method: "GET", url: url, headers: extra || {}, body: "" }, c, region, "s3").then(function (h) { return AwsTransport.fetch(url, { headers: h }); });
  }
  function read() { return P.assume(state.acct, "sws-aws-platform-read"); }

  // ---- buckets ----
  function listBuckets() {
    var out = $("s3-buckets"), st = $("s3-status"), my = newView(true);
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
      if (my !== state.view) return;
      names.sort();
      names.forEach(function (n) {
        var b = P.el("button", { type: "button", text: n, "aria-pressed": "false" });
        b.onclick = function () { Array.prototype.forEach.call(out.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); openBucket(n); };
        out.appendChild(P.el("li", {}, [b]));
      });
      P.say(st, names.length + " bucket" + (names.length === 1 ? "" : "s") + ".", "ok");
    }).catch(function (e) { if (my === state.view) P.say(st, e.message + (/AccessDenied|not authorized/.test(e.message) ? " (The account needs template v2: see step 3.)" : ""), "bad"); });
  }

  // ---- a bucket: check its CORS rule, offer the plan, then list ----
  function openBucket(name) {
    state.bucket = name; state.prefix = "";
    var my = newView(true), st = $("s3-status"), box = $("s3-objects"); box.textContent = ""; $("s3-file").textContent = "";
    P.say(st, "Reading " + name + "'s settings...");
    read().then(function (c) { return cc(c, "GetResource", { TypeName: "AWS::S3::Bucket", Identifier: name }); }).then(function (j) {
      if (my !== state.view) return;
      var props = JSON.parse(j.ResourceDescription.Properties || "{}");
      var m = /\.s3\.([a-z0-9-]+)\.amazonaws\.com$/.exec(props.RegionalDomainName || "");
      state.bucketRegion = m ? m[1] : state.region;
      var plan = Plans.corsPlan(props, location.origin);
      if (plan.unchanged) return listObjects();
      showCorsPlan(name, plan);
    }).catch(function (e) { if (my === state.view) P.say(st, e.message, "bad"); });
  }
  function showCorsPlan(name, plan) {
    var box = $("s3-objects"), st = P.el("p", { class: "status" });
    P.say($("s3-status"), "");
    box.appendChild(P.el("p", { text: name + " does not answer this site yet. S3 lets a web page read a bucket only when the bucket's CORS rules allow it. This plan adds one rule: GET and HEAD, from " + location.origin + " only. Rules already there are kept." }));
    var now = plan.before ? JSON.stringify(plan.before, null, 2) : "", after = JSON.stringify(plan.after, null, 2);
    box.appendChild(P.el("h4", { text: "What changes (- removed, + added)" }));
    box.appendChild(P.diffView(now, after));
    box.appendChild(P.el("details", { class: "full" }, [P.el("summary", { text: "All the CORS rules, now and after" }),
      P.el("h4", { text: "Now" }), P.el("pre", { text: now || "(none)" }), P.el("h4", { text: "After you approve" }), P.el("pre", { text: after })]));
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
      }).then(function () { if (state.bucket !== name) return; P.say($("s3-status"), "Applied: " + name + " now answers this site.", "ok"); return openBucket(name); })
        .catch(function (e) { go.disabled = false; P.say(st, e.message, "bad"); });
    };
    box.appendChild(go); box.appendChild(st);
    P.say(st, "This is the plan. Nothing has changed yet.");
  }

  function listObjects(token) {
    var box = $("s3-objects"), st = $("s3-status"), b = state.bucket, region = state.bucketRegion;
    var my = token ? state.view : newView(false);
    if (!token) box.textContent = "";
    P.say(st, "Listing " + b + "/" + state.prefix + "...");
    read().then(function (c) {
      var q = "?list-type=2&delimiter=%2F&max-keys=500" + (state.prefix ? "&prefix=" + encodeURIComponent(state.prefix) : "") + (token ? "&continuation-token=" + encodeURIComponent(token) : "");
      return s3get(c, bucketUrl(b, region, q), region).then(function (r) {
        return r.text().then(function (t) { var d = new DOMParser().parseFromString(t, "text/xml"); if (!r.ok) throw P.awsError(d, r.status); return d; });
      });
    }).then(function (d) {
      if (my !== state.view) return;
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
    }).catch(function (e) { if (my === state.view) P.say(st, e.message + (/Failed to fetch/.test(e.message) ? " (S3 refused the browser: check the bucket's CORS rule and region " + region + ".)" : ""), "bad"); });
  }
  function human(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

  // ---- a file ----
  var TEXT = /\.(txt|md|csv|tsv|log|yaml|yml|xml|html|htm|css|js|mjs|ts|py|sh|toml|ini|cfg|conf|sql|svg)$/i;
  var IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  function isGzip(u8) { return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b; }
  function gunzip(u8) {
    return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function downloadLink(name, blob) { return P.el("a", { class: "button", href: URL.createObjectURL(blob), download: name, text: "Download" }); }

  // Show bytes as JSON (formatted), JSON Lines, text, an image, or "use Download". Never runs anything.
  function show(box, name, type, u8, st) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    var img = /^image\//.test(type) && type !== "image/svg+xml" ? type : IMAGE[ext];
    if (img) { box.appendChild(P.el("img", { src: URL.createObjectURL(new Blob([u8], { type: img })), alt: name, class: "s3-img" })); return P.say(st, name, "ok"); }
    if (u8.length > MAX_SHOW) return P.say(st, name + ": too large to show here (" + human(u8.length) + "); use Download.", "ok");
    var text = new TextDecoder("utf-8").decode(u8), json;
    if (/json/.test(type) || /\.(json|geojson|ipynb)$/i.test(name) || /^\s*[\[{]/.test(text)) {
      try { json = JSON.parse(text); box.appendChild(jsonView(json)); return P.say(st, name + ": JSON, formatted.", "ok"); } catch (e) { /* not one JSON value */ }
    }
    if (/\.(jsonl|ndjson)$/i.test(name) || /^\s*\{/.test(text)) {
      try {
        var rows = text.split("\n").filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); });
        if (rows.length) { box.appendChild(jsonView(rows)); return P.say(st, name + ": JSON Lines (" + rows.length + "), formatted.", "ok"); }
      } catch (e) { /* not JSON Lines */ }
    }
    if (/^text\/|xml|javascript|yaml/.test(type) || TEXT.test(name) || !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 4096))) {
      var coloured = window.Highlight && Highlight.highlight(name, text, document);
      box.appendChild(coloured || P.el("pre", { text: text })); return P.say(st, name, "ok");
    }
    P.say(st, name + ": not text; use Download.", "ok");
  }

  function openFile(key, size) {
    var box = $("s3-file"), st = $("s3-status"), my = ++state.file; box.textContent = "";
    var name = key.split("/").pop();
    function current() { return my === state.file; }
    box.appendChild(P.el("h4", { text: key }));
    if (window.Zip && Zip.isZip(key) && size > 22) return openZip(key, size, name, box, st, current);
    P.say(st, "Opening " + key + " (" + human(size) + ")...");
    read().then(function (c) { return s3get(c, bucketUrl(state.bucket, state.bucketRegion, "", key), state.bucketRegion); }).then(function (r) {
      if (!current()) return;
      if (!r.ok) return r.text().then(function (t) { throw P.awsError(new DOMParser().parseFromString(t, "text/xml"), r.status); });
      var type = (r.headers.get("content-type") || "").split(";")[0];
      return r.arrayBuffer().then(function (ab) {
        if (!current()) return;
        var u8 = new Uint8Array(ab);
        box.appendChild(P.el("p", { class: "row" }, [downloadLink(name, new Blob([u8], { type: type })), P.el("span", { class: "small", text: type + ", " + human(u8.length) })]));
        // .gz (or gzip bytes): unzip in the browser and show what is inside. If S3 already sent it
        // unzipped (Content-Encoding: gzip), the bytes are not gzip and are shown as they are.
        if (isGzip(u8)) {
          var inner = name.replace(/\.gz$/i, "");
          return gunzip(u8).then(function (out) {
            if (!current()) return;
            box.appendChild(P.el("p", { class: "small", text: "gzip: " + human(u8.length) + " unzipped to " + human(out.length) + " in this browser." }));
            show(box, inner, "", out, st);
          });
        }
        show(box, name, type, u8, st);
      });
    }).catch(function (e) { if (current()) P.say(st, e.message, "bad"); });
  }

  // ---- inside a zip, by byte ranges (zip.js) ----
  function openZip(key, size, name, box, st, current) {
    var url = bucketUrl(state.bucket, state.bucketRegion, "", key), region = state.bucketRegion, got = 0;
    function fetchRange(a, b) {
      got += b - a + 1;
      return read().then(function (c) { return s3get(c, url, region, { Range: "bytes=" + a + "-" + b }); }).then(function (r) {
        if (r.status !== 206 && r.status !== 200) return r.text().then(function (t) { throw P.awsError(new DOMParser().parseFromString(t, "text/xml"), r.status); });
        return r.arrayBuffer();
      });
    }
    var dl = P.el("button", { type: "button", text: "Download the zip (" + human(size) + ")" });
    dl.onclick = function () {
      dl.disabled = true; P.say(st, "Downloading " + name + "...");
      read().then(function (c) { return s3get(c, url, region); }).then(function (r) { return r.blob(); }).then(function (b) {
        var a = downloadLink(name, b); document.body.appendChild(a); a.click(); a.remove(); dl.disabled = false; P.say(st, name + " downloaded.", "ok");
      }).catch(function (e) { dl.disabled = false; P.say(st, e.message, "bad"); });
    };
    box.appendChild(P.el("p", { class: "row" }, [dl]));
    P.say(st, "Reading the index at the end of " + name + "...");
    Zip.list(fetchRange, size).then(function (entries) {
      if (!current()) return;
      var files = entries.filter(function (e) { return !e.dir; });
      box.appendChild(P.el("p", { class: "small", text: files.length + " files inside; listed by reading " + human(got) + " of " + human(size) + "." }));
      var filter = P.el("input", { type: "search", class: "filter", placeholder: "Filter the files inside", "aria-label": "Filter the files inside" });
      var tbody = P.el("tbody", {});
      var viewer = P.el("div", { class: "viewer" }), inside = 0;
      filter.oninput = function () { var q = filter.value.toLowerCase(); Array.prototype.forEach.call(tbody.rows, function (tr) { tr.hidden = q && tr.textContent.toLowerCase().indexOf(q) < 0; }); };
      files.forEach(function (e) {
        var b = P.el("button", { type: "button", class: "linkish", text: e.name });
        b.onclick = function () {
          viewer.textContent = ""; viewer.appendChild(P.el("h4", { text: e.name }));
          var before = got, mine = ++inside; P.say(st, "Opening " + e.name + " from inside " + name + "...");
          Zip.read(fetchRange, e).then(function (u8) {
            if (mine !== inside || !current()) return;
            var inner = e.name.split("/").pop();
            viewer.appendChild(P.el("p", { class: "row" }, [downloadLink(inner, new Blob([u8])), P.el("span", { class: "small", text: human(u8.length) + ", fetched " + human(got - before) + " of the zip" })]));
            show(viewer, inner, "", u8, st);
            viewer.scrollIntoView({ block: "nearest" });
          }).catch(function (err) { if (mine === inside && current()) P.say(st, err.message, "bad"); });
        };
        tbody.appendChild(P.el("tr", { class: "file" }, [P.el("td", {}, [b]), P.el("td", { class: "n", text: human(e.size) }), P.el("td", { class: "n", text: e.modified })]));
      });
      var table = P.el("table", { class: "s3-table" }, [P.el("thead", {}, [P.el("tr", {}, [P.el("th", { text: "Inside " + name }), P.el("th", { text: "Size" }), P.el("th", { text: "Modified" })])]), tbody]);
      box.appendChild(P.el("div", { class: "toolbar" }, [filter]));
      box.appendChild(P.el("div", { class: "s3-wrap" }, [table]));
      box.appendChild(viewer);
      P.say(st, name + ": " + files.length + " files inside.", "ok");
    }).catch(function (e) { if (current()) P.say(st, e.message, "bad"); });
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
