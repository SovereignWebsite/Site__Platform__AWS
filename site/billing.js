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

  function num(x) { var n = Number(x); return isFinite(n) ? n : null; }
  function money(amount, unit) { return { amount: num(amount), unit: unit || "USD" }; }
  function groups(answer) {
    var r = answer && answer.ResultsByTime && answer.ResultsByTime[0];
    var gs = (r && r.Groups) || [];
    return gs.map(function (g) { var m = g.Metrics[METRIC]; return { key: g.Keys[0], amount: num(m.Amount), unit: m.Unit }; })
      .filter(function (g) { return g.amount !== null && g.amount !== 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  // answers: { monthToDate, byService, byRegion, daily, forecast, budgets }, each a raw AWS answer, or an
  // { error } when that call failed, or undefined when it was not made. Missing parts stay null: never shown as 0.
  function model(answers) {
    var a = answers || {}, m = { errors: {} };
    Object.keys(a).forEach(function (k) { if (a[k] && a[k].error) m.errors[k] = String(a[k].error); });
    var r = a.monthToDate && a.monthToDate.ResultsByTime && a.monthToDate.ResultsByTime[0];
    m.monthToDate = r ? Object.assign(money(r.Total[METRIC].Amount, r.Total[METRIC].Unit), { start: r.TimePeriod && r.TimePeriod.Start, end: r.TimePeriod && r.TimePeriod.End, estimated: !!r.Estimated }) : null;
    var f = a.forecast && a.forecast.Total;
    m.forecastRest = f ? money(f.Amount, f.Unit) : null;
    // End-of-month figure: month to date plus the forecast of the rest; only when both are there and in one currency.
    m.endOfMonth = m.monthToDate && m.forecastRest && m.monthToDate.unit === m.forecastRest.unit && m.monthToDate.amount !== null && m.forecastRest.amount !== null
      ? money(m.monthToDate.amount + m.forecastRest.amount, m.monthToDate.unit) : null;
    m.byService = a.byService && !a.byService.error ? groups(a.byService) : null;
    m.byRegion = a.byRegion && !a.byRegion.error ? groups(a.byRegion) : null;
    m.daily = a.daily && a.daily.ResultsByTime ? a.daily.ResultsByTime.map(function (d) {
      var t = d.Total[METRIC]; return { day: d.TimePeriod.Start, amount: num(t.Amount), unit: t.Unit, estimated: !!d.Estimated };
    }) : null;
    m.budgets = a.budgets && a.budgets.Budgets ? a.budgets.Budgets.map(function (b) {
      var lim = b.BudgetLimit ? num(b.BudgetLimit.Amount) : null;
      var act = b.CalculatedSpend && b.CalculatedSpend.ActualSpend ? num(b.CalculatedSpend.ActualSpend.Amount) : null;
      var fc = b.CalculatedSpend && b.CalculatedSpend.ForecastedSpend ? num(b.CalculatedSpend.ForecastedSpend.Amount) : null;
      return { name: b.BudgetName, type: b.BudgetType, period: b.TimeUnit, limit: lim, actual: act, forecast: fc,
        unit: b.BudgetLimit ? b.BudgetLimit.Unit : "USD", used: lim && act !== null ? act / lim : null };
    }) : null;
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
      link(m.links.console, "Open Cost Explorer"), doc.createTextNode(". Each refresh makes up to five Cost Explorer requests, which AWS charges for: "),
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
    var days = el("div", { class: "costs-daily", role: "img", "aria-label": "Daily cost, last 30 days" });
    var max = (m.daily || []).reduce(function (s, d) { return Math.max(s, d.amount || 0); }, 0);
    (m.daily || []).forEach(function (d) {
      var h = max > 0 ? Math.round(((d.amount || 0) / max) * 100) : 0;
      days.appendChild(el("span", { class: "bar" + (d.estimated ? " estimated" : ""), style: "height:" + h + "%", title: d.day }));
    });
    box.appendChild(el("h3", { text: "Daily, last 30 days" + tag }));
    box.appendChild(m.daily ? days : el("p", { class: "small", text: "not read" }));
    var bt = el("table", { class: "costs-table" }, [el("caption", {}, [doc.createTextNode("Budgets "), link(m.links.budgets, "(how AWS reports them)")]),
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

  var api = { requests: requests, model: model, render: render, fmt: fmt, LINKS: LINKS };
  if (typeof module === "object" && module.exports) module.exports = api; else root.SwsBilling = api;
})(typeof window !== "undefined" ? window : globalThis);
