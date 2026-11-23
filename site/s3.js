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
  // show: files up to this size are fetched whole and shown; larger ones are previewed from their first `preview`
  // bytes (one Range request), and the whole file is fetched only when the user asks for it with Download.
  var LIMITS = { show: 5 * 1024 * 1024, preview: 256 * 1024 };
  var state = { acct: null, region: "us-east-1", bucket: null, prefix: "", view: 0, file: 0, sizes: {}, key: "" };
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

  // ---- the address: #/s3/<bucket>/<folder or file> ----
  // Reload, Back and a shared link keep the place. The account is never in the address (its ID stays on the device).
  // An address is input from whoever sent the link: the bucket must be a valid S3 name and one of this account's
  // buckets before S3 is asked anything, and an address only ever reads; it cannot approve or change anything.
  var BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, pending = null;
  function route(bucket, path) { return "#/s3/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/"); }
  function go(bucket, path) { var h = route(bucket, path); if (location.hash !== h) location.hash = h; }
  // The address already says where the page is (it was written by the page itself, or nothing moved).
  function here(r) { return !!r && !r.bad && r.bucket === state.bucket && r.prefix === state.prefix && r.key === state.key; }
  function parse(hash) {
    var m = /^#\/s3\/([^/]*)\/(.*)$/.exec(hash || ""), path; if (!m) return null;
    try { path = m[2].split("/").map(decodeURIComponent).join("/"); } catch (e) { return { bad: true }; }
    if (!BUCKET.test(m[1]) || path.length > 1024 || /(^|\/)\.\.?(\/|$)/.test(path)) return { bad: true };
    var cut = path.lastIndexOf("/") + 1;
    return { bucket: m[1], prefix: path.slice(0, cut), key: cut < path.length ? path : "" };
  }
  function pickAccount() {
    if (!state.acct) state.acct = P.accounts().filter(function (a) { return a.id === $("s3-account").value; })[0] || P.accounts()[0] || null;
    return state.acct;
  }
  function press(name) { Array.prototype.forEach.call($("s3-buckets").querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x.textContent === name ? "true" : "false"); }); }
  function apply(r) {
    if (!r) return;
    var st = $("s3-status");
    if (r.bad) return P.say(st, "This address does not name an S3 bucket and file; nothing was opened.", "bad");
    if (!P.signedIn() || !pickAccount()) { pending = r; return; }
    var tab = $("tab-s3"); if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
    if (r.bucket === state.bucket && state.bucketRegion && $("s3-list")) {
      // Same bucket, already answering: only the folder or the file changes.
      if (r.prefix !== state.prefix) { state.prefix = r.prefix; return listObjects(null, r.key); }
      if (r.key) return openFile(r.key, state.sizes[r.key]);
      state.file++; state.key = ""; $("s3-file").textContent = ""; return;
    }
    listBuckets(function (names) {
      if (names.indexOf(r.bucket) < 0) return P.say(st, r.bucket + " is not one of this account's buckets; nothing was opened.", "bad");
      press(r.bucket); openBucket(r.bucket, r);
    });
  }
  window.addEventListener("hashchange", function () {
    var r = parse(location.hash);
    if (!here(r)) apply(r);
  });

  // ---- buckets ----
  function listBuckets(then) {
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
        b.onclick = function () { press(n); openBucket(n); };
        out.appendChild(P.el("li", {}, [b]));
      });
      P.say(st, names.length + " bucket" + (names.length === 1 ? "" : "s") + ".", "ok");
      if (then) then(names);
    }).catch(function (e) { if (my === state.view) P.say(st, e.message + (/AccessDenied|not authorized/.test(e.message) ? " (The account needs template v2: see step 3.)" : ""), "bad"); });
  }

  // ---- a bucket: check its CORS rule, offer the plan, then list ----
  // at: { prefix, key } when opened from an address; otherwise the bucket's top.
  function openBucket(name, at) {
    state.bucket = name; state.prefix = ""; state.key = ""; state.bucketRegion = null;
    if (!at) go(name, "");
    var my = newView(true), st = $("s3-status"), box = $("s3-objects"); box.textContent = ""; $("s3-file").textContent = "";
    P.say(st, "Reading " + name + "'s settings...");
    read().then(function (c) { return cc(c, "GetResource", { TypeName: "AWS::S3::Bucket", Identifier: name }); }).then(function (j) {
      if (my !== state.view) return;
      var props = JSON.parse(j.ResourceDescription.Properties || "{}");
      var m = /\.s3\.([a-z0-9-]+)\.amazonaws\.com$/.exec(props.RegionalDomainName || "");
      state.bucketRegion = m ? m[1] : state.region;
      var plan = Plans.corsPlan(props, location.origin);
      if (plan.unchanged) { state.prefix = at ? at.prefix : ""; return listObjects(null, at && at.key); }
      showCorsPlan(name, plan);
    }).catch(function (e) { if (my === state.view) P.say(st, e.message, "bad"); });
  }
  function showCorsPlan(name, plan) {
    var box = $("s3-objects"), st = P.el("p", { class: "status" });
    P.say($("s3-status"), "");
    box.appendChild(P.el("p", { text: name + " does not answer this site yet. S3 lets a web page read a bucket only when the bucket's CORS rules allow it. This plan adds one rule: GET and HEAD, from " + location.origin + " only. Rules already there are kept." }));
    var now = plan.before ? JSON.stringify(plan.before, null, 2) : "", after = JSON.stringify(plan.after, null, 2);
    box.appendChild(P.el("h4", { text: "What changes (- removed, + added)" }));
    box.appendChild(P.diffView(now, after, P.jsonLine));
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

  // openKey: a file to open once its folder is listed (from an address).
  // ---- listing cache (item 11): going back up a folder, or between folders, answers from memory for a minute ----
  // Keyed by account, bucket, folder and page token; only successful answers are kept; Refresh asks S3 again.
  var LIST_CACHE = Object.create(null), LIST_CACHE_MS = 60000;
  function fetchList(b, region, prefix, token, fresh) {
    var k = [state.acct && state.acct.id, b, prefix, token || ""].join("\n"), hit = LIST_CACHE[k];
    // Answers only while signed in (the cache is in memory only, never stored, and gone on reload).
    if (!fresh && hit && P.signedIn() && Date.now() - hit.at < LIST_CACHE_MS) return Promise.resolve({ d: new DOMParser().parseFromString(hit.text, "text/xml"), age: Date.now() - hit.at });
    return read().then(function (c) {
      var q = "?list-type=2&delimiter=%2F&max-keys=500" + (prefix ? "&prefix=" + encodeURIComponent(prefix) : "") + (token ? "&continuation-token=" + encodeURIComponent(token) : "");
      return s3get(c, bucketUrl(b, region, q), region).then(function (r) {
        return r.text().then(function (t) {
          var d = new DOMParser().parseFromString(t, "text/xml"); if (!r.ok) throw P.awsError(d, r.status);
          LIST_CACHE[k] = { text: t, at: Date.now() };
          return { d: d, age: 0 };
        });
      });
    });
  }
  // ---- sort (item 10): by name, size or date, either way; folders stay first; the choice stays across folders ----
  state.sort = { by: "name", dir: 1 };
  function sortRows() {
    var list = $("s3-list"); if (!list) return;
    var by = state.sort.by, dir = state.sort.dir, rows = Array.prototype.slice.call(list.rows);
    rows.sort(function (a, b) {
      var fa = a.classList.contains("folder"), fb = b.classList.contains("folder");
      if (fa !== fb) return fa ? -1 : 1;
      var x = by === "size" ? +a.dataset.size - +b.dataset.size : by === "when" ? (a.dataset.when < b.dataset.when ? -1 : a.dataset.when > b.dataset.when ? 1 : 0) : 0;
      if (!x || fa) x = a.dataset.name < b.dataset.name ? -1 : a.dataset.name > b.dataset.name ? 1 : 0;
      return (fa ? 1 : dir) * x;
    });
    rows.forEach(function (r) { list.appendChild(r); });
    Array.prototype.forEach.call(document.querySelectorAll("#s3-objects th[data-sort]"), function (th) {
      th.setAttribute("aria-sort", th.dataset.sort === by ? (dir > 0 ? "ascending" : "descending") : "none");
    });
  }
  function sortHead(label, by) {
    var b = P.el("button", { type: "button", class: "linkish", text: label, title: "Sort by " + label.toLowerCase() });
    b.onclick = function () { state.sort = { by: by, dir: state.sort.by === by ? -state.sort.dir : (by === "name" ? 1 : -1) }; sortRows(); };
    return P.el("th", { "data-sort": by, "aria-sort": "none" }, [b]);
  }
  function countRows() {
    var list = $("s3-list"); if (!list) return "";
    var f = list.querySelectorAll("tr.folder").length, n = list.querySelectorAll("tr.file").length;
    return (f ? f + " folder" + (f === 1 ? "" : "s") + ", " : "") + n + " file" + (n === 1 ? "" : "s");
  }

  function listObjects(token, openKey) {
    var box = $("s3-objects"), st = $("s3-status"), b = state.bucket, region = state.bucketRegion;
    var my = token ? state.view : newView(false);
    if (!token) { box.textContent = ""; state.sizes = {}; state.key = openKey || ""; go(b, openKey || state.prefix); if (!openKey) { state.file++; $("s3-file").textContent = ""; } }
    P.say(st, "Listing " + b + "/" + state.prefix + "...");
    var fresh = state.fresh; state.fresh = false;
    fetchList(b, region, state.prefix, token, fresh).then(function (got) {
      if (my !== state.view) return;
      var d = got.d;
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
        var refresh = P.el("button", { type: "button", class: "quiet", text: "Refresh", title: "List this folder from S3 again" });
        refresh.onclick = function () { state.fresh = true; listObjects(); };
        box.appendChild(P.el("div", { class: "toolbar" }, [filter, refresh]));
        var table = P.el("table", { class: "s3-table" });
        var head = P.el("thead", {}, [P.el("tr", {}, [sortHead("Name", "name"), sortHead("Size", "size"), sortHead("Modified (UTC)", "when")])]);
        table.appendChild(head); table.appendChild(P.el("tbody", { id: "s3-list" }));
        box.appendChild(P.el("div", { class: "s3-wrap" }, [table]));
      }
      var list = $("s3-list");
      Array.prototype.forEach.call(d.getElementsByTagName("CommonPrefixes"), function (cp) {
        var pfx = cp.getElementsByTagName("Prefix")[0].textContent;
        var x = P.el("button", { type: "button", class: "linkish", text: pfx.slice(state.prefix.length) }); x.onclick = function () { state.prefix = pfx; listObjects(); };
        list.appendChild(P.el("tr", { class: "folder", "data-name": pfx }, [P.el("td", {}, [x]), P.el("td", { class: "n", text: "" }), P.el("td", { class: "n", text: "" })]));
      });
      Array.prototype.forEach.call(d.getElementsByTagName("Contents"), function (o) {
        var key = o.getElementsByTagName("Key")[0].textContent, size = +o.getElementsByTagName("Size")[0].textContent;
        state.sizes[key] = size;
        var when = (o.getElementsByTagName("LastModified")[0] || {}).textContent || "";
        if (key === state.prefix) return;
        var x = P.el("button", { type: "button", class: "linkish", text: key.slice(state.prefix.length) }); x.onclick = function () { openFile(key, size); };
        list.appendChild(P.el("tr", { class: "file", "data-name": key, "data-size": String(size), "data-when": when }, [P.el("td", {}, [x]), P.el("td", { class: "n", text: human(size) }), P.el("td", { class: "n", text: when.slice(0, 16).replace("T", " ") })]));
      });
      var nt = d.getElementsByTagName("NextContinuationToken")[0];
      if (nt) { var more = P.el("button", { type: "button", class: "quiet", text: "Load more" }); more.onclick = function () { more.remove(); listObjects(nt.textContent); }; box.appendChild(P.el("div", { class: "row" }, [more])); }
      sortRows();
      P.say(st, b + "/" + state.prefix + ": " + countRows() + (nt ? " so far, more in S3" : "") + (got.age ? " (listed " + Math.round(got.age / 1000) + " s ago; Refresh to list again)" : ""), "ok");
      if (openKey) openFile(openKey, state.sizes[openKey]);
    }).catch(function (e) { if (my === state.view) P.say(st, e.message + (/Failed to fetch/.test(e.message) ? " (S3 refused the browser: check the bucket's CORS rule and region " + region + ".)" : ""), "bad"); });
  }
  function human(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

  // ---- a file ----
  var TEXT = /\.(txt|md|csv|tsv|log|yaml|yml|xml|html|htm|css|js|mjs|ts|py|sh|toml|ini|cfg|conf|sql|svg)$/i;
  var IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  function isGzip(u8) { return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b; }
  function downloadLink(name, blob) { return P.el("a", { class: "button", href: URL.createObjectURL(blob), download: name, text: "Download" }); }

  // Show bytes as JSON (formatted), JSON Lines, text, an image, or "use Download". Never runs anything.
  function show(box, name, type, u8, st) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    var img = /^image\//.test(type) && type !== "image/svg+xml" ? type : IMAGE[ext];
    if (img) { box.appendChild(P.el("img", { src: URL.createObjectURL(new Blob([u8], { type: img })), alt: name, class: "s3-img" })); return P.say(st, name, "ok"); }
    if (u8.length > LIMITS.show) return P.say(st, name + ": too large to show here (" + human(u8.length) + "); use Download.", "ok");
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
    if (/^\s*\{/.test(text)) {
      // Firehose writes records back to back ("}{") unless a delimiter is set: read them as a list.
      var recs = concatenatedJson(text);
      if (recs) { box.appendChild(jsonView(recs)); return P.say(st, name + ": " + recs.length + " JSON records back to back (as Firehose writes them), formatted.", "ok"); }
    }
    var tab = tableOf(name, type, text);
    if (tab) { box.appendChild(tableView(tab, name, text)); return P.say(st, name + ": " + tab.what + ", " + tab.rows.length + " row" + (tab.rows.length === 1 ? "" : "s") + ".", "ok"); }
    if (/^text\/|xml|javascript|yaml/.test(type) || TEXT.test(name) || !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 4096))) {
      var coloured = window.Highlight && Highlight.highlight(name, text, document);
      box.appendChild(coloured || P.el("pre", { text: text })); return P.say(st, name, "ok");
    }
    P.say(st, name + ": not text; use Download.", "ok");
  }

  // Split text holding JSON values back to back ({..}{..} or {..}\n{..} with no delimiter rule). Returns the list,
  // or null if it is not at least two whole JSON objects and nothing else.
  function concatenatedJson(text) {
    var out = [], depth = 0, inStr = false, esc = false, start = -1;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charCodeAt(i);
      if (inStr) { if (esc) esc = false; else if (ch === 92) esc = true; else if (ch === 34) inStr = false; continue; }
      if (ch === 34) { if (depth === 0) return null; inStr = true; }
      else if (ch === 123 || ch === 91) { if (depth === 0) { if (ch !== 123) return null; start = i; } depth++; }
      else if (ch === 125 || ch === 93) {
        if (--depth < 0) return null;
        if (depth === 0) { try { out.push(JSON.parse(text.slice(start, i + 1))); } catch (e) { return null; } }
      } else if (depth === 0 && !(ch === 32 || ch === 9 || ch === 10 || ch === 13)) return null;
    }
    return depth === 0 && out.length > 1 ? out : null;
  }

  // ---- tables: CSV, TSV and CloudFront logs ----
  // CSV as RFC 4180 (quotes, doubled quotes, line breaks inside quotes).
  function parseCsv(text, sep) {
    var rows = [], row = [], cell = "", q = false, i = 0, c;
    for (; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && cell === "") q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  // What table, if any, the text is: CloudFront standard logs (#Version / #Fields headers, tab-separated), a .csv,
  // a .tsv, or text whose first lines all have the same number (two or more) of tabs, as CloudFront real-time logs do.
  function tableOf(name, type, text) {
    var lines = text.split(/\r?\n/), fields = null, body = [];
    if (/^#Version:/.test(lines[0] || "") || lines.slice(0, 5).some(function (l) { return /^#Fields:/.test(l); })) {
      lines.forEach(function (l) {
        if (/^#Fields:/.test(l)) fields = l.replace(/^#Fields:\s*/, "").trim().split(/\s+/);
        else if (l && l[0] !== "#") body.push(l.split("\t"));
      });
      return { what: "CloudFront log", head: fields, rows: body };
    }
    if (/\.csv$/i.test(name) || type === "text/csv") {
      var rows = parseCsv(text, ","); if (rows.length < 2) return null;
      return { what: "CSV", head: rows[0], rows: rows.slice(1) };
    }
    var sample = lines.filter(function (l) { return l; }).slice(0, 20);
    var tabs = sample.map(function (l) { return l.split("\t").length - 1; });
    var code = /\.(ya?ml|xml|html?|css|m?js|ts|py|sh|toml|ini|cfg|conf|sql|svg|md|go|rs|java|c|h|mk)$/i.test(name) || /^makefile$/i.test(name);
    if (/\.tsv$/i.test(name) || type === "text/tab-separated-values" || (!code && sample.length > 1 && tabs[0] >= 2 && tabs.every(function (n) { return n === tabs[0]; }))) {
      body = lines.filter(function (l) { return l; }).map(function (l) { return l.split("\t"); });
      if (/\.tsv$/i.test(name) && body.length > 1) return { what: "TSV", head: body[0], rows: body.slice(1) };
      return { what: "tab-separated", head: null, rows: body };
    }
    return null;
  }
  // A table of the rows, TABLE_PAGE at a time, cells as text only; "Show as text" swaps in the raw file.
  var TABLE_PAGE = 200;
  function tableView(tab, name, text) {
    var wrap = P.el("div", { class: "table-view" }), cols = tab.head ? tab.head.length : 0;
    tab.rows.forEach(function (r) { if (r.length > cols) cols = r.length; });
    var head = [];
    for (var c = 0; c < cols; c++) head.push(P.el("th", { text: tab.head && tab.head[c] != null ? tab.head[c] : String(c + 1) }));
    var tbody = P.el("tbody", {}), shown = 0;
    var table = P.el("table", { class: "s3-table data-table" }, [P.el("thead", {}, [P.el("tr", {}, head)]), tbody]);
    var more = P.el("button", { type: "button", class: "quiet" }), raw = null;
    function page() {
      var to = Math.min(tab.rows.length, shown + TABLE_PAGE);
      for (var i = shown; i < to; i++) {
        var tds = []; for (var j = 0; j < cols; j++) tds.push(P.el("td", { text: tab.rows[i][j] != null ? tab.rows[i][j] : "" }));
        tbody.appendChild(P.el("tr", {}, tds));
      }
      shown = to;
      more.hidden = shown >= tab.rows.length;
      more.textContent = "Show " + Math.min(TABLE_PAGE, tab.rows.length - shown) + " more of " + (tab.rows.length - shown);
    }
    more.onclick = page;
    var asText = P.el("button", { type: "button", class: "quiet", text: "Show as text" });
    asText.onclick = function () {
      var t = !raw || raw.hidden;
      if (!raw) { raw = P.el("pre", { text: text }); wrap.appendChild(raw); }
      raw.hidden = !t; grid.hidden = t; more.hidden = t || shown >= tab.rows.length;
      asText.textContent = t ? "Show as a table" : "Show as text";
    };
    var grid = P.el("div", { class: "s3-wrap" }, [table]);
    wrap.appendChild(P.el("p", { class: "row" }, [asText, P.el("span", { class: "small", text: tab.rows.length + " rows, " + cols + " columns" + (tab.head ? "" : " (no header row: numbered)") })]));
    wrap.appendChild(grid); wrap.appendChild(P.el("div", { class: "row" }, [more]));
    page();
    return wrap;
  }

  function openFile(key, size) {
    var box = $("s3-file"), st = $("s3-status"), my = ++state.file; box.textContent = "";
    var name = key.split("/").pop();
    function current() { return my === state.file; }
    state.key = key; go(state.bucket, key);
    box.appendChild(P.el("h4", { text: key }));
    // The size comes from the folder's listing. Without it (a link to a key not on the listing's first page) nothing
    // is fetched: a file of unknown size could be any size, and a zip must be read by ranges, not whole (R-016).
    if (!(size >= 0)) return P.say(st, name + ": its size is not known yet, so it was not opened. Choose it in its folder's list.", "bad");
    if (window.Zip && Zip.isZip(key) && size > 22) return openZip(key, size, name, box, st, current);
    if (size > LIMITS.show) return openPreview(key, size, name, box, st, current);
    P.say(st, "Opening " + key + (size >= 0 ? " (" + human(size) + ")" : "") + "...");
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
          // Unzipping stops past limits.show: a small .gz can expand to gigabytes (R-016).
          return gunzipMembers(u8, LIMITS.show + 1).then(function (g) {
            if (!current()) return;
            var out = g.damaged ? wholeLines(g.out) : g.out;
            if (g.members > 1) box.appendChild(P.el("p", { class: "small", text: "gzip: " + g.members + " members back to back (as appended logs are), all read." }));
            if (g.damaged) box.appendChild(P.el("p", { class: "small", text: "gzip: the file is damaged or cut after " + human(out.length) + " unzipped; what came out before that is shown." }));
            if (out.length > LIMITS.show) {
              var part = wholeLines(out.subarray(0, LIMITS.show));
              box.appendChild(P.el("p", { class: "small preview", text: "gzip: " + human(u8.length) + " unzips to more than " + human(LIMITS.show) + "; unzipping stopped there and the first " + human(part.length) + " is shown. Download has the whole file." }));
              return show(box, inner, "", part, st);
            }
            box.appendChild(P.el("p", { class: "small", text: "gzip: " + human(u8.length) + " unzipped to " + human(out.length) + " in this browser." }));
            show(box, inner, "", out, st);
          });
        }
        show(box, name, type, u8, st);
      });
    }).catch(function (e) { if (current()) P.say(st, e.message, "bad"); });
  }

  // ---- a large file: the first part by one Range request, never the whole file unless asked ----
  // Read at most n bytes of a response, then stop it (a server that ignores Range must not send us 2 GB).
  function firstBytes(r, n) {
    var reader = r.body.getReader(), parts = [], got = 0;
    function next() {
      return reader.read().then(function (x) {
        if (x.done) return;
        parts.push(x.value); got += x.value.length;
        if (got >= n) return reader.cancel().catch(function () {});
        return next();
      });
    }
    return next().then(function () { return join(parts).subarray(0, n); });
  }
  function join(parts) {
    var len = parts.reduce(function (a, p) { return a + p.length; }, 0), out = new Uint8Array(len), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  // Unzip the start of a gzip stream: keep what comes out until the input runs short (it was cut on purpose) or
  // `max` bytes are out. Several gzip members back to back are read in turn, as DecompressionStream does.
  function gunzipStart(u8, max) {
    var reader = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(), parts = [], got = 0;
    function next() {
      return reader.read().then(function (x) {
        if (x.done) return;
        parts.push(x.value); got += x.value.length;
        if (got >= max) return reader.cancel().catch(function () {});
        return next();
      }, function () { /* the cut end of the input: keep what came out before it */ });
    }
    return next().then(function () { return join(parts).subarray(0, max); });
  }
  // Unzip one gzip member strictly: rejects on any error (cut, damaged, or data after the member's end); stops and
  // resolves early once more than `max` bytes are out.
  function gunzipStrict(u8, max) {
    var reader = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(), parts = [], got = 0;
    function next() {
      return reader.read().then(function (x) {
        if (x.done) return { out: join(parts), capped: false };
        parts.push(x.value); got += x.value.length;
        if (got > max) return reader.cancel().catch(function () {}).then(function () { return { out: join(parts).subarray(0, max), capped: true }; });
        return next();
      });
    }
    return next();
  }
  // Unzip a gzip file of one or more members back to back. A browser's DecompressionStream stops with an error at
  // the second member, so the members are found here: a member starts with 1f 8b 08 and ends with its length mod
  // 2^32 (ISIZE); each candidate end is tried in order and kept only when the member unzips cleanly and its length
  // matches. Whatever cannot be read as whole members (a cut preview, a damaged file) is unzipped leniently, keeping
  // what comes out. Output stops at `max` bytes. Returns { out, members, capped, damaged }.
  function gunzipMembers(u8, max) {
    var ends = [];
    for (var i = 1; i + 2 < u8.length; i++) if (u8[i] === 0x1f && u8[i + 1] === 0x8b && u8[i + 2] === 8) ends.push(i);
    ends.push(u8.length);
    var parts = [], got = 0, start = 0, members = 0, k = 0;
    function result(capped, damaged) { return { out: join(parts).subarray(0, max), members: members, capped: capped, damaged: damaged }; }
    function isize(seg) { var n = seg.length; return n < 8 ? -1 : (seg[n - 4] | seg[n - 3] << 8 | seg[n - 2] << 16 | seg[n - 1] << 24) >>> 0; }
    function member() {
      if (start >= u8.length) return Promise.resolve(result(false, false));
      while (k < ends.length && ends[k] <= start) k++;
      if (k >= ends.length) return rest();
      var end = ends[k], seg = u8.subarray(start, end);
      return gunzipStrict(seg, max - got).then(function (r) {
        if (!r.capped && isize(seg) !== r.out.length % 4294967296) { k++; return member(); }
        parts.push(r.out); got += r.out.length; members++; start = end; k++;
        return r.capped ? result(true, false) : member();
      }, function () { k++; return member(); });
    }
    // No whole member from here on: keep what a lenient unzip gives, and say the rest was damaged or cut.
    function rest() {
      return gunzipStart(u8.subarray(start), max - got).then(function (out) {
        parts.push(out); got += out.length; if (out.length) members++;
        return result(got >= max, true);
      });
    }
    return member();
  }
  // A preview ends at the last whole line, so JSON Lines and logs parse and no character is cut in half.
  function wholeLines(u8) {
    for (var i = u8.length - 1; i >= 0; i--) if (u8[i] === 10) return u8.subarray(0, i + 1);
    return u8;
  }
  function downloadWhole(url, region, name, size, st) {
    var dl = P.el("button", { type: "button", text: "Download (" + human(size) + ")" });
    dl.onclick = function () {
      dl.disabled = true; P.say(st, "Downloading " + name + " (" + human(size) + ")...");
      read().then(function (c) { return s3get(c, url, region); }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw P.awsError(new DOMParser().parseFromString(t, "text/xml"), r.status); });
        return r.blob();
      }).then(function (b) {
        var a = downloadLink(name, b); document.body.appendChild(a); a.click(); a.remove(); dl.disabled = false; P.say(st, name + " downloaded.", "ok");
      }).catch(function (e) { dl.disabled = false; P.say(st, e.message, "bad"); });
    };
    return dl;
  }
  function openPreview(key, size, name, box, st, current) {
    var url = bucketUrl(state.bucket, state.bucketRegion, "", key), region = state.bucketRegion;
    var ext = (name.split(".").pop() || "").toLowerCase(), n = Math.min(size, LIMITS.preview);
    box.appendChild(P.el("p", { class: "row" }, [downloadWhole(url, region, name, size, st), P.el("span", { class: "small", text: human(size) })]));
    if (IMAGE[ext]) return P.say(st, name + ": too large to show here (" + human(size) + "); use Download.", "ok");
    P.say(st, "Reading the first " + human(n) + " of " + name + " (" + human(size) + ")...");
    read().then(function (c) { return s3get(c, url, region, { Range: "bytes=0-" + (n - 1) }); }).then(function (r) {
      if (!current()) return;
      if (r.status !== 206 && r.status !== 200) return r.text().then(function (t) { throw P.awsError(new DOMParser().parseFromString(t, "text/xml"), r.status); });
      var type = (r.headers.get("content-type") || "").split(";")[0];
      return firstBytes(r, n).then(function (u8) {
        if (!current()) return;
        if (isGzip(u8)) {
          return gunzipMembers(u8, LIMITS.show).then(function (g) {
            if (!current()) return;
            var lines = wholeLines(g.out);
            box.appendChild(P.el("p", { class: "small preview", text: "Preview: the first " + human(u8.length) + " of " + human(size) + " (gzip), unzipped in this browser to " + human(lines.length) + ". Download fetches the whole file." }));
            show(box, name.replace(/\.gz$/i, ""), "", lines, st);
          });
        }
        var lines = wholeLines(u8);
        box.appendChild(P.el("p", { class: "small preview", text: "Preview: the first " + human(lines.length) + " of " + human(size) + ". Download fetches the whole file." }));
        show(box, name, type, lines, st);
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
      box.appendChild(P.el("p", { class: "small", text: files.length + " files inside; " + (got >= size ? "a small zip, so it was read whole (" + human(size) + ")." : "listed by reading " + human(got) + " of " + human(size) + ".") }));
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
  // Large values stay quick: a list or object shows its first JSON_PAGE entries and a button for the next page, and
  // one nested two levels down with more than JSON_FOLD entries starts folded and is built only when opened. Each
  // opening bracket is a button that folds and unfolds its value (keyboard: Tab to it, Enter); unfolded, the text is
  // exactly the JSON (no markers added), so a copy of it is valid JSON.
  var JSON_PAGE = 200, JSON_FOLD = 50;
  function jsonView(value) {
    var pre = P.el("pre", { class: "json" });
    function span(to, cls, text) { var s = document.createElement("span"); s.className = cls; s.textContent = text; to.appendChild(s); }
    function text(to, t) { to.appendChild(document.createTextNode(t)); }
    function walk(to, v, ind) {
      var arr = Array.isArray(v);
      if (!arr && !(v && typeof v === "object")) {
        if (typeof v === "string") return span(to, "j-str", JSON.stringify(v));
        return span(to, typeof v === "number" ? "j-num" : "j-lit", String(v));
      }
      var ks = arr ? null : Object.keys(v), n = arr ? v.length : ks.length;
      if (!n) return text(to, arr ? "[]" : "{}");
      var pad = "  ".repeat(ind + 1), end = "  ".repeat(ind), built = 0;
      var what = n + (arr ? (n === 1 ? " item" : " items") : (n === 1 ? " key" : " keys"));
      var fold = P.el("button", { type: "button", class: "j-fold", "aria-expanded": "true", title: "Fold " + what,
        style: "font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer" });
      fold.textContent = arr ? "[" : "{";
      var body = document.createElement("span"), shut = P.el("span", { class: "j-shut" });
      function page() {
        var to2 = Math.min(n, built + JSON_PAGE);
        if (!built) text(body, "\n");
        for (var i = built; i < to2; i++) {
          text(body, pad);
          if (!arr) { span(body, "j-key", JSON.stringify(ks[i])); text(body, ": "); }
          walk(body, arr ? v[i] : v[ks[i]], ind + 1);
          text(body, i < n - 1 ? ",\n" : "\n");
        }
        built = to2;
        if (built < n) {
          var lead = document.createTextNode(pad), tail = document.createTextNode("\n");
          var more = P.el("button", { type: "button", class: "quiet j-more", text: "Show " + Math.min(JSON_PAGE, n - built) + " more of " + (n - built) });
          more.onclick = function () { lead.remove(); more.remove(); tail.remove(); page(); };
          body.appendChild(lead); body.appendChild(more); body.appendChild(tail);
        } else text(body, end);
      }
      function setOpen(open) {
        if (open && !built) page();
        // Folded, the value reads "{ 12 keys }"; open, the hint is empty, so the text on the page is the JSON itself.
        body.hidden = !open; shut.textContent = open ? "" : " " + what + " ";
        fold.setAttribute("aria-expanded", open ? "true" : "false");
        fold.title = (open ? "Fold " : "Unfold ") + what;
      }
      fold.onclick = function () { setOpen(fold.getAttribute("aria-expanded") !== "true"); };
      to.appendChild(fold); to.appendChild(body); to.appendChild(shut); text(to, arr ? "]" : "}");
      setOpen(!(ind >= 2 && n > JSON_FOLD));
    }
    walk(pre, value, 0);
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
    // In the twin, open with the buckets listed: there is one synthetic account and nothing to choose.
    if (pending && P.signedIn() && accts.length) { var r = pending; pending = null; return apply(r); }
    if (window.AwsTransport && AwsTransport.isTwin() && P.signedIn() && accts.length && !state.acct && lb && lb.onclick) lb.onclick();
  }
  function init() {
    $("s3-list-buckets").onclick = function () {
      state.acct = P.accounts().filter(function (a) { return a.id === $("s3-account").value; })[0];
      state.region = "us-east-1";
      if (state.acct) listBuckets();
    };
    pending = parse(location.hash);
    render();
  }
  // Open a bucket at a folder (the twin's "See it in" links): through the address, so Back and reload work too.
  function openAt(bucket, prefix) { var h = route(bucket, prefix || ""); if (location.hash !== h) location.hash = h; else apply(parse(h)); }
  // view: show bytes as the browser would (for tests and for other views over the same reader).
  function view(name, type, u8) { var box = P.el("div", {}), st = P.el("p", { class: "status" }); show(box, name, type || "", u8, st); return { box: box, status: st }; }
  window.S3Browser = { render: render, jsonView: jsonView, openAt: openAt, view: view, limits: LIMITS };
  init();
})();
