// Graph: the account's resources and how they link, built in the page from the service APIs and the activity
// reader only (design 03, part 4). Nodes and edges follow ontology.aws.a's schema (docs/ontology/
// twin-graph.schema.json): node { id, type, label, altitude, ... }, edge { from, rel, to, evidence, source }.
// The rules for each adapter follow ontology.aws.a's offline builder (docs/ontology/build-twin-graph.mjs), so the
// graph built here over the twin equals its twin-graph.json on the parts both cover (test/api/graph.test.mjs).
//
//   var g = Graph({ account: "111122223333" });
//   g.add.s3([{ name, region, cors, objects: [{ key, size, modified }] }])   buckets from S3Api, objects listed flat
//   g.add.activity(read, { bucket, key })    one trail file: Activity.read / fromBytes result, and where it came from
//   g.toJSON()                               -> { about, evidence_levels, counts, nodes, edges } (schema shape)
//
// Ids: the ARN where AWS defines one, otherwise urn:sws:<kind>:<name>. An edge seen twice keeps the stronger
// evidence (api, template, content, naming, comment, curated). Edges may name nodes no adapter has added yet
// (a role named by a trail record, before an IAM adapter exists): toJSON adds those as dangling "unknown" nodes,
// as the builder does, unless an adapter has added them. Reads only; nothing is stored anywhere.
(function (root) {
  "use strict";
  var EVIDENCE = ["api", "template", "content", "naming", "comment", "curated"];
  var GROUP = 50; // a folder with more objects than this is one prefix node, as the builder does
  var GOOGLE = "urn:sws:idp:accounts.google.com";
  var TARGET_ALTITUDE = { object: "A1", bucket: "A2", stack: "A2", function: "A2", policy: "A2", trail: "A2", role: "A4" };

  function Graph(opts) {
    opts = opts || {};
    var nodes = new Map(), edges = new Map(), account = opts.account || null;
    var ids = {
      account: function () { return "urn:sws:account:" + account; },
      region: function (r) { return "urn:sws:region:" + r; },
      bucket: function (b) { return "arn:aws:s3:::" + b; },
      object: function (b, k) { return "arn:aws:s3:::" + b + "/" + k; },
      prefix: function (b, p) { return "arn:aws:s3:::" + b + "/" + p + "*"; },
      trail: function (n) { return "urn:sws:cloudtrail-trail:" + n; },
      actor: function (ip) { return "urn:sws:actor-ip:" + ip; }
    };

    function node(id, type, altitude, label, extra) {
      var n = nodes.get(id) || { id: id, type: type, label: label, altitude: altitude };
      for (var k in extra || {}) n[k] = extra[k];
      nodes.set(id, n);
      return id;
    }
    function edge(from, rel, to, evidence, source) {
      var k = from + "\u0000" + rel + "\u0000" + to, old = edges.get(k);
      if (!old || EVIDENCE.indexOf(evidence) < EVIDENCE.indexOf(old.evidence)) edges.set(k, { from: from, rel: rel, to: to, evidence: evidence, source: source });
    }
    function accountNode() {
      if (account) node(ids.account(), "account", "A2", account);
      return account ? ids.account() : null;
    }
    function region(r, evidence, source) {
      node(ids.region(r), "region", "A2", r);
      var a = accountNode();
      if (a) edge(ids.region(r), "in", a, evidence, source);
      return ids.region(r);
    }

    // S3: buckets with their region and CORS (getBucket), and objects (listObjects, flat).
    function s3(buckets) {
      buckets.forEach(function (b) {
        var bid = node(ids.bucket(b.name), "bucket", "A2", b.name, { cfn_type: "AWS::S3::Bucket", browser_readable: !!b.cors });
        if (b.region) edge(bid, "in", region(b.region, "api", "Cloud Control GetResource"), "api", "Cloud Control GetResource (RegionalDomainName)");
        // A CloudTrail bucket made by the console is named aws-cloudtrail-logs-<account>-<trail>: a naming inference.
        var tm = /^aws-cloudtrail-logs-\d{12}-(.+)$/.exec(b.name);
        if (tm) {
          node(ids.trail(tm[1]), "trail", "A2", tm[1], { cfn_type: "AWS::CloudTrail::Trail", inferred: true, note: "named by its bucket" });
          edge(ids.trail(tm[1]), "logs_to", bid, "naming", "bucket name aws-cloudtrail-logs-<account>-" + tm[1]);
        }
        var byFolder = {};
        (b.objects || []).forEach(function (o) {
          var f = o.key.indexOf("/") >= 0 ? o.key.slice(0, o.key.lastIndexOf("/") + 1) : "";
          (byFolder[f] = byFolder[f] || []).push(o);
        });
        Object.keys(byFolder).forEach(function (f) {
          var list = byFolder[f];
          if (f && list.length > GROUP) {
            node(ids.prefix(b.name, f), "prefix", "A1", f + " (" + list.length + " objects)", { objects: list.length, bytes: list.reduce(function (s, o) { return s + (o.size || 0); }, 0) });
            edge(bid, "holds", ids.prefix(b.name, f), "api", "S3 ListObjectsV2");
          } else list.forEach(function (o) {
            node(ids.object(b.name, o.key), "object", "A1", o.key, { bytes: o.size, modified: o.modified });
            edge(bid, "holds", ids.object(b.name, o.key), "api", "S3 ListObjectsV2");
          });
        });
      });
    }

    // Activity: one trail file's events. Each event is a node; the file records it; the file's key path names its
    // region; the event acted as a role, signed in via an identity provider, and acted on its targets. The caller's
    // address becomes an actor node that acted on the same targets (design 03, refinement 6).
    function activity(read, file) {
      var fid = file && file.bucket && file.key ? ids.object(file.bucket, file.key) : null;
      if (fid) {
        var rr = /\/CloudTrail\/([a-z0-9-]+)\//.exec(file.key);
        if (rr) edge(fid, "in", region(rr[1], "content", "CloudTrail key path"), "content", "CloudTrail key path (AWSLogs/<account>/CloudTrail/<region>/)");
      }
      (read.events || []).forEach(function (e) {
        if (!e.node) return;
        node(e.node, "event", "A1", e.words, { ocsf_class: "API Activity", time: e.iso, src_ip: e.from && e.from.ip, read_only: !e.change });
        if (fid) edge(fid, "records", e.node, "content", "CloudTrail Records");
        if (e.who && e.who.kind === "role" && e.who.arn) {
          node(e.who.arn, "role", "A4", e.who.name || e.who.arn.split("/").pop(), { cfn_type: "AWS::IAM::Role" });
          edge(e.node, "acted_as", e.who.arn, "content", "CloudTrail userIdentity.sessionContext.sessionIssuer");
          if (e.who.via === "accounts.google.com") {
            node(GOOGLE, "identity_provider", "A4", "accounts.google.com", { note: "web identity federation; no IAM resource" });
            edge(e.node, "signed_in_via", GOOGLE, "content", "CloudTrail webIdFederationData.federatedProvider");
          }
        }
        var targets = actedOn(e.targets || []);
        targets.forEach(function (t) {
          // A target no other adapter has described yet gets a node of its type (ontology's altitudes).
          if (!nodes.has(t.id) && TARGET_ALTITUDE[t.type]) node(t.id, t.type, TARGET_ALTITUDE[t.type], t.name || t.id);
          edge(e.node, "acted_on", t.id, "content", "CloudTrail requestParameters");
        });
        var ip = e.from && e.from.ip;
        if (ip && /^[0-9a-fA-F:.]+$/.test(ip)) {
          var aid = node(ids.actor(ip), "actor", "A4", ip);
          targets.forEach(function (t) { edge(aid, "acted_on", t.id, "content", "CloudTrail sourceIPAddress " + ip); });
        }
      });
    }
    // An object names its bucket already: a bucket target with an object target in it is not a second edge.
    function actedOn(targets) {
      return targets.filter(function (t) {
        return !(t.type === "bucket" && targets.some(function (o) { return o.type === "object" && o.id.indexOf(t.id + "/") === 0; }));
      });
    }

    function toJSON() {
      var nodeList = Array.from(nodes.values()).map(function (n) { return Object.assign({}, n); });
      var edgeList = Array.from(edges.values()).map(function (e) { return Object.assign({}, e); });
      var have = new Set(nodeList.map(function (n) { return n.id; }));
      edgeList.forEach(function (e) {
        [e.from, e.to].forEach(function (end) {
          if (!have.has(end)) { have.add(end); nodeList.push({ id: end, type: "unknown", label: end, altitude: "A2", dangling: true, note: "named by an edge; no adapter has described it yet" }); }
        });
      });
      nodeList.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      edgeList.sort(function (a, b) { var x = a.from + a.rel + a.to, y = b.from + b.rel + b.to; return x < y ? -1 : x > y ? 1 : 0; });
      var by = {};
      edgeList.forEach(function (e) { by[e.evidence] = (by[e.evidence] || 0) + 1; });
      return { about: "Resource graph built in the page from the service APIs and the activity reader (site/api/graph.js).",
        evidence_levels: EVIDENCE.slice(), counts: { nodes: nodeList.length, edges: edgeList.length, by_evidence: by }, nodes: nodeList, edges: edgeList };
    }

    return { add: { s3: s3, activity: activity }, toJSON: toJSON, ids: ids };
  }

  root.Graph = Graph;
})(typeof window !== "undefined" ? window : globalThis);
