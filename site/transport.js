// One way out to AWS. Every AWS call in the page goes through AwsTransport.fetch: in twin mode the twin
// (twin.js) answers it with synthetic data, otherwise it goes to AWS from the browser. The rest of the code
// cannot tell the difference. Twin mode is a per-browser setting (a convenience, not a secret).
(function (root) {
  "use strict";
  var KEY = "sws-aws-mode", twin = false;
  try { twin = localStorage.getItem(KEY) === "twin"; } catch (e) { /* none */ }
  function awsFetch(url, init) {
    if (twin && root.AwsTwin) { var r = root.AwsTwin.handle(url, init); if (r) return r; }
    return fetch(url, init);
  }
  function setTwin(on) {
    twin = !!on;
    try { if (twin) localStorage.setItem(KEY, "twin"); else localStorage.removeItem(KEY); } catch (e) { /* none */ }
  }
  root.AwsTransport = { fetch: awsFetch, isTwin: function () { return twin; }, setTwin: setTwin };
})(window);
