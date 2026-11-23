// One way out to AWS. Every AWS call in the page goes through AwsTransport.fetch: in twin mode the twin
// (twin.js) answers it with synthetic data, otherwise it goes to AWS from the browser. The rest of the code
// cannot tell the difference. Twin mode is a per-browser setting (a convenience, not a secret); ?twin or ?aws
// in the address overrides it.
// Fails closed (architect.aws.c, 23 Nov 2026): in twin mode nothing ever reaches the network. A host the twin
// does not answer, or a twin that did not load, gets an AWS-shaped 501 NotImplemented, never a real request.
(function (root) {
  "use strict";
  var KEY = "sws-aws-mode", twin = false;
  try { twin = localStorage.getItem(KEY) === "twin"; } catch (e) { /* none */ }
  try {
    var q = new URLSearchParams(root.location.search);
    if (q.has("twin")) { twin = true; localStorage.setItem(KEY, "twin"); }
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
