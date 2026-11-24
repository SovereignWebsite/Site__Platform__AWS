// CostsApi: Cost Explorer and Budgets reads as plain objects, for the Costs tab (billing.aws.a builds the tab; design 03's
// one shape; conductor.aws.a's split). Over the same send as the other APIs. Cost Explorer: https://ce.us-east-1.amazonaws.com/,
// signing name ce, region us-east-1, JSON 1.1 with X-Amz-Target AWSInsightsIndexService.<Action>. Budgets:
// https://budgets.amazonaws.com/, signing name budgets, region us-east-1, JSON 1.1, AWSBudgetServiceGateway.<Action>.
// Shapes per botocore ce 2017-10-25 and budgets 2016-10-20 (boto3.aws.a is confirming endpoints, paging and CORS).
// Reads only, within the read role's costs-read (ce:GetCostAndUsage, ce:GetCostForecast, ce:GetDimensionValues,
// budgets:ViewBudget). Cost Explorer charges per request on a real account (billing.aws.a's figures): the page calls
// these when asked, never on a timer.
//
//   var api = CostsApi(send, { account });
//   api.usage({ start, end, granularity, groupBy, metric, maxPages }) -> { items: [period], capped }    GetCostAndUsage, every
//       page read (NextPageToken) up to maxPages (default 12), capped true when it stopped with pages left
//       period = { start, end, estimated, total: { amount, unit } | null, groups: [{ key, amount, unit }] }
//   api.forecast({ start, end, granularity, metric })               -> { total, start, end, items: [{ start, end, mean, low, high }] }   GetCostForecast
//   api.dimensionValues({ dimension, start, end, next })            -> { items: [value], next }        GetDimensionValues
//   api.budgets({ next, max })                                      -> { items: [budget], next }       DescribeBudgets
//       budget = { name, type, timeUnit, limit, actual, forecast, start, end }   (money as { amount, unit } or null)
//   CostsApi.all = ApiAll (site/api/all.js).
//
// Dates are YYYY-MM-DD, start before end (Cost Explorer's End is exclusive); granularity DAILY or MONTHLY; groupBy
// SERVICE, REGION or none; usage metric UnblendedCost, BlendedCost, AmortizedCost or NetUnblendedCost; forecast metric
// the matching UNBLENDED_COST and so on; every value is checked before a request. Amounts are numbers (billing.aws.a's
// view sums and formats them); a missing or malformed amount is null, never 0; zero groups are kept (the view drops
// them). GetCostForecast cannot start in the past: start today. Budgets: the SDK's CORS table does not mark it (note 21),
// but conductor.aws.a's preflight (2026-11-24T00:47Z) found it allows the site's origin, as Cost Explorer does; the
// real response headers are confirmed on Dinis's first load. A refusal is a TypeError, passed through. Service and budget names are AWS's or the owner's text: render as text. Errors: an Error "Code: Message" with .code and .status; a CORS TypeError passes
// through; answers over 4 MB are refused, by their declared length when they give one.
(function (root) {
  "use strict";
  var MAX_BODY = 4 * 1024 * 1024, DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  var GRAN = { DAILY: 1, MONTHLY: 1 }, GROUP = { SERVICE: 1, REGION: 1 };
  var METRIC = { UnblendedCost: "UNBLENDED_COST", BlendedCost: "BLENDED_COST", AmortizedCost: "AMORTIZED_COST", NetUnblendedCost: "NET_UNBLENDED_COST" };
  var FORECAST = { UNBLENDED_COST: 1, BLENDED_COST: 1, AMORTIZED_COST: 1, NET_UNBLENDED_COST: 1 };
  function fail(code, message, status) { var e = new Error(code + ": " + message); e.code = code; e.status = status; return e; }
  function bad(m) { return Promise.reject(new TypeError(m)); }
  function day(s) { var m = DATE.exec(String(s === undefined || s === null ? "" : s)); if (!m) return null; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCDate() === +m[3] ? m[0] : null; }
  function period(o) {
    var s = day(o && o.start), e = day(o && o.end);
    if (!s || !e) return "start and end are YYYY-MM-DD dates";
    if (s >= e) return "start must be before end (end is exclusive)";
    return { Start: s, End: e };
  }
  function amount(a) { return typeof a === "string" && /^-?\d{1,15}(\.\d{1,12})?$/.test(a) ? Number(a) : null; }
  function money(m) {
    if (!m || typeof m !== "object") return null;
    var a = amount(m.Amount);
    return a === null ? null : { amount: a, unit: typeof m.Unit === "string" ? m.Unit.slice(0, 8) : null };
  }
  function token(t) { return typeof t === "string" && t ? t : null; }
  function CostsApi(send, opts) {
    if (typeof send !== "function") throw new TypeError("CostsApi needs a send function");
    var account = opts && opts.account;
    function call(service, host, target, body) {
      return send({ service: service, region: "us-east-1", method: "POST", url: "https://" + host + "/",
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": target }, body: JSON.stringify(body) }).then(function (r) {
        var declared = Number(r.headers && r.headers.get && r.headers.get("content-length"));
        if (declared > MAX_BODY) return Promise.reject(fail("TooLarge", "the answer is over " + MAX_BODY + " characters; not read", r.status));
        return r.text().then(function (t) {
          if (t.length > MAX_BODY) throw fail("TooLarge", "the answer is over " + MAX_BODY + " characters; not read", r.status);
          var j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
          if (r.ok && j && typeof j === "object") return j;
          var type = j && typeof j.__type === "string" ? j.__type.split("#").pop() : "HTTP " + r.status;
          var msg = j && (typeof j.message === "string" ? j.message : typeof j.Message === "string" ? j.Message : null);
          throw fail(r.ok ? "BadAnswer" : type, msg || (r.ok ? "not JSON" : "no message"), r.status);
        });
      });
    }
    var ce = function (action, body) { return call("ce", "ce.us-east-1.amazonaws.com", "AWSInsightsIndexService." + action, body); };
    function usage(o) {
      o = o || {};
      var tp = period(o), g = o.granularity === undefined ? "MONTHLY" : o.granularity, m = o.metric === undefined ? "UnblendedCost" : o.metric;
      if (typeof tp === "string") return bad(tp);
      if (!GRAN[g]) return bad("granularity is DAILY or MONTHLY");
      if (!Object.prototype.hasOwnProperty.call(METRIC, m)) return bad("metric is UnblendedCost, BlendedCost, AmortizedCost or NetUnblendedCost");
      if (o.groupBy !== undefined && o.groupBy !== null && !GROUP[o.groupBy]) return bad("groupBy is SERVICE, REGION or none");
      var body = { TimePeriod: tp, Granularity: g, Metrics: [m] }, maxPages = Math.min(Math.max(1, (o.maxPages | 0) || 12), 50);
      if (o.groupBy) body.GroupBy = [{ Type: "DIMENSION", Key: o.groupBy }];
      var page = function (next) {
        var b = next ? Object.assign({}, body, { NextPageToken: next }) : body;
        return ce("GetCostAndUsage", b).then(function (j) { return { items: periodsOf(j), next: token(j.NextPageToken) }; });
      };
      return root.ApiAll(page, { maxPages: maxPages, maxItems: 5000 }).then(function (all) { return { items: all.items, capped: all.capped }; });
      function periodsOf(j) {
        return (Array.isArray(j.ResultsByTime) ? j.ResultsByTime : []).map(function (p) {
          var t = p && p.TimePeriod || {}, total = money(p && p.Total && p.Total[m]);
          return { start: day(t.Start), end: day(t.End), estimated: !!(p && p.Estimated), total: total,
            groups: (p && Array.isArray(p.Groups) ? p.Groups : []).map(function (gr) {
              var v = money(gr && gr.Metrics && gr.Metrics[m]);
              return { key: gr && Array.isArray(gr.Keys) && typeof gr.Keys[0] === "string" ? gr.Keys[0] : null, amount: v ? v.amount : null, unit: v ? v.unit : null };
            }).filter(function (x) { return x.key !== null; }) };
        });
      }
    }
    function forecast(o) {
      o = o || {};
      var tp = period(o), g = o.granularity === undefined ? "MONTHLY" : o.granularity, m = o.metric === undefined ? "UNBLENDED_COST" : o.metric;
      if (typeof tp === "string") return bad(tp);
      if (!GRAN[g]) return bad("granularity is DAILY or MONTHLY");
      if (!FORECAST[m]) return bad("metric is UNBLENDED_COST, BLENDED_COST, AMORTIZED_COST or NET_UNBLENDED_COST");
      return ce("GetCostForecast", { TimePeriod: tp, Metric: m, Granularity: g }).then(function (j) {
        return { total: money(j.Total), start: tp.Start, end: tp.End, items: (Array.isArray(j.ForecastResultsByTime) ? j.ForecastResultsByTime : []).map(function (f) {
          var t = f && f.TimePeriod || {};
          return { start: day(t.Start), end: day(t.End), mean: amount(f && f.MeanValue), low: amount(f && f.PredictionIntervalLowerBound), high: amount(f && f.PredictionIntervalUpperBound) };
        }) };
      });
    }
    function dimensionValues(o) {
      o = o || {};
      var tp = period(o);
      if (typeof tp === "string") return bad(tp);
      if (!GROUP[o.dimension]) return bad("dimension is SERVICE or REGION");
      var body = { TimePeriod: tp, Dimension: o.dimension };
      if (o.next) body.NextPageToken = String(o.next);
      return ce("GetDimensionValues", body).then(function (j) {
        return { items: (Array.isArray(j.DimensionValues) ? j.DimensionValues : []).map(function (d) { return d && typeof d.Value === "string" ? d.Value : null; }).filter(function (v) { return v !== null; }),
          next: token(j.NextPageToken) };
      });
    }
    function budgets(o) {
      o = o || {};
      if (!/^\d{12}$/.test(String(account || ""))) return bad("budgets needs the account id (12 digits)");
      var body = { AccountId: String(account) };
      if (o.max) body.MaxResults = Math.min(Math.max(1, o.max | 0), 100);
      if (o.next) body.NextToken = String(o.next);
      return call("budgets", "budgets.amazonaws.com", "AWSBudgetServiceGateway.DescribeBudgets", body).then(function (j) {
        return { items: (Array.isArray(j.Budgets) ? j.Budgets : []).map(function (b) {
          var cs = b && b.CalculatedSpend || {}, tp = b && b.TimePeriod || {};
          var when = function (v) {
            if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
            if (typeof v !== "number" || !isFinite(v) || Math.abs(v) > 8.64e12) return null;
            var d = new Date(v * 1000); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
          };
          return { name: b && typeof b.BudgetName === "string" ? b.BudgetName : null, type: b && b.BudgetType || null, timeUnit: b && b.TimeUnit || null,
            limit: money(b && b.BudgetLimit), actual: money(cs.ActualSpend), forecast: money(cs.ForecastedSpend), start: when(tp.Start), end: when(tp.End) };
        }).filter(function (b) { return b.name !== null; }), next: token(j.NextToken) };
      });
    }
    return { usage: usage, forecast: forecast, dimensionValues: dimensionValues, budgets: budgets };
  }
  CostsApi.all = function (page, opts) { return root.ApiAll(page, opts); };
  root.CostsApi = CostsApi;
})(typeof window !== "undefined" ? window : globalThis);
