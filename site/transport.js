// One way out to AWS. Every AWS call in the page goes through AwsTransport.fetch: in twin mode the twin
// (twin.js) answers it with synthetic data, otherwise it goes to AWS from the browser. The rest of the code
// cannot tell the difference. Twin mode is a per-browser setting (a convenience, not a secret), set by the Try the twin button;
// ?twin in the address opens the twin for that page only, ?aws leaves it.
// Fails closed (architect.aws.c, 23 Nov 2026): in twin mode nothing ever reaches the network. A host the twin
// does not answer, or a twin that did not load, gets an AWS-shaped 501 NotImplemented, never a real request.
(function (root) {
  "use strict";
  var KEY = "sws-aws-mode", twin = false;
  try { twin = localStorage.getItem(KEY) === "twin"; } catch (e) { /* none */ }
  try {
    var q = new URLSearchParams(root.location.search);
    // A link with ?twin opens the twin for that page only; it is kept only when chosen by the button (setTwin),
    // so a link cannot quietly leave the owner's browser on synthetic AWS (security R-011).
    if (q.has("twin")) twin = true;
    if (q.has("aws")) { twin = false; localStorage.removeItem(KEY); }
  } catch (e) { /* none */ }
  function notInTwin(url) {
    var host = ""; try { host = new URL(url).host; } catch (e) { /* none */ }
    var body = "<ErrorResponse><Error><Code>NotImplemented</Code><Message>The twin does not answer " + host.replace(/[<>&]/g, "") +
      " yet. Twin mode never calls real AWS.</Message></Error></ErrorResponse>";
    return Promise.resolve(new Response(body, { status: 501, headers: { "content-type": "text/xml" } }));
  }
  function awsFetch(url, init) {
    if (twin) {
      var r = root.AwsTwin && root.AwsTwin.handle(url, init);
      return r || notInTwin(url);
    }
    return fetch(url, init);
  }
  function setTwin(on) {
    twin = !!on;
    try { if (twin) localStorage.setItem(KEY, "twin"); else localStorage.removeItem(KEY); } catch (e) { /* none */ }
  }
  root.AwsTransport = { fetch: awsFetch, isTwin: function () { return twin; }, setTwin: setTwin };
})(window);
