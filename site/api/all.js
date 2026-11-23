// ApiAll: drain a service API's pages, up to a cap (design 03, part 1). Every new list method returns one page,
// { items, next }, with next null at the end; this is the one place a page asks for "everything", and it is bounded.
//
//   ApiAll(function (next) { return LambdaApi(send).functions(region, { next: next }); }, { maxItems, maxPages })
//     -> Promise<{ items, capped }>   capped: true when it stopped at a cap with pages still to read
(function (root) {
  "use strict";
  function ApiAll(page, opts) {
    opts = opts || {};
    var maxItems = opts.maxItems || 5000, maxPages = opts.maxPages || 100, items = [], pages = 0;
    function step(next) {
      return Promise.resolve(page(next)).then(function (p) {
        pages++;
        items = items.concat(p.items || []);
        var more = p.next !== null && p.next !== undefined && p.next !== "";
        if (more && (items.length >= maxItems || pages >= maxPages)) return { items: items.slice(0, maxItems), capped: true };
        if (!more) return { items: items.slice(0, maxItems), capped: items.length > maxItems };
        return step(p.next);
      });
    }
    return step(null);
  }
  root.ApiAll = ApiAll;
})(typeof window !== "undefined" ? window : globalThis);
