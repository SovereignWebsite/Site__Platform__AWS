// Costs view: the owner's real AWS costs, read with the read role the site already has
// (site/cloudformation/bootstrap.yaml, costs-read: ce:GetCostAndUsage, ce:GetCostForecast, budgets:View*).
// billing.aws.a@SovereignWebsite.dinis, 23 Nov 2026, for Dinis Cruz's "I really want to see the billing of my AWS"
// (relayed by a.conductor.aws). No new AWS permission, no server code, nothing stored: answers live in page memory.
// Split in two: requests() and model() are pure and tested (docs/billing/billing-view.test.mjs);
// render() builds DOM nodes (never innerHTML) and puts every amount in a data-mask element, so screenshot mode
// (site/mask.js) hides it whole.
(function (root) {
  "use strict";

  var DOCS = "https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/";
  var LINKS = {
    console: "https://console.aws.amazon.com/costmanagement/home",
    usage: DOCS + "API_GetCostAndUsage.html",
    forecast: DOCS + "API_GetCostForecast.html",
    budgets: DOCS + "API_budgets_DescribeBudgets.html",
    budgetsConsole: "https://console.aws.amazon.com/billing/home#/budgets",
    pricing: "https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/",
  };
  var METRIC = "UnblendedCost";

  function ymd(d) { return d.toISOString().slice(0, 10); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
  function monthStart(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
  function nextMonthStart(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }

  // The calls, as { name, target, payload } for jsonCall in app.js (Cost Explorer is in us-east-1).
  // Cost Explorer's End is exclusive; on the 1st of a month there is no month to date yet, so those calls are skipped.
  // Each Cost Explorer request is charged by AWS (costexplorer.api.request in docs/billing/prices.json: $0.01).
  function requests(today, accountId) {
    var t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    var start = ymd(monthStart(t)), end = ymd(t), out = [];
    var mtd = { Start: start, End: end };
    if (start !== end) {
      out.push({ name: "monthToDate", service: "ce", target: "AWSInsightsIndexService.GetCostAndUsage",
        payload: { TimePeriod: mtd, Granularity: "MONTHLY", Metrics: [METRIC] } });
      out.push({ name: "byService", service: "ce", target: "AWSInsightsIndexService.GetCostAndUsage",
        payload: { TimePeriod: mtd, Granularity: "MONTHLY", Metrics: [METRIC], GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }] } });
      out.push({ name: "byRegion", service: "ce", target: "AWSInsightsIndexService.GetCostAndUsage",
        payload: { TimePeriod: mtd, Granularity: "MONTHLY", Metrics: [METRIC], GroupBy: [{ Type: "DIMENSION", Key: "REGION" }] } });
    }
    out.push({ name: "daily", service: "ce", target: "AWSInsightsIndexService.GetCostAndUsage",
      payload: { TimePeriod: { Start: ymd(addDays(t, -30)), End: end }, Granularity: "DAILY", Metrics: [METRIC] } });
    // GetCostForecast starts today (it cannot start in the past) and runs to the end of the month.
    out.push({ name: "forecast", service: "ce", target: "AWSInsightsIndexService.GetCostForecast",
      payload: { TimePeriod: { Start: end, End: ymd(nextMonthStart(t)) }, Granularity: "MONTHLY", Metric: "UNBLENDED_COST" } });
    if (accountId) out.push({ name: "budgets", service: "budgets", target: "AWSBudgetServiceGateway.DescribeBudgets",
      payload: { AccountId: accountId, MaxResults: 100 } });
    return out;
  }

  // A missing value is null, never 0 (Number(null) would be 0).
  function num(x) { if (x === null || x === undefined || x === "") return null; var n = Number(x); return isFinite(n) ? n : null; }
  function money(amount, unit) { return { amount: num(amount), unit: typeof unit === "string" && unit ? unit : "USD" }; }
  // Safe read of a nested field: any missing step gives undefined instead of throwing (security.aws.a, L1).
  function get(o, path) { for (var i = 0; i < path.length; i++) { if (o === null || o === undefined) return undefined; o = o[path[i]]; } return o; }
  function list(x) { return Array.isArray(x) ? x : []; }
  // One section's odd answer must not blank the others: a section that throws is "not read".
  function section(errors, name, fn) { try { return fn(); } catch (e) { errors[name] = "answer not understood"; return null; } }
  function groups(answer) {
    return list(get(answer, ["ResultsByTime", 0, "Groups"])).map(function (g) {
      return { key: String(get(g, ["Keys", 0]) || ""), amount: num(get(g, ["Metrics", METRIC, "Amount"])), unit: get(g, ["Metrics", METRIC, "Unit"]) || "USD" };
    }).filter(function (g) { return g.amount !== null && g.amount !== 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  // answers: { monthToDate, byService, byRegion, daily, forecast, budgets }, each a raw AWS answer, or an
  // { error } when that call failed, or undefined when it was not made. Missing parts stay null: never shown as 0.
  function model(answers) {
    var a = answers || {}, m = { errors: {} };
    Object.keys(a).forEach(function (k) { if (a[k] && a[k].error) m.errors[k] = String(a[k].error); });
    var ok = function (k) { return a[k] && !a[k].error; };
    m.monthToDate = !ok("monthToDate") ? null : section(m.errors, "monthToDate", function () {
      var r = get(a.monthToDate, ["ResultsByTime", 0]), t = get(r, ["Total", METRIC]);
      if (!t || num(t.Amount) === null) throw new Error("no total");
      return Object.assign(money(t.Amount, t.Unit), { start: get(r, ["TimePeriod", "Start"]), end: get(r, ["TimePeriod", "End"]), estimated: !!get(r, ["Estimated"]) });
    });
    m.forecastRest = !ok("forecast") ? null : section(m.errors, "forecast", function () {
      var f = get(a.forecast, ["Total"]); if (!f || num(f.Amount) === null) throw new Error("no total"); return money(f.Amount, f.Unit);
    });
    // End-of-month figure: month to date plus the forecast of the rest; only when both are there and in one currency.
    m.endOfMonth = m.monthToDate && m.forecastRest && m.monthToDate.unit === m.forecastRest.unit && m.monthToDate.amount !== null && m.forecastRest.amount !== null
      ? money(m.monthToDate.amount + m.forecastRest.amount, m.monthToDate.unit) : null;
    m.byService = !ok("byService") ? null : section(m.errors, "byService", function () { return groups(a.byService); });
    m.byRegion = !ok("byRegion") ? null : section(m.errors, "byRegion", function () { return groups(a.byRegion); });
    m.daily = !ok("daily") || !Array.isArray(get(a.daily, ["ResultsByTime"])) ? null : section(m.errors, "daily", function () {
      return a.daily.ResultsByTime.map(function (d) {
        return { day: String(get(d, ["TimePeriod", "Start"]) || ""), amount: num(get(d, ["Total", METRIC, "Amount"])), unit: get(d, ["Total", METRIC, "Unit"]) || "USD", estimated: !!get(d, ["Estimated"]) };
      });
    });
    m.budgets = !ok("budgets") || !Array.isArray(get(a.budgets, ["Budgets"])) ? null : section(m.errors, "budgets", function () {
      return a.budgets.Budgets.map(function (b) {
        var lim = num(get(b, ["BudgetLimit", "Amount"])), act = num(get(b, ["CalculatedSpend", "ActualSpend", "Amount"]));
        return { name: String(get(b, ["BudgetName"]) || "(unnamed)"), type: get(b, ["BudgetType"]), period: get(b, ["TimeUnit"]), limit: lim, actual: act,
          forecast: num(get(b, ["CalculatedSpend", "ForecastedSpend", "Amount"])), unit: get(b, ["BudgetLimit", "Unit"]) || "USD",
          used: lim && act !== null ? act / lim : null };
      });
    });
    m.links = LINKS;
    return m;
  }

  // The same text form mask.js recognises as a cost ("12.34 USD").
  function fmt(x) { return x && x.amount !== null ? x.amount.toFixed(2) + " " + x.unit : "not read"; }

  function render(m, doc, opts) {
    doc = doc || root.document; opts = opts || {};
    function el(tag, attrs, kids) {
      var e = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
      (kids || []).forEach(function (c) { e.appendChild(c); });
      return e;
    }
    function amount(x) { return el("span", { class: "v", "data-mask": "", text: fmt(x) }); }
    function link(href, text) { return el("a", { href: href, target: "_blank", rel: "noopener", text: text }); }
    var tag = opts.synthetic ? " (synthetic)" : "";
    var box = el("section", { class: "costs" });
    box.appendChild(el("div", { class: "stats" }, [
      el("div", { class: "stat" }, [el("span", { class: "k", text: "This month so far" + tag }), amount(m.monthToDate)]),
      el("div", { class: "stat" }, [el("span", { class: "k", text: "Forecast for the whole month" + tag }), amount(m.endOfMonth)]),
    ]));
    box.appendChild(el("p", { class: "small" }, [doc.createTextNode("From AWS Cost Explorer (unblended cost, before credits are netted out in the console). "),
      link(m.links.console, "Open Cost Explorer"), doc.createTextNode(". Answers are kept while this page is open; each refresh makes up to five Cost Explorer requests, which AWS charges for: "),
      link(m.links.pricing, "pricing"), doc.createTextNode(".")]));
    function table(title, rows, keyName, href) {
      var t = el("table", { class: "costs-table" }, [el("caption", {}, [doc.createTextNode(title + " "), link(href, "(how AWS reports it)")]),
        el("tr", {}, [el("th", { text: keyName }), el("th", { text: "This month so far" })])]);
      if (!rows) t.appendChild(el("tr", {}, [el("td", { colspan: "2", text: "not read" })]));
      else if (!rows.length) t.appendChild(el("tr", {}, [el("td", { colspan: "2", text: "no costs yet this month" })]));
      else rows.forEach(function (r) { t.appendChild(el("tr", {}, [el("td", { text: r.key || "(none)" }), el("td", {}, [amount(r)])])); });
      return t;
    }
    box.appendChild(table("By service", m.byService, "Service", m.links.usage));
    box.appendChild(table("By region", m.byRegion, "Region", m.links.usage));
    // Daily: bars whose heights are relative to the dearest day; amounts only in the masked title text.
    // data-mask and the costs-daily class let screenshot mode hide the bars' shape too
    // (style.css, with aws.c: body.screenshot .costs-daily .bar { height: 50% !important; }).
    var days = el("div", { class: "costs-daily", "data-mask": "", role: "img", "aria-label": "Daily cost, last 30 days" });
    var max = (m.daily || []).reduce(function (s, d) { return Math.max(s, d.amount || 0); }, 0);
    (m.daily || []).forEach(function (d) {
      var h = max > 0 ? Math.round(((d.amount || 0) / max) * 100) : 0;
      days.appendChild(el("span", { class: "bar" + (d.estimated ? " estimated" : ""), style: "height:" + h + "%", title: d.day }));
    });
    box.appendChild(el("h3", { text: "Daily, last 30 days" + tag }));
    box.appendChild(m.daily ? days : el("p", { class: "small", text: "not read" }));
    var bt = el("table", { class: "costs-table" }, [el("caption", {}, [doc.createTextNode("Budgets "), link(m.links.budgets, "(how AWS reports them)"), doc.createTextNode(", "), link(m.links.budgetsConsole, "open the AWS Budgets console")]),
      el("tr", {}, [el("th", { text: "Budget" }), el("th", { text: "Limit" }), el("th", { text: "Spent" }), el("th", { text: "Used" })])]);
    if (!m.budgets) bt.appendChild(el("tr", {}, [el("td", { colspan: "4", text: "not read" })]));
    else if (!m.budgets.length) bt.appendChild(el("tr", {}, [el("td", { colspan: "4", text: "no budgets in this account" })]));
    else m.budgets.forEach(function (b) {
      bt.appendChild(el("tr", {}, [el("td", { text: b.name }), el("td", {}, [amount({ amount: b.limit, unit: b.unit })]),
        el("td", {}, [amount({ amount: b.actual, unit: b.unit })]), el("td", { "data-mask": "", text: b.used === null ? "not read" : Math.round(b.used * 100) + "%" })]));
    });
    box.appendChild(bt);
    Object.keys(m.errors).forEach(function (k) { box.appendChild(el("p", { class: "status bad", text: k + ": " + m.errors[k] })); });
    return box;
  }

  // ---- Over dev.2.aws.a's CostsApi (site/api/costs-api.js): the agreed split, CostsApi makes the calls, this file
  // arranges them. fetchAll(api, today) makes the same calls requests() describes, drains NextPageToken pages (at most
  // 3 per monthly section and for budgets, 5 for the daily one: every page is a paid call, about 20 at worst), and
  // records a failed section as { error } so the others still show. modelFromApi() gives the same model as model().
  function drain(call, args, max) {
    var items = [], n = 0;
    function step(next) {
      return call(Object.assign({}, args, next ? { next: next } : {})).then(function (r) {
        items = items.concat(list(r && r.items)); n++;
        return r && r.next && n < (max || 3) ? step(r.next) : items;
      });
    }
    return step(null);
  }
  // Budgets answers a CORS preflight from the site's origin (a.conductor.aws checked, 24 Nov 2026 00:47Z); if the real
  // call still fails, only that section shows "not read", with the console link beside it.
  function settle(p) { return p.then(function (v) { return v; }, function (e) { return { error: (e && e.message) || String(e) }; }); }
  function fetchAll(api, today, accountId) {
    var t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    var start = ymd(monthStart(t)), end = ymd(t), mtd = start !== end, jobs = {};
    if (mtd) {
      jobs.monthToDate = settle(drain(api.usage, { start: start, end: end, granularity: "MONTHLY", maxPages: 3 }, 3));
      jobs.byService = settle(drain(api.usage, { start: start, end: end, granularity: "MONTHLY", groupBy: "SERVICE", maxPages: 3 }, 3));
      jobs.byRegion = settle(drain(api.usage, { start: start, end: end, granularity: "MONTHLY", groupBy: "REGION", maxPages: 3 }, 3));
    }
    jobs.daily = settle(drain(api.usage, { start: ymd(addDays(t, -30)), end: end, granularity: "DAILY", maxPages: 5 }, 5));
    jobs.forecast = settle(api.forecast({ start: end, end: ymd(nextMonthStart(t)), granularity: "MONTHLY" }));
    if (accountId) jobs.budgets = settle(drain(api.budgets, { max: 100 }, 3));
    var names = Object.keys(jobs);
    return Promise.all(names.map(function (k) { return jobs[k]; })).then(function (vals) {
      var out = {}; names.forEach(function (k, i) { out[k] = vals[i]; }); return out;
    });
  }
  function apiMoney(x) { return x && typeof x === "object" ? money(x.amount, x.unit) : null; }
  function sumGroups(periods) {
    var by = Object.create(null);
    list(periods).forEach(function (p) { list(p && p.groups).forEach(function (g) {
      var a = num(g && g.amount); if (a === null || !g.key) return;
      var k = String(g.key); by[k] = by[k] || { key: k, amount: 0, unit: g.unit || "USD" }; by[k].amount += a;
    }); });
    return Object.keys(by).map(function (k) { return by[k]; }).filter(function (g) { return g.amount !== 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }
  function modelFromApi(r) {
    var a = r || {}, m = { errors: {}, links: LINKS };
    Object.keys(a).forEach(function (k) { if (a[k] && a[k].error) m.errors[k] = String(a[k].error); });
    var ok = function (k) { return a[k] && !a[k].error; };
    m.monthToDate = !ok("monthToDate") ? null : section(m.errors, "monthToDate", function () {
      var p = list(a.monthToDate)[0], t = apiMoney(p && p.total);
      if (!t || t.amount === null) throw new Error("no total");
      return Object.assign(t, { start: p.start, end: p.end, estimated: !!p.estimated });
    });
    m.forecastRest = !ok("forecast") ? null : section(m.errors, "forecast", function () {
      var f = apiMoney(a.forecast.total); if (!f || f.amount === null) throw new Error("no total"); return f;
    });
    m.endOfMonth = m.monthToDate && m.forecastRest && m.monthToDate.unit === m.forecastRest.unit
      ? money(m.monthToDate.amount + m.forecastRest.amount, m.monthToDate.unit) : null;
    m.byService = !ok("byService") ? null : section(m.errors, "byService", function () { return sumGroups(a.byService); });
    m.byRegion = !ok("byRegion") ? null : section(m.errors, "byRegion", function () { return sumGroups(a.byRegion); });
    m.daily = !ok("daily") ? null : section(m.errors, "daily", function () {
      return list(a.daily).map(function (p) { var t = apiMoney(p && p.total); return { day: String((p && p.start) || ""), amount: t ? t.amount : null, unit: t ? t.unit : "USD", estimated: !!(p && p.estimated) }; });
    });
    m.budgets = !ok("budgets") ? null : section(m.errors, "budgets", function () {
      return list(a.budgets).map(function (b) {
        var lim = apiMoney(b && b.limit), act = apiMoney(b && b.actual), fc = apiMoney(b && b.forecast);
        var l = lim ? lim.amount : null, ac = act ? act.amount : null;
        return { name: String((b && b.name) || "(unnamed)"), type: b && b.type, period: b && b.timeUnit, limit: l, actual: ac,
          forecast: fc ? fc.amount : null, unit: lim ? lim.unit : "USD", used: l && ac !== null ? ac / l : null };
      });
    });
    return m;
  }

  // Each Cost Explorer request costs the owner $0.01, so answers are kept in page memory for the tab session:
  // switching tabs shows the kept answers; only refresh: true asks AWS again. Keyed by account and UTC day.
  // Nothing is stored beyond this page's memory.
  // Refresh is manual only (no timer, no refresh on focus) and at most once per REFRESH_MS per key, so a stuck
  // button or a loop cannot run up a bill (security.aws.a, L2). opts.now is for tests.
  var kept = {}, at = {}, REFRESH_MS = 5 * 60 * 1000;
  function load(key, fetchAll, opts) {
    opts = opts || {};
    var now = opts.now !== undefined ? opts.now : Date.now();
    var fresh = kept[key] && now - at[key] < REFRESH_MS;
    if (kept[key] && (!opts.refresh || fresh)) return kept[key];
    var p = Promise.resolve().then(fetchAll);
    kept[key] = p; at[key] = now;
    p.catch(function () { if (kept[key] === p) { delete kept[key]; delete at[key]; } }); // a failed load is not kept
    return p;
  }
  function refreshAllowedIn(key, now) { if (!kept[key]) return 0; var left = REFRESH_MS - ((now !== undefined ? now : Date.now()) - at[key]); return left > 0 ? left : 0; }
  function cacheKey(accountId, today) { return String(accountId || "") + "|" + ymd(today); }
  function forget() { kept = {}; at = {}; }

  var api = { requests: requests, model: model, render: render, fmt: fmt, LINKS: LINKS, load: load, cacheKey: cacheKey, forget: forget,
    fetchAll: fetchAll, modelFromApi: modelFromApi,
    refreshAllowedIn: refreshAllowedIn, REFRESH_MS: REFRESH_MS };
  if (typeof module === "object" && module.exports) module.exports = api; else root.SwsBilling = api;
})(typeof window !== "undefined" ? window : globalThis);
