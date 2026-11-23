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
  // autoPages: how many listing pages (500 keys each) load by themselves while scrolling before "Load more" waits.
  var LIMITS = { show: 5 * 1024 * 1024, preview: 256 * 1024, autoPages: 20 };
  var state = { acct: null, region: "us-east-1", bucket: null, prefix: "", view: 0, file: 0, sizes: noProto(), key: "" };
  // Quick clicks: each new view (buckets, a bucket, a folder) and each file opened takes a number; an answer that
  // comes back after a newer click is dropped, so a slow, older answer never lands under the newer one.
  function newView(alsoFile) { if (alsoFile) state.file++; return ++state.view; }
  // Sizes by key: a key such as "constructor" must not find Object.prototype's (R-016).
  function noProto() { return Object.create(null); }

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
  // Arriving by an address (a link, the twin's "See it in", Back, reload) can leave the place below the fold, so the
  // first listing after an arrival scrolls to it and moves the focus there (sherpa walk 3, finding 2). Clicks inside
  // the browser do not set this: their address is the page's own, so apply() is not called for them.
  var arrive = false;
  function land(el) {
    if (!el) return;
    if (!/^(BUTTON|A|INPUT)$/.test(el.tagName) && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.scrollIntoView({ block: "start" }); el.focus({ preventScroll: true });
  }
  function route(bucket, path) { return "#/s3/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/"); }
  // The same place written another way (#/s3/<bucket> without the slash): tidy it in place, adding no Back step.
  function go(bucket, path) {
    var h = route(bucket, path); if (location.hash === h) return;
    var r = parse(location.hash);
    if (r && !r.bad && r.bucket === bucket && r.prefix + r.key === path) history.replaceState(history.state, "", h); else location.hash = h;
  }
  // The address already says where the page is (it was written by the page itself, or nothing moved).
  function here(r) { return !!r && !r.bad && r.bucket === state.bucket && r.prefix === state.prefix && r.key === state.key; }
  function parse(hash) {
    // #/s3/<bucket> with or without the slash; #/s3 or #/s3/ alone names no bucket (the list of buckets).
    var m = /^#\/s3\/([^/]+)(?:\/(.*))?$/.exec(hash || ""), path; if (!m) return null;
    try { path = (m[2] || "").split("/").map(decodeURIComponent).join("/"); } catch (e) { return { bad: true }; }
    if (!BUCKET.test(m[1]) || path.length > 1024 || /(^|\/)\.\.?(\/|$)/.test(path)) return { bad: true };
    var cut = path.lastIndexOf("/") + 1;
    return { bucket: m[1], prefix: path.slice(0, cut), key: cut < path.length ? path : "" };
  }
  function pickAccount() {
    if (!state.acct) state.acct = P.accounts().filter(function (a) { return a.id === $("s3-account").value; })[0] || P.accounts()[0] || null;
    return state.acct;
  }
  // The bucket chips are one Tab stop (roving tabindex, as the tabs are): the pressed chip, or the first; the arrow
  // keys move between chips (sherpa walk 5: one Tab per bucket before, hundreds on a real account).
  function press(name) {
    var all = $("s3-buckets").querySelectorAll("button"), on = null;
    Array.prototype.forEach.call(all, function (x) { var p = x.textContent === name; x.setAttribute("aria-pressed", p ? "true" : "false"); if (p) on = x; });
    Array.prototype.forEach.call(all, function (x, i) { x.tabIndex = x === on || (!on && i === 0) ? 0 : -1; });
  }
  function apply(r) {
    if (!r) return;
    var st = $("s3-status");
    if (r.bad) return P.say(st, "This address does not name an S3 bucket and file; nothing was opened.", "bad");
    if (!P.signedIn() || !pickAccount()) { pending = r; return; }
    arrive = true;
    var tab = $("tab-s3"); if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
    if (r.bucket === state.bucket && state.bucketRegion && $("s3-list")) {
      // Same bucket, already answering: only the folder or the file changes.
      if (r.prefix !== state.prefix) { state.prefix = r.prefix; return listObjects(null, r.key); }
      arrive = false;
      if (r.key) return linked(r.key, $("s3-objects"));
      state.file++; state.key = ""; $("s3-file").textContent = ""; return land($("s3-objects").querySelector(".crumbs button:last-of-type"));
    }
    listBuckets(function (names) {
      if (names.indexOf(r.bucket) < 0) return P.say(st, r.bucket + " is not one of this account's buckets; nothing was opened.", "bad");
      press(r.bucket); openBucket(r.bucket, r);
    });
  }
  // Back past the first bucket opened leaves an address with no bucket: show the list of buckets again.
  function closeBucket() {
    newView(true); state.bucket = null; state.prefix = ""; state.key = ""; state.bucketRegion = null;
    $("s3-objects").textContent = ""; $("s3-file").textContent = ""; press(""); P.say($("s3-status"), "");
  }
  window.addEventListener("hashchange", function () {
    var r = parse(location.hash);
    if (!r && state.bucket && /^(#?|#\/s3\/?)$/.test(location.hash)) return closeBucket();
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
        b.onclick = function () { press(n); openBucket(n, null, true); };
        out.appendChild(P.el("li", {}, [b]));
      });
      press(state.bucket || "");
      P.say(st, names.length + " bucket" + (names.length === 1 ? "" : "s") + ".", "ok");
      if (then) then(names);
    }).catch(function (e) {
      if (my !== state.view) return;
      if (/AccessDenied|not authorized/.test(e.message)) return P.say(st, e.message + " (The account needs template v2: see step 3.)", "bad");
      fail(st, e, function () { listBuckets(then); });
    });
  }

  // ---- a bucket: check its CORS rule, offer the plan, then list ----
  // at: { prefix, key } when opened from an address; otherwise the bucket's top.
  // focus: opened from its chip, so the focus moves on to the folder's crumbs once listed.
  function openBucket(name, at, focus) {
    state.bucket = name; state.prefix = ""; state.key = ""; state.bucketRegion = null;
    if (!at) { arrive = !!focus; go(name, ""); }
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
    }).catch(function (e) { if (my === state.view) fail(st, e, function () { openBucket(name, at, focus); }); });
  }
  function showCorsPlan(name, plan) {
    var box = $("s3-objects"), st = P.el("p", { class: "status" });
    P.say($("s3-status"), "");
    var arrived = arrive; arrive = false;
    // Reached from a link (security.aws.a's note to R-016): say so, as the link's sender chose this bucket, not you.
    if (arrived) box.appendChild(P.el("p", { class: "small", text: "You came here from a link. Check that this is the bucket you meant; nothing changes unless you approve." }));
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
    if (arrived) land(box.firstChild);
  }

  // openKey: a file to open once its folder is listed (from an address).
  // ---- listing cache (item 11): going back up a folder, or between folders, answers from memory for a minute ----
  // Keyed by account, bucket, folder and page token; only successful answers are kept; Refresh asks S3 again.
  var LIST_CACHE = Object.create(null), LIST_CACHE_MS = 60000;
  function clearListCache() { LIST_CACHE = Object.create(null); }
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
    // A search (names starting with what was typed, asked of S3) holds only for the listing it was asked for.
    if (!token) { if (!state.keepSearch) state.search = ""; state.keepSearch = false; state.pages = 0; }
    var listPrefix = state.prefix + (state.search || "");
    var arriving = !token && arrive; if (!token) arrive = false;
    if (!token) { box.textContent = ""; state.sizes = noProto(); state.key = openKey || ""; go(b, openKey || state.prefix); if (!openKey) { state.file++; $("s3-file").textContent = ""; } }
    P.say(st, "Listing " + b + "/" + listPrefix + (state.search ? "* (names starting with " + state.search + ")" : "") + "...");
    // Refresh asks S3 again for every page of this listing, not only the first.
    if (!token) { state.listFresh = state.fresh; state.fresh = false; }
    var fresh = state.listFresh;
    fetchList(b, region, listPrefix, token, fresh).then(function (got) {
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
        // The filter hides rows already listed. When S3 holds more than is listed, a button (or Enter) asks S3 for
        // the names in this folder that start with what was typed, so a log folder of thousands is searchable.
        var search = P.el("button", { type: "button", class: "quiet s3-search", hidden: "" }), clear = null;
        function canSearch() { return filter.value && filter.value.indexOf("/") < 0 && (state.more || state.search) && filter.value !== state.search; }
        function showSearch() { search.hidden = !canSearch(); search.textContent = "Find names starting with \u201c" + filter.value + "\u201d in S3"; }
        filter.oninput = function () {
          var q = filter.value.toLowerCase();
          Array.prototype.forEach.call($("s3-list").rows, function (tr) { tr.hidden = q && tr.textContent.toLowerCase().indexOf(q) < 0; });
          showSearch();
        };
        search.onclick = function () { if (!canSearch()) return; state.search = filter.value; state.keepSearch = true; listObjects(); };
        filter.onkeydown = function (ev) { if (ev.key === "Enter" && canSearch()) { ev.preventDefault(); search.onclick(); } };
        if (state.search) {
          filter.value = state.search;
          clear = P.el("button", { type: "button", class: "quiet", text: "Clear the search" });
          clear.onclick = function () { state.search = ""; listObjects(); };
        }
        var refresh = P.el("button", { type: "button", class: "quiet", text: "Refresh", title: "List this folder from S3 again" });
        refresh.onclick = function () { clearListCache(); state.fresh = true; state.keepSearch = true; listObjects(); };
        var sum = summariseButton(b, region, state.prefix);
        box.appendChild(P.el("div", { class: "toolbar" }, [filter, search].concat(clear ? [clear] : []).concat([refresh]).concat(sum ? [sum] : [])));
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
      // Item 9: the next page loads by itself when the end of the list scrolls into view (up to limits.autoPages pages,
      // 500 keys each); "Load more" stays for the keyboard and after that. One load per page, whichever comes first.
      state.more = !!nt;
      if (nt) {
        var tok = nt.textContent, more = P.el("button", { type: "button", class: "quiet", text: "Load more" }), moreRow = P.el("div", { class: "row" }, [more]), io = null, loading = false;
        var loadMore = function () { if (loading || my !== state.view) return; loading = true; if (io) io.disconnect(); moreRow.remove(); state.pages++; listObjects(tok); };
        more.onclick = loadMore;
        box.appendChild(moreRow);
        if (window.IntersectionObserver && state.pages < LIMITS.autoPages) {
          io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) loadMore(); }, { rootMargin: "200px" });
          io.observe(moreRow);
        }
      }
      var sb = box.querySelector(".s3-search"); if (sb && sb.parentNode) { var fi = box.querySelector("input.filter"); if (fi && fi.oninput) fi.oninput(); }
      sortRows();
      P.say(st, b + "/" + state.prefix + (state.search ? " (names starting with " + state.search + ")" : "") + ": " + countRows() + (nt ? " so far, more in S3" : "") + (got.age ? " (listed " + Math.round(got.age / 1000) + " s ago; Refresh to list again)" : ""), "ok");
      if (openKey) linked(openKey, box, arriving);
      else if (arriving) land(box.querySelector(".crumbs button:last-of-type"));
    }).catch(function (e) { if (my === state.view) fail(st, e, function () { listObjects(token, openKey); }, region); });
  }
  // A file named by a link opens with no click only when the listing gave its size and it is small enough to show
  // (or a zip, read by byte ranges). Otherwise the folder is shown and the file waits for a click, so a link alone
  // cannot make the page download a large object (R-016, security.aws.a).
  function linked(key, box, arriving) {
    var size = state.sizes[key], name = key.split("/").pop(), zip = window.Zip && Zip.isZip(key) && size > 22;
    var why = !(size >= 0) ? name + " is not in the part of this folder listed so far; find it in the list (Load more) and click it to open it."
      : !zip && size > LIMITS.show ? name + " is " + human(size) + ", more than a link opens by itself; click it in the list to open it." : "";
    if (!why) { openFile(key, size); if (arriving !== false) land($("s3-file").firstChild); return; }
    state.file++; $("s3-file").textContent = "";
    P.say($("s3-status"), why, "ok");
    if (arriving !== false) land(box.querySelector(".crumbs button:last-of-type"));
  }
  // ---- "Summarise these logs" (data.aws.a's LogView, docs/data/2026-11-23__01-extract-workflow-first-design.md) ----
  // Offered on a folder of hourly logs (a year, month, day or hour folder: .../2026/11/21/10/) when the page has
  // loaded site/data/extract.js and view.js. Every file under the folder is listed (no delimiter), then LogView
  // reads them one at a time through the read role, in this browser only: nothing is kept or sent. Ceilings: at
  // most SUM_MAX files (LogView refuses more and asks for a smaller folder), no file over SUM_FILE is fetched, and
  // the listing stops once past SUM_MAX keys.
  // SUM_TOTAL: bytes one click may fetch in all (security.aws.a: 200 files of 32 MB would be 6.4 GB); the total is
  // shown before anything is read, and a folder over it is refused with a request for a smaller one.
  var LOG_FOLDER = /(^|\/)\d{4}\/(\d{2}\/){0,3}$/, SUM_MAX = 200, SUM_FILE = 32 * 1048576, SUM_TOTAL = 500 * 1048576;
  function summariseButton(b, region, prefix) {
    if (!window.LogView || !window.LogExtract || !LOG_FOLDER.test(prefix)) return null;
    var btn = P.el("button", { type: "button", class: "quiet", text: "Summarise these logs", title: "Read every log file under " + prefix + " in this browser" });
    btn.onclick = function () { summarise(b, region, prefix, btn); };
    return btn;
  }
  function summarise(b, region, prefix, btn) {
    var my = ++state.file, box = $("s3-file"), st = $("s3-status"), objs = [], sizes = noProto();
    // The account is taken once, at the click: every read is signed with its read role, and the summary stops if
    // another account is chosen meanwhile (security.aws.a: the other account's role against this account's bucket).
    var acct = state.acct;
    function readAs() { return P.assume(acct, "sws-aws-platform-read"); }
    function sameAcct() { return !!state.acct && !!acct && state.acct.id === acct.id; }
    function same() { return my === state.file && sameAcct(); }
    box.textContent = ""; state.key = ""; go(b, prefix);
    var head = P.el("h4", { text: "Summary of " + b + "/" + prefix }), out = P.el("div", {});
    box.appendChild(head); box.appendChild(out); land(head);
    btn.disabled = true; P.say(st, "Listing every log file under " + prefix + "...");
    readAs().then(function (c) {
      function page(token) {
        var q = "?list-type=2&max-keys=1000&prefix=" + encodeURIComponent(prefix) + (token ? "&continuation-token=" + encodeURIComponent(token) : "");
        return s3get(c, bucketUrl(b, region, q), region).then(function (r) {
          return r.text().then(function (t) {
            var d = new DOMParser().parseFromString(t, "text/xml"); if (!r.ok) throw P.awsError(d, r.status);
            Array.prototype.forEach.call(d.getElementsByTagName("Contents"), function (o) {
              var k = o.getElementsByTagName("Key")[0].textContent, z = +o.getElementsByTagName("Size")[0].textContent;
              if (k === prefix) return;
              objs.push({ Key: k, Size: z }); sizes[k] = z;
            });
            var nt = d.getElementsByTagName("NextContinuationToken")[0];
            if (nt && objs.length <= SUM_MAX && same()) return page(nt.textContent);
          });
        });
      }
      return page(null);
    }).then(function () {
      if (!same()) return;
      var total = objs.reduce(function (a, o) { return a + (o.Size <= SUM_FILE ? o.Size : 0); }, 0), fetched = 0;
      var many = objs.length + " file" + (objs.length === 1 ? "" : "s");
      if (total > SUM_TOTAL) return P.say(st, prefix + ": " + many + ", " + human(total) + " in all, more than " + human(SUM_TOTAL) + " for one summary; open a smaller folder (a day or an hour).", "bad");
      P.say(st, "Summarising " + many + " under " + prefix + " (" + human(total) + " to read)...");
      // A value in the summary that names a log file opens it through the address, so it gets every check a link
      // gets (a valid bucket of this account, no climbing out, the size gate); the values come from the logs.
      var opts = { maxFiles: SUM_MAX, maxFileBytes: SUM_FILE, context: { logsBucket: b },
        open: function (ref) { if (ref && ref.bucket && ref.key) location.hash = route(String(ref.bucket), String(ref.key)); } };
      return LogView.run(out, objs, function (key) {
        if (my !== state.file) return Promise.reject(new Error("stopped: another place was opened"));
        if (!sameAcct()) return Promise.reject(new Error("stopped: another account was chosen"));
        if (!(sizes[key] <= SUM_FILE)) return Promise.reject(new Error("larger than " + human(SUM_FILE) + "; not read"));
        if (fetched + sizes[key] > SUM_TOTAL) return Promise.reject(new Error("past " + human(SUM_TOTAL) + " read in all; not read"));
        fetched += sizes[key];
        return readAs().then(function (c) { return s3get(c, bucketUrl(b, region, "", key), region); }).then(function (r) {
          if (!r.ok) throw new Error("S3 answered " + r.status);
          return r.arrayBuffer();
        }).then(function (ab) { return new Uint8Array(ab); });
      }, opts).then(function () {
        if (my === state.file) P.say(st, "Summary of " + b + "/" + prefix + ": read in this browser; nothing was kept or sent.", "ok");
      });
    }).catch(function (e) { if (my === state.file) P.say(st, e.message, "bad"); }).then(function () { btn.disabled = false; });
  }
  // ---- errors told apart, with a Retry (first note, item 15) ----
  // AWS's code stays at the end, so nothing is hidden; the words in front say what it means here and what to do.
  function explain(msg, region) {
    var m = String(msg || ""), why =
      /^AccessDenied|not authorized/i.test(m) ? "S3 refused the read role here: it may not read this bucket, folder or file. Nothing was changed." :
      /^NoSuchKey/.test(m) ? "This file is no longer in the bucket (moved or deleted since the folder was listed). Refresh the folder." :
      /^NoSuchBucket/.test(m) ? "This bucket no longer exists." :
      /ExpiredToken|InvalidToken|TokenRefreshRequired|RequestExpired|Sign in with Google/.test(m) ? "The session ran out. Sign in again, then Retry." :
      /PermanentRedirect|AuthorizationHeaderMalformed|^HTTP 301/.test(m) ? "The bucket answers in another region than the one asked" + (region ? " (" + region + ")" : "") + "." :
      /Failed to fetch|NetworkError|Load failed/.test(m) ? "S3 did not answer the browser: this device is offline, or the bucket's CORS rule does not allow this site" + (region ? " (region " + region + ")" : "") + "." :
      /SlowDown|ServiceUnavailable|InternalError|^HTTP 5\d\d/.test(m) ? "S3 is busy or failed for a moment. Retry." : "";
    return why ? why + " (" + m + ")" : m;
  }
  // Say what went wrong in the status line; with a retry, a button that tries the same step again.
  function fail(st, e, retry, region) {
    P.say(st, explain(e && e.message, region), "bad");
    if (!retry) return;
    // The step is retried only in the bucket it failed in, at the folder it failed at (security.aws.a: a Retry
    // clicked after moving to another bucket must not ask that bucket for the old key).
    var at = { bucket: state.bucket, prefix: state.prefix }, b = P.el("button", { type: "button", class: "quiet s3-retry", text: "Retry" });
    b.onclick = function () {
      b.disabled = true;
      if (state.bucket !== at.bucket) return P.say(st, "That Retry was for " + (at.bucket || "the list of buckets") + "; open it again to retry there.", "ok");
      state.prefix = at.prefix; retry();
    };
    st.appendChild(document.createTextNode(" ")); st.appendChild(b);
  }
  // ---- S3-4: "Connected to this bucket" (docs/s3/2026-11-23__s3-4-bucket-graph-plan.md) ----
  // Words: ontology.aws.a's READ table (docs/ontology/explain.mjs), each relation read from either end, so this panel,
  // the Map and explain.mjs say the same thing. Links come from dev.2.aws.a's Graph.neighbours(json, id): one hop,
  // and a second hop through the bucket's files (via). Order and marks by trust: AWS-confirmed first with no mark,
  // then "?" claimed (from files or names: check before acting), then "~" the ontologist's word. More than three
  // links of one kind read as one line with a count, the first and the last.
  var READ = {
    in: ["is in", "contains"], holds: ["holds", "is held by"], made_by: ["was made by", "made"],
    writes_to: ["writes to", "receives from"], logs_to: ["sends its logs to", "receives logs from"],
    serves_from: ["serves from", "is the origin of"], packages: ["is the code of", "runs code from"],
    trusts: ["trusts", "is trusted by"], allows_subject: ["may be assumed by", "may assume"],
    has_policy: ["has", "is attached to"], acted_as: ["was done as", "did"], acted_on: ["acted on", "was acted on by"],
    records: ["records", "is recorded in"], refers_to: ["names", "is named in"], part_of: ["is part of", "is made of"],
    signed_in_via: ["signed in via", "was used to sign in for"], seen_in: ["is seen in", "shows"],
    targeted: ["targeted", "was targeted by"], runs_as: ["runs as", "is the role of"],
    transforms_with: ["transforms records with", "transforms records for"]
  };
  var HOW = { api: "AWS answered", template: "the stack's template says", content: "read from inside a file",
    naming: "guessed from a name", comment: "only a code comment says", curated: "the ontologist says" };
  var MARK_SAYS = { "?": "claimed, check before acting", "~": "the ontologist's word" };
  function nodeName(n) { var l = String(n && n.label != null ? n.label : n && n.id); return n && n.type === "object" ? l.split("/").pop() : l; }
  // Graph.neighbours result -> lines: { mark, words, via, otype, nodes: [..], how }. Pure.
  function connections(nb) {
    if (!nb || !nb.links) return [];
    var lines = nb.links.map(function (l) {
      var r = READ[l.rel], rank = l.trust === "verified" ? 0 : l.trust === "curated" ? 2 : 1, type = String(l.node.type || "unknown");
      var words = r ? r[l.direction === "out" ? 0 : 1] : String(l.rel).replace(/_/g, " ");
      return { rank: rank, mark: rank === 0 ? "" : rank === 2 ? "~" : "?", words: words, via: !!l.via, otype: type.replace(/_/g, " "), node: l.node,
        how: (HOW[l.evidence] || String(l.evidence)) + ": " + String(l.source || ""), g: [l.via ? 1 : 0, rank, words, type, l.evidence, l.source].join("|") };
    });
    lines.sort(function (a, b) {
      var x = [a.via ? 1 : 0, a.rank, a.words, nodeName(a.node)].join("\u0000"), y = [b.via ? 1 : 0, b.rank, b.words, nodeName(b.node)].join("\u0000");
      return x < y ? -1 : x > y ? 1 : 0;
    });
    var out = [], run = [];
    function flush() {
      if (!run.length) return;
      var f = run[0];
      if (run.length <= 3) run.forEach(function (l) { out.push({ mark: l.mark, words: l.words, via: l.via, otype: l.otype, nodes: [l.node], how: l.how }); });
      else out.push({ mark: f.mark, words: f.words, via: f.via, otype: f.otype, nodes: run.map(function (l) { return l.node; }), how: f.how });
      run = [];
    }
    lines.forEach(function (l) { if (run.length && run[0].g !== l.g) flush(); run.push(l); });
    flush();
    return out;
  }
  // An S3 node opens through the address (so every link check applies); other kinds are text for now.
  function s3Target(n) {
    var m = /^arn:aws:s3:::([^/]+)(?:\/(.*))?$/.exec(String(n && n.id || ""));
    return m && (n.type === "bucket" || n.type === "object" || n.type === "prefix") ? { bucket: m[1], key: m[2] || "" } : null;
  }
  function nameEl(n) {
    var t = s3Target(n), label = nodeName(n);
    if (!t) return P.el("span", { class: "c-name", text: label });
    var b = P.el("button", { type: "button", class: "linkish c-name", text: label, title: t.bucket + "/" + t.key });
    b.onclick = function () { location.hash = route(t.bucket, t.key); };
    return b;
  }
  // The panel, built from DOM nodes as text only (labels come from bucket contents and logs).
  function connectedPanel(nb, opts) {
    opts = opts || {};
    var box = P.el("section", { class: "connected", "aria-label": "Connected to this bucket" });
    if (!nb) { box.appendChild(P.el("p", { class: "small", text: "Nothing is known about this bucket's connections yet." })); return box; }
    box.appendChild(P.el("h4", { text: "Connected to " + nodeName(nb.node) + (opts.twin ? " (synthetic)" : "") }));
    var ul = P.el("ul", { class: "c-lines" });
    connections(nb).forEach(function (l) {
      var li = P.el("li", {});
      if (l.mark) li.appendChild(P.el("span", { class: "c-mark", text: l.mark + " ", title: MARK_SAYS[l.mark], "aria-label": MARK_SAYS[l.mark] }));
      li.appendChild(document.createTextNode((l.via ? "A file here " : "") + l.words + " "));
      if (l.nodes.length > 3) {
        li.appendChild(document.createTextNode(l.nodes.length + " " + l.otype + "s: "));
        li.appendChild(nameEl(l.nodes[0])); li.appendChild(document.createTextNode(" ... ")); li.appendChild(nameEl(l.nodes[l.nodes.length - 1]));
      } else { li.appendChild(nameEl(l.nodes[0])); li.appendChild(document.createTextNode(" (" + l.otype + ")")); }
      li.appendChild(P.el("span", { class: "small c-how", text: "  [" + l.how + "]" }));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.appendChild(P.el("p", { class: "small", text: "No mark: AWS confirmed. ?: claimed, from files or names; check before acting. ~: the ontologist's word." }));
    return box;
  }
  function human(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

  // ---- a file ----
  var TEXT = /\.(txt|md|csv|tsv|log|yaml|yml|xml|html|htm|css|js|mjs|ts|py|sh|toml|ini|cfg|conf|sql|svg)$/i;
  var IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  function isGzip(u8) { return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b; }
  // R-018: a download is always application/octet-stream (never S3's Content-Type: a text/html blob opened in a tab
  // would be a document on this origin). Its blob URL is made on the click and revoked a minute later.
  function downloadLink(name, blob) {
    var bytes = new Blob([blob], { type: "application/octet-stream" });
    var a = P.el("a", { class: "button", href: "#", download: name, text: "Download" });
    a.addEventListener("click", function () {
      var url = URL.createObjectURL(bytes); a.href = url;
      setTimeout(function () { URL.revokeObjectURL(url); a.href = "#"; }, 60000);
    });
    return a;
  }

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
        if (rows.length) { box.appendChild(filteredView(rows, JSON.stringify, jsonView, "lines")); return P.say(st, name + ": JSON Lines (" + rows.length + "), formatted.", "ok"); }
      } catch (e) { /* not JSON Lines */ }
    }
    if (/^\s*\{/.test(text)) {
      // Firehose writes records back to back ("}{") unless a delimiter is set: read them as a list.
      var recs = concatenatedJson(text);
      if (recs) { box.appendChild(filteredView(recs, JSON.stringify, jsonView, "records")); return P.say(st, name + ": " + recs.length + " JSON records back to back (as Firehose writes them), formatted.", "ok"); }
    }
    var tab = tableOf(name, type, text);
    if (tab) { box.appendChild(tableView(tab, name, text)); return P.say(st, name + ": " + tab.what + ", " + tab.rows.length + " row" + (tab.rows.length === 1 ? "" : "s") + ".", "ok"); }
    if (/^text\/|xml|javascript|yaml/.test(type) || TEXT.test(name) || !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 4096))) {
      var coloured = window.Highlight && Highlight.highlight(name, text, document);
      var whole = coloured || P.el("pre", { text: text }), lines = text.split("\n");
      box.appendChild(lines.length > 2 ? filteredView(lines, String, function (sub) { return sub === lines ? whole : P.el("pre", { text: sub.join("\n") }); }, "lines") : whole);
      return P.say(st, name, "ok");
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
  var TABLE_PAGE = 200, MAX_COLS = 200;
  // ---- W3-5: a line filter in the viewer (sherpa walk 3, finding 5) ----
  // Keeps the rows (JSON Lines, records, table rows) or text lines that contain what is typed, in any case, and says
  // "N of M lines match". Plain text matching (no patterns); the file is only read, never changed.
  function filterBox(unit, total, onChange) {
    var input = P.el("input", { type: "search", class: "filter line-filter", placeholder: "Filter " + unit, "aria-label": "Filter " + unit });
    var count = P.el("span", { class: "small line-count", "aria-live": "polite" }), timer = null;
    input.oninput = function () {
      clearTimeout(timer);
      timer = setTimeout(function () { var q = input.value.toLowerCase(), n = onChange(q); count.textContent = q ? n + " of " + total + " " + unit + " match" : ""; }, 120);
    };
    return P.el("div", { class: "toolbar" }, [input, count]);
  }
  function filteredView(items, keyOf, render, unit) {
    var wrap = P.el("div", { class: "filtered" }), holder = P.el("div", {}), keys = null, first = render(items);
    holder.appendChild(first);
    wrap.appendChild(filterBox(unit, items.length, function (q) {
      holder.textContent = "";
      if (!q) { holder.appendChild(first); return items.length; }
      if (!keys) keys = items.map(function (x) { return String(keyOf(x)).toLowerCase(); });
      var sub = items.filter(function (x, i) { return keys[i].indexOf(q) >= 0; });
      holder.appendChild(sub.length ? render(sub) : P.el("p", { class: "small", text: "No " + unit + " match." }));
      return sub.length;
    }));
    wrap.appendChild(holder);
    return wrap;
  }

  function tableView(tab, name, text) {
    var wrap = P.el("div", { class: "table-view" }), cols = tab.head ? tab.head.length : 0;
    tab.rows.forEach(function (r) { if (r.length > cols) cols = r.length; });
    // R-017 (b): one row with a million separators must not become millions of cells.
    var allCols = cols; if (cols > MAX_COLS) cols = MAX_COLS;
    var head = [];
    for (var c = 0; c < cols; c++) head.push(P.el("th", { text: tab.head && tab.head[c] != null ? tab.head[c] : String(c + 1) }));
    var tbody = P.el("tbody", {}), shown = 0, rows = tab.rows, keys = null;
    var table = P.el("table", { class: "s3-table data-table" }, [P.el("thead", {}, [P.el("tr", {}, head)]), tbody]);
    var more = P.el("button", { type: "button", class: "quiet" }), raw = null;
    function page() {
      var to = Math.min(rows.length, shown + TABLE_PAGE);
      for (var i = shown; i < to; i++) {
        var tds = []; for (var j = 0; j < cols; j++) tds.push(P.el("td", { text: rows[i][j] != null ? rows[i][j] : "" }));
        tbody.appendChild(P.el("tr", {}, tds));
      }
      shown = to;
      more.hidden = shown >= rows.length;
      more.textContent = "Show " + Math.min(TABLE_PAGE, rows.length - shown) + " more of " + (rows.length - shown);
    }
    var lineFilter = filterBox("rows", tab.rows.length, function (q) {
      if (!keys) keys = tab.rows.map(function (r) { return r.join("\t").toLowerCase(); });
      rows = q ? tab.rows.filter(function (r, i) { return keys[i].indexOf(q) >= 0; }) : tab.rows;
      tbody.textContent = ""; shown = 0; page();
      return rows.length;
    });
    more.onclick = page;
    var asText = P.el("button", { type: "button", class: "quiet", text: "Show as text" });
    asText.onclick = function () {
      var t = !raw || raw.hidden;
      if (!raw) { raw = P.el("pre", { text: text }); wrap.appendChild(raw); }
      raw.hidden = !t; grid.hidden = t; lineFilter.hidden = t; more.hidden = t || shown >= rows.length;
      asText.textContent = t ? "Show as a table" : "Show as text";
    };
    var grid = P.el("div", { class: "s3-wrap" }, [table]);
    wrap.appendChild(P.el("p", { class: "row" }, [asText, P.el("span", { class: "small", text: tab.rows.length + " rows, " + (allCols > cols ? "the first " + cols + " of " + allCols + " columns (Show as text has them all)" : cols + " columns") + (tab.head ? "" : " (no header row: numbered)") })]));
    wrap.appendChild(lineFilter); wrap.appendChild(grid); wrap.appendChild(P.el("div", { class: "row" }, [more]));
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
    }).catch(function (e) { if (current()) fail(st, e, function () { openFile(key, size); }, state.bucketRegion); });
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
  // R-017 (a): a crafted file full of 1f 8b 08 would make every candidate a full unzip of the prefix. At most
  // GZ_TRIES candidates may fail and GZ_MEMBERS members be read; past either, the rest is unzipped leniently once.
  // Each try waits for the next task, so the page stays responsive while a file is read.
  var GZ_TRIES = 32, GZ_MEMBERS = 4096;
  function gunzipMembers(u8, max) {
    var ends = [];
    for (var i = 1; i + 2 < u8.length; i++) if (u8[i] === 0x1f && u8[i + 1] === 0x8b && u8[i + 2] === 8) ends.push(i);
    ends.push(u8.length);
    var parts = [], got = 0, start = 0, members = 0, k = 0, failed = 0;
    function later(f) { return new Promise(function (ok) { setTimeout(ok, 0); }).then(f); }
    function miss() { k++; failed++; return failed > GZ_TRIES ? rest() : later(member); }
    function result(capped, damaged) { return { out: join(parts).subarray(0, max), members: members, capped: capped, damaged: damaged }; }
    function isize(seg) { var n = seg.length; return n < 8 ? -1 : (seg[n - 4] | seg[n - 3] << 8 | seg[n - 2] << 16 | seg[n - 1] << 24) >>> 0; }
    function member() {
      if (start >= u8.length) return Promise.resolve(result(false, false));
      while (k < ends.length && ends[k] <= start) k++;
      if (k >= ends.length || members >= GZ_MEMBERS) return rest();
      var end = ends[k], seg = u8.subarray(start, end);
      return gunzipStrict(seg, max - got).then(function (r) {
        if (!r.capped && isize(seg) !== r.out.length % 4294967296) return miss();
        parts.push(r.out); got += r.out.length; members++; start = end; k++;
        return r.capped ? result(true, false) : later(member);
      }, miss);
    }
    // No whole member from here on: keep what a lenient unzip gives, and say the rest was damaged or cut.
    function rest() {
      if (start >= u8.length) return Promise.resolve(result(false, false));
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
    }).catch(function (e) { if (current()) fail(st, e, function () { openFile(key, size); }, state.bucketRegion); });
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
    }).catch(function (e) { if (current()) fail(st, e, function () { openFile(key, size); }, state.bucketRegion); });
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
        // The bracket is what shows; its name is what it does (sherpa walk 6: a screen reader said "left brace").
        fold.setAttribute("aria-label", fold.title);
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
    if (!P.signedIn()) clearListCache(); // signed out: nothing listed stays in memory
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
  // ---- keyboard (first note, item 13) ----
  // In a listing: Up and Down (Home, End) move between rows; Enter opens (the rows are buttons). Backspace or
  // Alt+Up goes up a level: from a file to its folder, from a folder to its parent. "/" moves to the filter;
  // Escape in a filter clears it. Typing in a field is never taken over.
  function typing(t) { return /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable; }
  function onKey(ev) {
    if (ev.ctrlKey || ev.metaKey) return;
    var t = ev.target, k = ev.key;
    if (k === "Escape" && t.classList && t.classList.contains("filter") && t.value) {
      t.value = ""; t.dispatchEvent(new Event("input")); ev.preventDefault(); return;
    }
    if (typing(t)) return;
    var chips = t.closest && t.closest("#s3-buckets");
    if (chips && /^(ArrowRight|ArrowLeft|ArrowDown|ArrowUp|Home|End)$/.test(k) && !ev.altKey) {
      var bs = Array.prototype.slice.call(chips.querySelectorAll("button")), at = bs.indexOf(t);
      var to = k === "Home" ? 0 : k === "End" ? bs.length - 1 : (at + (/Right|Down/.test(k) ? 1 : -1) + bs.length) % bs.length;
      bs.forEach(function (x, i) { x.tabIndex = i === to ? 0 : -1; }); bs[to].focus(); ev.preventDefault(); return;
    }
    var table = t.closest && t.closest(".s3-table");
    if (table && !ev.altKey && /^(ArrowDown|ArrowUp|Home|End)$/.test(k)) {
      var rows = Array.prototype.filter.call(table.querySelectorAll("tbody tr"), function (tr) { return !tr.hidden; })
        .map(function (tr) { return tr.querySelector("button"); }).filter(Boolean);
      var i = rows.indexOf(t), n = k === "Home" ? 0 : k === "End" ? rows.length - 1 : i + (k === "ArrowDown" ? 1 : -1);
      if (rows[n]) { rows[n].focus(); rows[n].scrollIntoView({ block: "nearest" }); }
      ev.preventDefault(); return;
    }
    if (k === "/" && !ev.altKey) {
      var f = (t.closest && t.closest(".viewer, #s3-objects") || $("s3-objects")).querySelector(".filter") || $("s3-objects").querySelector(".filter");
      if (f) { f.focus(); ev.preventDefault(); }
      return;
    }
    if ((k === "Backspace" && !ev.altKey) || (k === "ArrowUp" && ev.altKey)) {
      if (!state.bucket || !$("s3-list")) return;
      ev.preventDefault();
      // The address moves, and apply() lands the focus on the crumbs of the folder shown.
      if (state.key) return go(state.bucket, state.prefix);
      if (!state.prefix) return;
      var up = state.prefix.replace(/[^/]*\/$/, "");
      arrive = true; state.prefix = up; listObjects();
    }
  }
  function init() {
    $("step4").addEventListener("keydown", onKey);
    $("s3-list-buckets").onclick = function () {
      var was = state.acct && state.acct.id;
      state.acct = P.accounts().filter(function (a) { return a.id === $("s3-account").value; })[0];
      if (!state.acct || state.acct.id !== was) clearListCache();
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
  // limits are read as a copy and changed only through setLimits, which takes known keys with positive numbers.
  function setLimits(o) {
    Object.keys(o || {}).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(LIMITS, k) && typeof o[k] === "number" && o[k] >= 0 && isFinite(o[k])) LIMITS[k] = o[k]; });
    return Object.freeze(Object.assign({}, LIMITS));
  }
  window.S3Browser = { render: render, jsonView: jsonView, openAt: openAt, view: view, setLimits: setLimits,
    connections: connections, connectedPanel: connectedPanel,
    get limits() { return Object.freeze(Object.assign({}, LIMITS)); } };
  init();
})();
