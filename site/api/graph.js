// Graph: the account's resources and how they link, built in the page from the service APIs and the activity
// reader only (design 03, part 4). Nodes and edges follow ontology.aws.a's schema (docs/ontology/
// twin-graph.schema.json): node { id, type, label, altitude, ... }, edge { from, rel, to, evidence, source }.
// The rules for each adapter follow ontology.aws.a's offline builder (docs/ontology/build-twin-graph.mjs), so the
// graph built here over the twin equals its twin-graph.json on the parts both cover (test/api/graph.test.mjs).
//
//   var g = Graph({ account: "111122223333" });
//   g.add.s3([{ name, region, cors, objects: [{ key, size, modified }] }])   buckets from S3Api, objects listed flat
//   g.add.activity(read, { bucket, key })    one trail file: Activity.read / fromBytes result, and where it came from
//   g.add.content(files, { site })           what files say: [{ bucket, key, text }] already decoded (Decode), and
//                                            optionally which bucket serves a site: { name, bucket }
//   g.add.lambda(functions)                  LambdaApi functions (items of functions(), or function())
//   g.add.firehose(streams)                  FirehoseApi stream() results
//   g.add.iam({ roles, providers })          IamApi roles() items or role() results, each with .attached, and
//                                            providers() (optional)
//   g.add.cfn({ stacks, exports })          CfnApi stacks() items or stack() results, each with .resources (resources()
//                                            items) and optionally .importers: [{ export, stack }] (importers() per
//                                            export the stack exports: the export's name and an importing stack's name);
//                                            exports() items (optional, to check an export is the stack's own)
//   g.add.cloudfront({ distributions, functions })  CloudFrontApi distribution() results (or distributions() items) and
//                                            functions() items (optional): architect.aws.a design 06, section 3
//   g.add.zips([{ bucket, key, sha256, packageName, entries }])   deployment packages; the facts come from
//                                            Graph.zipFacts(bytes) -> Promise<{ sha256, packageName, entries }>
//   g.toJSON()                               -> { about, evidence_levels, counts, nodes, edges } (schema shape)
//   Graph.rules(json)                        -> [rule item] over a toJSON() result (ux.aws.a design 08, Desk; design 07
//                                            "Worth a look"): { id, kind: "finding" | "question", evidence: "confirmed" |
//                                            "claimed", title, count, nodes: [id], edges?: [{ from, rel, to }] }. Read only:
//                                            an item never names a change, never pre-fills a plan (R-020).
//
// Ids: the ARN where AWS defines one, otherwise urn:sws:<kind>:<name>. An edge seen twice keeps the stronger
// evidence (api, template, content, naming, comment, curated). Edges may name nodes no adapter has added yet
// (a role named by a trail record, before an IAM adapter exists): toJSON adds those as dangling "unknown" nodes,
// as the builder does, unless an adapter has added them. Reads only; nothing is stored anywhere.
(function (root) {
  "use strict";
  var EVIDENCE = ["api", "template", "content", "naming", "comment", "curated"];
  var TRUST = { api: "verified", template: "verified", content: "claimed", naming: "claimed", comment: "claimed", curated: "curated" };
  var GROUP = 50; // a folder with more objects than this is one prefix node, as the builder does
  var GOOGLE = "urn:sws:idp:accounts.google.com";
  var TARGET_ALTITUDE = { object: "A1", bucket: "A2", stack: "A2", function: "A2", policy: "A2", trail: "A2", role: "A4" };

  function Graph(opts) {
    opts = opts || {};
    var nodes = new Map(), edges = new Map(), account = opts.account || null;
    // Trust of evidence (design 03, security R-020). backend is the page's mode ("twin" or "aws"), passed in by the
    // caller and never inferred. Every edge's trust follows its evidence: verified for api and template, claimed
    // for content, naming and comment, curated as is; a merged edge is verified if any source is. A node is
    // verified if an API answer or a verified edge names it; else curated only if every edge naming it is curated;
    // else claimed. Attributes keep their own trust: each node's attribute_trust maps an attribute to { trust,
    // source }, set by the adapter that wrote it, and a claimed fact never overwrites a verified one. Claimed
    // evidence may raise a question, never drive a suggestion to remove, replace or narrow anything.
    if (opts.backend !== "twin" && opts.backend !== "aws") throw new TypeError("Graph needs backend: \"twin\" or \"aws\", from the page's mode");
    var backend = opts.backend, verified = new Set(), ctxTrust = { trust: "claimed", source: "unknown" };
    function vouch(id) { verified.add(id); return id; }
    function setAttr(n, k, v) {
      if (v === undefined) return;
      n.attribute_trust = n.attribute_trust || {};
      var old = n.attribute_trust[k];
      if (old && old.trust === "verified" && ctxTrust.trust !== "verified") return;
      n[k] = v; n.attribute_trust[k] = { trust: ctxTrust.trust, source: ctxTrust.source };
    }
    // Run an adapter with the trust its own facts carry.
    function as(trust, src, fn) {
      return function () { var prev = ctxTrust; ctxTrust = { trust: trust, source: src }; try { return fn.apply(null, arguments); } finally { ctxTrust = prev; } };
    }
    var ids = {
      account: function () { return "urn:sws:account:" + account; },
      region: function (r) { return "urn:sws:region:" + r; },
      bucket: function (b) { return "arn:aws:s3:::" + b; },
      object: function (b, k) { return "arn:aws:s3:::" + b + "/" + k; },
      prefix: function (b, p) { return "arn:aws:s3:::" + b + "/" + p + "*"; },
      trail: function (n) { return "urn:sws:cloudtrail-trail:" + n; },
      actor: function (net) { return "urn:sws:actor-net:" + net; }
    };

    function node(id, type, altitude, label, extra) {
      var n = nodes.get(id) || { id: id, type: type, label: label, altitude: altitude };
      Object.keys(extra || {}).forEach(function (k) { setAttr(n, k, extra[k]); });
      nodes.set(id, n);
      return id;
    }
    // One edge per from, rel, to: the strongest evidence wins, and every source that gave it is kept (design 04).
    function edge(from, rel, to, evidence, source) {
      var k = from + "\u0000" + rel + "\u0000" + to, old = edges.get(k);
      if (!old) return edges.set(k, { from: from, rel: rel, to: to, evidence: evidence, source: source });
      var sources = old.source.split("; ");
      if (sources.indexOf(source) < 0) sources.push(source);
      if (EVIDENCE.indexOf(evidence) < EVIDENCE.indexOf(old.evidence)) { old.evidence = evidence; sources.unshift(sources.splice(sources.indexOf(source), 1)[0]); }
      old.source = sources.join("; ");
    }
    function accountNode() {
      if (account) vouch(node(ids.account(), "account", "A2", account)); // known from STS by the page
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
        var bid = vouch(node(ids.bucket(b.name), "bucket", "A2", b.name, { cfn_type: "AWS::S3::Bucket", browser_readable: !!b.cors }));
        if (b.region) edge(bid, "in", vouch(region(b.region, "api", "Cloud Control GetResource")), "api", "Cloud Control GetResource (RegionalDomainName)");
        // A CloudTrail bucket made by the console is named aws-cloudtrail-logs-<account>-<trail>: a naming inference.
        var tm = /^aws-cloudtrail-logs-\d{12}-(.+)$/.exec(b.name);
        if (tm) as("claimed", "a bucket's name", function () {
          node(ids.trail(tm[1]), "trail", "A2", tm[1], { cfn_type: "AWS::CloudTrail::Trail", inferred: true, note: "named by its bucket" });
          edge(ids.trail(tm[1]), "logs_to", bid, "naming", "bucket name aws-cloudtrail-logs-<account>-" + tm[1]);
        })();
        var byFolder = Object.create(null);
        (b.objects || []).forEach(function (o) {
          var f = o.key.indexOf("/") >= 0 ? o.key.slice(0, o.key.lastIndexOf("/") + 1) : "";
          (byFolder[f] = byFolder[f] || []).push(o);
        });
        Object.keys(byFolder).forEach(function (f) {
          var list = byFolder[f];
          if (f && list.length > GROUP) {
            vouch(node(ids.prefix(b.name, f), "prefix", "A1", f + " (" + list.length + " objects)", { objects: list.length, bytes: list.reduce(function (s, o) { return s + (o.size || 0); }, 0) }));
            edge(bid, "holds", ids.prefix(b.name, f), "api", "S3 ListObjectsV2");
          } else list.forEach(function (o) {
            vouch(node(ids.object(b.name, o.key), "object", "A1", o.key, { bytes: o.size, modified: o.modified }));
            edge(bid, "holds", ids.object(b.name, o.key), "api", "S3 ListObjectsV2");
          });
        });
      });
    }

    // Activity: one trail file's events. Each event is a node; the file records it; the file's key path names its
    // region; the event acted as a role, signed in via an identity provider, and acted on its targets. The caller's
    // network (from.net; never the address) becomes an actor node that acted on the same targets.
    function activity(read, file) {
      var fid = file && file.bucket && file.key ? ids.object(file.bucket, file.key) : null;
      if (fid) {
        var rr = /\/CloudTrail\/([a-z0-9-]+)\//.exec(file.key);
        if (rr) edge(fid, "in", region(rr[1], "content", "CloudTrail key path"), "content", "CloudTrail key path (AWSLogs/<account>/CloudTrail/<region>/)");
      }
      (read.events || []).forEach(function (e) {
        if (!e.node) return;
        node(e.node, "event", "A1", e.words, { ocsf_class: "API Activity", time: e.iso, src_net: e.from && e.from.net || undefined, read_only: !e.change });
        if (fid) edge(fid, "records", e.node, "content", "CloudTrail Records");
        if (e.who && e.who.kind === "role" && e.who.arn) {
          node(e.who.arn, "role", "A4", e.who.name || e.who.arn.split("/").pop(), { cfn_type: "AWS::IAM::Role" });
          edge(e.node, "acted_as", e.who.arn, "content", "CloudTrail userIdentity.sessionContext.sessionIssuer");
          var rn = nodes.get(e.who.arn);
          if (e.iso && (!rn.last_seen || e.iso > rn.last_seen)) setAttr(rn, "last_seen", e.iso); // claimed: a file says so
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
        var net = e.from && e.from.net;
        if (NET.test(String(net))) {
          var aid = node(ids.actor(net), "actor", "A4", net);
          targets.forEach(function (t) { edge(aid, "acted_on", t.id, "content", "CloudTrail sourceIPAddress (network " + net + ")"); });
        }
      });
    }
    // Content: what the files say, by what they hold rather than by their names (the builder's rules made general):
    //   - an s3://<bucket> reference in a config file (YAML, JSON, TOML, INI, .conf, .env) refers_to that bucket;
    //   - a JSON document with a "vaults" list names vaults (in a region, part of the site if it sits in the site's bucket);
    //   - a CloudFront log file (any object whose lines are JSON with c_ip, cs_uri_stem and sc_status) records the
    //     distribution each line's distribution_id names (content; design 06); a file whose lines carry no id falls back
    //     to a key <name>-YYYY-MM-DD-HH-MM-SS.gz (naming). It refers_to the vaults its paths name, and an address with at least 10
    //     requests, at least 80% of them refused (4xx), becomes an actor seen_in those files and targeting those vaults.
    //     Addresses are counted and named by their network only (/24, /48; design 03, Privacy).
    // Vault lists are read before logs, so log lines can name known vaults. Files nothing recognises are left alone.
    // A network as data.aws.a's LogExtract.network writes it: a.b.c.0/24 or an IPv6 /48 (design 03, Privacy).
    var NET = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24|[0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::\/48)$/;
    function networkOf(ip) {
      var X = root.LogExtract;
      if (!X || typeof X.network !== "function") throw new Error("Graph needs LogExtract.network (site/data/extract.js)");
      return X.network(ip) || "";
    }
    var LOG_KEY = /\/([a-z0-9-]+)-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.gz$/, DIST_ID = /^[A-Z0-9]{1,64}$/, CONFIG = /\.(ya?ml|json|toml|ini|conf|cfg|env)$/i;
    function content(files, o) {
      o = o || {};
      var siteId = null;
      if (o.site && o.site.name) {
        siteId = "urn:sws:site:" + o.site.name;
        var index = files.filter(function (f) { return f.bucket === o.site.bucket && f.key === "index.html"; })[0];
        var title = index && /<title>([^<]*)<\/title>/.exec(index.text);
        node(siteId, "site", "A3", o.site.label || o.site.name, title ? { title: title[1] } : {});
      }
      files.forEach(function (f) {
        if (!CONFIG.test(f.key)) return;
        var fid = ids.object(f.bucket, f.key), re = /\bs3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])/g, m, seen = Object.create(null);
        while ((m = re.exec(f.text))) if (!seen[m[1]]) {
          seen[m[1]] = 1;
          edge(fid, "refers_to", ids.bucket(m[1]), "content", f.key + " (s3://" + m[1] + "/...)");
        }
      });
      files.forEach(function (f) {
        if (!/\.json$/i.test(f.key)) return;
        var doc; try { doc = JSON.parse(f.text); } catch (e) { return; }
        if (!doc || !Array.isArray(doc.vaults)) return;
        var fid = ids.object(f.bucket, f.key);
        doc.vaults.forEach(function (v) {
          if (!v || typeof v.id !== "string" || !v.id) return;
          var vid = node("urn:sws:vault:" + v.id, "vault", "A5", v.id, typeof v.files === "number" ? { files: v.files } : {});
          edge(fid, "refers_to", vid, "content", f.key);
          if (typeof v.region === "string" && /^[a-z]{2}(-[a-z]+)+-\d$/.test(v.region)) edge(vid, "in", region(v.region, "content", f.key + " (region)"), "content", f.key + " (region)");
          if (siteId && f.bucket === o.site.bucket) edge(vid, "part_of", siteId, "content", f.key + " in the site's bucket");
        });
      });
      var byNet = Object.create(null);
      files.forEach(function (f) {
        if (typeof f.text !== "string" || f.text.charAt(0) !== "{" || CONFIG.test(f.key)) return;
        var lines = f.text.split("\n").map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
          .filter(function (l) { return l && typeof l === "object" && "c_ip" in l && "cs_uri_stem" in l && "sc_status" in l; });
        if (!lines.length) return;
        var fid = ids.object(f.bucket, f.key), dists = Object.create(null), any = false;
        lines.forEach(function (l) { if (typeof l.distribution_id === "string" && DIST_ID.test(l.distribution_id)) { dists[l.distribution_id] = 1; any = true; } });
        if (any) Object.keys(dists).sort().forEach(function (id) {
          var did = node("urn:sws:cloudfront-distribution:" + id, "distribution", "A2", id, { cfn_type: "AWS::CloudFront::Distribution", distribution_id: id, inferred: true, note: "named by its log records" });
          edge(fid, "records", did, "content", "log records (distribution_id " + id + ")");
          (recorded[fid] = recorded[fid] || []).push(did);
        });
        else {
          var m = LOG_KEY.exec(f.key);
          if (m) {
            var did = node("urn:sws:cloudfront-distribution:" + m[1], "distribution", "A2", m[1], { cfn_type: "AWS::CloudFront::Distribution", inferred: true, note: "named by its log files" });
            edge(fid, "records", did, "naming", "log object key names " + m[1]);
            (recorded[fid] = recorded[fid] || []).push(did);
          }
        }
        var vaults = Object.create(null);
        lines.forEach(function (l) {
          var v = /^\/vault\/([^/?]+)/.exec(String(l.cs_uri_stem));
          if (v && /^\/vault\/[^/]+\/files/.test(l.cs_uri_stem)) vaults[v[1]] = 1;
          // Counted per network, never per address (design 03, Privacy); a line whose address has no network is skipped.
          var net = networkOf(String(l.c_ip));
          if (!net) return;
          var a = byNet[net] = byNet[net] || { requests: 0, refused: 0, files: Object.create(null), vaults: Object.create(null), countries: Object.create(null), cities: Object.create(null) };
          a.requests++; if (+l.sc_status >= 400 && +l.sc_status < 500) a.refused++;
          a.files[f.key] = f.bucket; if (v) a.vaults[v[1]] = 1;
          // City and country only as an enricher wrote them into the line (x_edge_location is CloudFront's edge, not the visitor's).
          if (typeof l.country === "string" && /^[A-Za-z]{2}$/.test(l.country)) a.countries[l.country.toUpperCase()] = 1;
          if (typeof l.city === "string" && l.city && l.city.length <= 80) a.cities[l.city] = 1;
        });
        Object.keys(vaults).sort().forEach(function (v) {
          if (nodes.has("urn:sws:vault:" + v)) edge(fid, "refers_to", "urn:sws:vault:" + v, "content", "log lines (cs_uri_stem /vault/" + v + "/files)");
        });
      });
      Object.keys(byNet).sort().forEach(function (net) {
        var a = byNet[net];
        if (a.requests < 10 || a.refused / a.requests < 0.8 || !NET.test(net)) return;
        var countries = Object.keys(a.countries).sort(), cities = Object.keys(a.cities).sort();
        var aid = node(ids.actor(net), "actor", "A4", net + " (refused " + a.refused + " of " + a.requests + ")",
          { ocsf_class: "HTTP Activity", src_net: net, requests: a.requests, refused: a.refused, countries: countries.length ? countries : undefined,
            cities: cities.length ? cities : undefined, rule: "a network with at least 10 requests, at least 80% refused (4xx)" });
        Object.keys(a.files).sort().forEach(function (k) { edge(aid, "seen_in", ids.object(a.files[k], k), "content", "log lines (c_ip in " + net + ")"); });
        Object.keys(a.vaults).sort().forEach(function (v) {
          if (nodes.has("urn:sws:vault:" + v)) edge(aid, "targeted", "urn:sws:vault:" + v, "content", "log lines (c_ip in " + net + ", paths under /vault/" + v + ")");
        });
      });
    }

    function role(arn, source, from) {
      var m = /^arn:aws:iam::\d{12}:role\/(.+)$/.exec(arn || "");
      if (!m) return;
      vouch(node(arn, "role", "A4", m[1].split("/").pop(), { cfn_type: "AWS::IAM::Role" })); // named by an API answer (Lambda, Firehose)
      edge(from, "runs_as", arn, "api", source);
    }
    // Lambda: each function, its region, and the role it runs as.
    function lambda(functions) {
      functions.forEach(function (f) {
        if (!f || !f.arn) return;
        vouch(f.arn); node(f.arn, "function", "A2", f.name, { cfn_type: "AWS::Lambda::Function", runtime: f.runtime, handler: f.handler, memory: f.memory, timeout: f.timeout,
          code_bytes: f.codeSize, code_sha256: f.codeSha256, modified: f.modified, description: f.description });
        if (f.region) edge(f.arn, "in", vouch(region(f.region, "api", "Lambda ListFunctions (FunctionArn)")), "api", "Lambda ListFunctions (FunctionArn)");
        role(f.role, "Lambda ListFunctions (Role)", f.arn);
      });
    }
    // Firehose: each stream, its region, the bucket it writes to, its role and the function that transforms its
    // records. Which distribution logs through it is decided in toJSON, once every adapter has run.
    var streamDests = [];
    function firehose(streams) {
      streams.forEach(function (st) {
        if (!st || !st.arn) return;
        vouch(st.arn); node(st.arn, "stream", "A2", st.name, { cfn_type: "AWS::KinesisFirehose::DeliveryStream", status: st.status, stream_type: st.type });
        if (st.region) edge(st.arn, "in", vouch(region(st.region, "api", "Firehose DescribeDeliveryStream (ARN)")), "api", "Firehose DescribeDeliveryStream (ARN)");
        (st.destinations || []).forEach(function (d) {
          if (d.kind !== "s3" || !d.bucket) return;
          var n = nodes.get(st.arn); setAttr(n, "s3_prefix", d.prefix); setAttr(n, "compression", d.compression); setAttr(n, "buffer_seconds", d.bufferSeconds);
          edge(st.arn, "writes_to", ids.bucket(d.bucket), "api", "Firehose DescribeDeliveryStream (BucketARN)");
          role(d.roleArn, "Firehose DescribeDeliveryStream (RoleARN)", st.arn);
          (d.processors || []).forEach(function (p) {
            var m = /^(arn:aws:lambda:[a-z0-9-]+:\d{12}:function:[^:]+)(:.+)?$/.exec(p.lambdaArn || "");
            if (m) edge(st.arn, "transforms_with", m[1], "api", "Firehose DescribeDeliveryStream (ProcessingConfiguration)");
          });
          streamDests.push({ stream: st.arn, bucket: d.bucket, prefix: d.prefix || "" });
        });
      });
    }
    // IAM (design 04): each role is in the account; its trust policy's federated principals are identity providers
    // it trusts; a GitHub OIDC trust's sub conditions name the repositories and environments it allows; its attached
    // managed policies are policies it has. Service and account principals make no edge (the builder makes none).
    var GH = "token.actions.githubusercontent.com";
    // CloudFormation: each stack, its region, and what it made (made_by, from ListStackResources). A resource's id is
    // its ARN from CfnApi; a derived one (arnDerived, design 03 refinement 1) gives way, at toJSON, to the node the
    // owning service described with the same type and name (a role with a path); urn:sws:cfn-resource ids are always
    // rebuilt from the stack's ARN, so a stack read by name or by ARN gives the same graph. A resource no adapter
    // describes becomes a node of its own here, typed from its CloudFormation type where the schema has one.
    // A stack that imports another's export refers_to it (ListImports).
    var CFN_TYPE = { "AWS::S3::Bucket": ["bucket", "A2"], "AWS::IAM::Role": ["role", "A4"], "AWS::Lambda::Function": ["function", "A2"],
      "AWS::CloudFront::Distribution": ["distribution", "A2"], "AWS::Route53::RecordSet": ["record", "A2"], "AWS::KinesisFirehose::DeliveryStream": ["stream", "A2"],
      "AWS::CloudFormation::Stack": ["stack", "A2"] };
    var cfnMade = [];
    function cfn(o) {
      o = o || {};
      var byName = Object.create(null), exportsBy = Object.create(null);
      (Array.isArray(o.stacks) ? o.stacks : []).forEach(function (st) {
        if (!st || typeof st.arn !== "string" || typeof st.name !== "string") return;
        vouch(node(st.arn, "stack", "A2", st.name, { cfn_type: "AWS::CloudFormation::Stack", status: st.status || undefined, updated: st.updated || undefined }));
        if (st.region) edge(st.arn, "in", vouch(region(st.region, "api", "CloudFormation ListStacks (StackId)")), "api", "CloudFormation ListStacks (StackId)");
        byName[st.region + "\u0000" + st.name] = st.arn;
        (Array.isArray(st.resources) ? st.resources : []).forEach(function (r) {
          if (!r || typeof r.logicalId !== "string" || typeof r.arn !== "string") return;
          var id = r.arn.indexOf("urn:sws:cfn-resource:") === 0 ? "urn:sws:cfn-resource:" + st.arn + "/" + r.logicalId : r.arn;
          cfnMade.push({ id: id, derived: !!r.arnDerived, type: r.type, physicalId: r.physicalId, logicalId: r.logicalId, status: r.status, stack: st.arn });
        });
      });
      (Array.isArray(o.exports) ? o.exports : []).forEach(function (x) { if (x && x.name && x.stackArn) exportsBy[x.name] = x.stackArn; });
      (Array.isArray(o.stacks) ? o.stacks : []).forEach(function (st) {
        if (!st || !Array.isArray(st.importers)) return;
        st.importers.forEach(function (imp) {
          var by = byName[st.region + "\u0000" + (imp && imp.stack)], ex = imp && imp.export;
          if (by && ex && exportsBy[ex] === st.arn) edge(by, "refers_to", st.arn, "api", "CloudFormation ListImports (" + ex + ")");
        });
      });
    }
    function cfnResolve() {
      cfnMade.splice(0).forEach(function (m) {
        var id = m.id;
        if (m.derived && !nodes.has(id)) {
          var same = []; nodes.forEach(function (n) { if (n.cfn_type === m.type && n.label === m.physicalId) same.push(n.id); });
          if (same.length === 1) id = same[0];
        }
        if (!nodes.has(id)) {
          var t = Object.prototype.hasOwnProperty.call(CFN_TYPE, m.type) ? CFN_TYPE[m.type] : ["unknown", "A2"];
          var prev = ctxTrust; ctxTrust = { trust: "verified", source: "CloudFormation ListStackResources" };
          try { node(id, t[0], t[1], m.physicalId || m.logicalId, { cfn_type: m.type, physical_id: m.physicalId || undefined, logical_id: m.logicalId, arn_derived: m.derived || undefined, status: m.status || undefined }); }
          finally { ctxTrust = prev; }
          // CloudFormation vouches that the resource exists, not for the ARN built from its physical id (architect.aws.a).
          if (m.derived) nodes.get(id).attribute_trust.id = { trust: "claimed", source: "ARN derived from the physical id (design 03, refinement 1)" };
        }
        edge(id, "made_by", m.stack, "api", "CloudFormation ListStackResources");
      });
    }

    // CloudFront (architect.aws.a design 06, section 3): a node per distribution (its ARN, type distribution, label its
    // domain); serves_from each origin's target (api), an origin with no target making no edge (its domain stays an
    // attribute, never a guess); invokes each associated CloudFront Function (event and path pattern in the source,
    // until the schema gives edges attributes); logs_to the legacy logging bucket (api). CfnApi's derived ARN is the same
    // id, so the stack's resource and this answer are one node; a naming node urn:sws:cloudfront-distribution:<id> folds
    // into the ARN node at toJSON (distMerge) when <id> is a distribution's id.
    function cloudfront(o) {
      o = o || {};
      var fnByArn = Object.create(null);
      (Array.isArray(o.functions) ? o.functions : []).forEach(function (f) {
        if (!f || typeof f.arn !== "string") return;
        fnByArn[f.arn] = f;
        vouch(node(f.arn, "function", "A2", f.name || f.arn, { cfn_type: "AWS::CloudFront::Function", runtime: f.runtime || undefined, stage: f.stage || undefined }));
      });
      (Array.isArray(o.distributions) ? o.distributions : []).forEach(function (d) {
        if (!d || typeof d.arn !== "string" || !/^arn:aws[a-z-]*:cloudfront::\d{12}:distribution\/[A-Z0-9]+$/.test(d.arn)) return;
        vouch(node(d.arn, "distribution", "A2", d.domain || d.id, { cfn_type: "AWS::CloudFront::Distribution", distribution_id: d.id || undefined,
          aliases: Array.isArray(d.aliases) && d.aliases.length ? d.aliases.slice() : undefined, status: d.status || undefined, enabled: typeof d.enabled === "boolean" ? d.enabled : undefined,
          origin_domains: Array.isArray(d.origins) && d.origins.length ? d.origins.map(function (x) { return x && x.domain; }).filter(Boolean) : undefined }));
        if (d.id) distIds[d.id] = d.arn;
        (Array.isArray(d.origins) ? d.origins : []).forEach(function (x) {
          if (x && typeof x.target === "string" && /^arn:aws[a-z-]*:s3:::[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(x.target))
            edge(d.arn, "serves_from", x.target, "api", "CloudFront GetDistribution (origin " + x.id + ")");
        });
        (Array.isArray(d.functions) ? d.functions : []).forEach(function (f) {
          if (!f || typeof f.arn !== "string" || !/^arn:aws[a-z-]*:cloudfront::\d{12}:function\/[A-Za-z0-9_-]+$/.test(f.arn)) return;
          if (!fnByArn[f.arn]) vouch(node(f.arn, "function", "A2", f.arn.split("/").pop(), { cfn_type: "AWS::CloudFront::Function" }));
          edge(d.arn, "invokes", f.arn, "api", "CloudFront GetDistribution (" + f.event + " on " + f.behaviour + ")");
        });
        var lb = d.logging && d.logging.bucket ? root.CloudFrontApi && root.CloudFrontApi.originKind ? root.CloudFrontApi.originKind(d.logging.bucket, (/^arn:(aws[a-z-]*):/.exec(d.arn) || [])[1]) : null : null;
        if (lb && lb.target) edge(d.arn, "logs_to", lb.target, "api", "CloudFront GetDistribution (Logging)");
      });
    }
    var distIds = Object.create(null);
    // A naming node urn:sws:cloudfront-distribution:<id> is the distribution with that id: its edges move to the ARN node
    // with their own evidence and sources, and attributes the ARN node lacks are copied (ontology.aws.a, design 06).
    function distMerge() {
      // Log file names are matched in lower case (the content adapter's LOG_KEY), ids are upper case: compare both.
      Object.keys(distIds).forEach(function (id) {
        var arn = distIds[id], urn = "urn:sws:cloudfront-distribution:" + id;
        if (!nodes.has(urn)) urn = "urn:sws:cloudfront-distribution:" + id.toLowerCase();
        var u = nodes.get(urn), a = nodes.get(arn);
        if (!u || !a) return;
        Object.keys(u).forEach(function (k) {
          if (["id", "type", "label", "altitude", "attribute_trust", "inferred", "note"].indexOf(k) >= 0 || a[k] !== undefined) return;
          a[k] = u[k];
          if (u.attribute_trust && u.attribute_trust[k]) { a.attribute_trust = a.attribute_trust || {}; a.attribute_trust[k] = u.attribute_trust[k]; }
        });
        var moved = [];
        edges.forEach(function (e, k) { if (e.from === urn || e.to === urn) { moved.push(e); edges.delete(k); } });
        moved.forEach(function (e) {
          e.source.split("; ").forEach(function (src) { edge(e.from === urn ? arn : e.from, e.rel, e.to === urn ? arn : e.to, e.evidence, src); });
        });
        if (verified.has(urn)) verified.add(arn);
        verified.delete(urn); nodes.delete(urn);
      });
    }

    function iam(o) {
      o = o || {};
      (Array.isArray(o.providers) ? o.providers : []).forEach(function (p) { if (p && typeof p.arn === "string") vouch(node(p.arn, "identity_provider", "A4", p.url || p.arn, { cfn_type: "AWS::IAM::OIDCProvider" })); });
      (Array.isArray(o.roles) ? o.roles : []).forEach(function (r) {
        if (!r || typeof r.arn !== "string") return;
        vouch(r.arn); node(r.arn, "role", "A4", r.name, { cfn_type: "AWS::IAM::Role", last_used: r.lastUsed ? r.lastUsed.when : undefined,
          boundary: r.boundary ? r.boundary.arn : undefined, service_linked: r.serviceLinked || undefined });
        var a = accountNode();
        if (a) edge(r.arn, "in", a, "api", "IAM GetRole");
        var sts = r.trust && Array.isArray(r.trust.statements) ? r.trust.statements : [];
        sts.forEach(function (st) {
          if (!st || st.effect !== "Allow" || !Array.isArray(st.principals)) return;
          st.principals.filter(function (p) { return p && p.kind === "federated" && typeof p.id === "string"; }).forEach(function (p) {
            var idp, host = (/:oidc-provider\/(.+)$/.exec(p.id) || [])[1];
            if (p.id === "accounts.google.com") idp = vouch(node(GOOGLE, "identity_provider", "A4", "accounts.google.com", { note: "web identity federation; no IAM resource" }));
            else if (host) idp = vouch(node(p.id, "identity_provider", "A4", host, { cfn_type: "AWS::IAM::OIDCProvider" }));
            else if (/^arn:aws:iam::\d{12}:saml-provider\//.test(p.id)) idp = vouch(node(p.id, "identity_provider", "A4", p.id.split("/").pop(), { cfn_type: "AWS::IAM::SAMLProvider" }));
            else return;
            edge(r.arn, "trusts", idp, "api", "IAM GetRole (trust policy Principal Federated " + (host || p.id) + ")");
            if (host !== GH) return;
            (Array.isArray(st.conditions) ? st.conditions : []).filter(function (c) { return c && Array.isArray(c.values) && c.key === GH + ":sub" && typeof c.op === "string" && /^String(Equals|Like)$/.test(c.op.replace(/^For(Any|All)Value:/, "")); }).forEach(function (c) {
              c.values.forEach(function (sub) {
                var m = /^repo:([^@/]+)(?:@\d+)?\/([^@:]+)(?:@\d+)?:(.+)$/.exec(String(sub));
                if (!m) return;
                var pid = vouch(node("urn:sws:github-subject:" + m[1] + "/" + m[2] + ":" + m[3], "external_principal", "A4", m[2] + " (" + m[3].replace(":", " ") + ")", { subject: sub }));
                edge(r.arn, "allows_subject", pid, "api", "IAM GetRole (trust policy condition " + GH + ":sub)");
              });
            });
          });
        });
        (Array.isArray(r.attached) ? r.attached : []).forEach(function (p) {
          if (!p || typeof p.arn !== "string") return;
          vouch(p.arn);
          var aws = /^arn:aws:iam::aws:policy\//.test(p.arn);
          node(p.arn, "policy", "A2", p.name || p.arn.split("/").pop(), aws ? { cfn_type: "AWS::IAM::ManagedPolicy", aws_managed: true } : { cfn_type: "AWS::IAM::ManagedPolicy" });
          edge(r.arn, "has_policy", p.arn, "api", "IAM ListAttachedRolePolicies");
        });
      });
    }

    // Deployment packages: a zip whose SHA-256 is a function's CodeSha256 packages that function (Lambda's own
    // identity for a package: evidence api); failing that, a zip whose dist-info METADATA names a function by name
    // (naming). Decided in toJSON, so zips and functions can be added in either order.
    var zips = [];
    function addZips(list) {
      list.forEach(function (z) {
        if (!z || !z.bucket || !z.key) return;
        var oid = ids.object(z.bucket, z.key);
        if (nodes.has(oid) && typeof z.entries === "number") setAttr(nodes.get(oid), "entries", z.entries);
        zips.push(z);
      });
    }
    function packagesFunctions() {
      var bySha256 = new Map(), byLabel = new Map();
      nodes.forEach(function (n) {
        if (n.type !== "function") return;
        if (n.code_sha256 && !bySha256.has(n.code_sha256)) bySha256.set(n.code_sha256, n);
        if (!byLabel.has(n.label)) byLabel.set(n.label, n);
      });
      zips.forEach(function (z) {
        var oid = ids.object(z.bucket, z.key);
        var bySha = z.sha256 && bySha256.get(z.sha256);
        if (bySha) return edge(oid, "packages", bySha.id, "api", "Lambda CodeSha256 equals the zip's SHA-256");
        var byName = z.packageName && byLabel.get(z.packageName);
        if (byName) edge(oid, "packages", byName.id, "naming", "zip name and dist-info METADATA (Name: " + z.packageName + "); CodeSha256 differs");
      });
    }

    // A distribution whose log files sit under a stream's prefix in that stream's bucket logs through that stream:
    // content when its records name it, naming when only the files' names do (the evidence of the records edge).
    var recorded = Object.create(null);
    function logsThroughStreams() {
      var fids = Object.keys(recorded);
      if (!fids.length) return;
      streamDests.forEach(function (sd) {
        var under = ids.bucket(sd.bucket) + "/" + sd.prefix, seen = Object.create(null);
        fids.forEach(function (fid) {
          if (fid.indexOf(under) !== 0) return;
          recorded[fid].forEach(function (did) {
            var r = edges.get(fid + "\u0000records\u0000" + did), ev = r ? r.evidence : "naming", k = did + "|" + ev;
            if (seen[k]) return; seen[k] = 1;
            var label = nodes.get(did).label;
            edge(did, "logs_to", sd.stream, ev, (ev === "content" ? "log records naming " : "log files named after ") + label + " sit under the stream's prefix " + (sd.prefix || "(none)"));
          });
        });
      });
    }

    // An object names its bucket already: a bucket target with an object target in it is not a second edge.
    function actedOn(targets) {
      var withObjects = new Set();
      targets.forEach(function (o) { if (o && o.type === "object" && typeof o.id === "string") withObjects.add(o.id.slice(0, o.id.indexOf("/", "arn:aws:s3:::".length))); });
      return targets.filter(function (t) { return t && typeof t.id === "string" && !(t.type === "bucket" && withObjects.has(t.id)); });
    }

    function nodeTrust(id) { return nodeTrustMap ? nodeTrustMap.get(id) || "claimed" : "claimed"; }
    var nodeTrustMap = null;
    function toJSON() {
      cfnResolve();
      logsThroughStreams();
      packagesFunctions();
      distMerge();
      // Node trust from the edges that name it (design 03): verified wins, then claimed, curated only if nothing else.
      var named = new Map();
      edges.forEach(function (e) {
        var t = TRUST[e.evidence];
        [e.from, e.to].forEach(function (id) { var m = named.get(id) || {}; m[t] = true; named.set(id, m); });
      });
      nodeTrustMap = new Map();
      named.forEach(function (m, id) { nodeTrustMap.set(id, m.verified ? "verified" : m.claimed ? "claimed" : "curated"); });
      verified.forEach(function (id) { nodeTrustMap.set(id, "verified"); });
      var nodeList = Array.from(nodes.values()).map(function (n) {
        var o = Object.assign({}, n);
        if (n.attribute_trust) o.attribute_trust = JSON.parse(JSON.stringify(n.attribute_trust));
        o.trust = nodeTrust(n.id); o.backend = backend;
        return o;
      });
      var edgeList = Array.from(edges.values()).map(function (e) { return { from: e.from, rel: e.rel, to: e.to, evidence: e.evidence, trust: TRUST[e.evidence], source: e.source }; });
      var have = new Set(nodeList.map(function (n) { return n.id; }));
      edgeList.forEach(function (e) {
        [e.from, e.to].forEach(function (end) {
          if (!have.has(end)) { have.add(end); nodeList.push({ id: end, type: "unknown", label: end, altitude: "A2", dangling: true, note: "named by an edge; no adapter has described it yet", trust: nodeTrust(end), backend: backend }); }
        });
      });
      nodeList.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      edgeList.sort(function (a, b) { var x = a.from + a.rel + a.to, y = b.from + b.rel + b.to; return x < y ? -1 : x > y ? 1 : 0; });
      var by = {};
      edgeList.forEach(function (e) { by[e.evidence] = (by[e.evidence] || 0) + 1; });
      return { about: "Resource graph built in the page from the service APIs and the activity reader (site/api/graph.js).", backend: backend,
        evidence_levels: EVIDENCE.slice(), counts: { nodes: nodeList.length, edges: edgeList.length, by_evidence: by }, nodes: nodeList, edges: edgeList };
    }

    return { add: {
        s3: as("verified", "S3 ListObjectsV2 and Cloud Control GetResource", s3),
        lambda: as("verified", "Lambda ListFunctions", lambda),
        firehose: as("verified", "Firehose DescribeDeliveryStream", firehose),
        iam: as("verified", "IAM ListRoles, GetRole and ListAttachedRolePolicies", iam),
        cfn: as("verified", "CloudFormation ListStacks, DescribeStacks and ListStackResources", cfn),
        cloudfront: as("verified", "CloudFront ListDistributions, GetDistribution and ListFunctions", cloudfront),
        activity: as("claimed", "CloudTrail log files in a bucket", activity),
        content: as("claimed", "files in a bucket", content),
        zips: as("claimed", "zip files in a bucket", addZips)
      }, toJSON: toJSON, ids: ids };
  }

  // Rules for Desk and the Map's "Worth a look" (ux.aws.a designs 07 and 08), as data over a toJSON() result. A rule
  // whose evidence AWS answered is a finding; one resting only on a file or a name is a question (R-020: a question may
  // only ask, never suggest removing, replacing or narrowing). Items with nothing to cover are left out.
  //   unowned             A2 resources AWS answered for (buckets, functions, distributions, streams) that no stack made
  //                       (no made_by edge). Only when the graph holds CloudFormation stacks: without them nothing is
  //                       known about who made what, and no item is given. Objects and records are left out (design 07).
  //   by-name-only        links whose strongest evidence is a name (naming): a question.
  //   dangling-confirmed  names an API answer gives (a function's role, a stream's bucket) that no adapter described.
  //   dangling-claimed    names only files or names give that no adapter described: a question.
  var OWNABLE = { bucket: true, function: true, distribution: true, stream: true };
  Graph.rules = function (json) {
    var nodes = (json && Array.isArray(json.nodes)) ? json.nodes : [], edges = (json && Array.isArray(json.edges)) ? json.edges : [];
    var made = Object.create(null), hasStack = false;
    nodes.forEach(function (n) { if (n && n.type === "stack") hasStack = true; });
    edges.forEach(function (e) { if (e && e.rel === "made_by") made[e.from] = true; });
    var sortIds = function (a) { return a.slice().sort(); };
    var out = [];
    function item(id, kind, title, ids, extra) {
      if (!ids.length) return;
      var it = { id: id, kind: kind, evidence: kind === "finding" ? "confirmed" : "claimed", title: title, count: ids.length, nodes: sortIds(ids) };
      Object.keys(extra || {}).forEach(function (k) { it[k] = extra[k]; });
      out.push(it);
    }
    if (hasStack) item("unowned", "finding", "Resources no stack made", nodes.filter(function (n) {
      return n && OWNABLE[n.type] === true && n.altitude === "A2" && !n.dangling && n.trust === "verified" && !made[n.id];
    }).map(function (n) { return n.id; }));
    var named = edges.filter(function (e) { return e && e.evidence === "naming"; });
    var ends = Object.create(null);
    named.forEach(function (e) { ends[e.from] = true; ends[e.to] = true; });
    item("by-name-only", "question", "Links by name only", Object.keys(ends), { count: named.length, edges: named.map(function (e) { return { from: e.from, rel: e.rel, to: e.to }; })
      .sort(function (a, b) { var x = a.from + a.rel + a.to, y = b.from + b.rel + b.to; return x < y ? -1 : x > y ? 1 : 0; }) });
    var dangling = nodes.filter(function (n) { return n && n.dangling; });
    item("dangling-confirmed", "finding", "Named by AWS, not found", dangling.filter(function (n) { return n.trust === "verified"; }).map(function (n) { return n.id; }));
    item("dangling-claimed", "question", "Named by a file or a name, not found", dangling.filter(function (n) { return n.trust !== "verified"; }).map(function (n) { return n.id; }));
    var order = { finding: 0, question: 1 };
    return out.sort(function (a, b) { return order[a.kind] - order[b.kind] || (a.id < b.id ? -1 : 1); });
  };

  // A zip's facts for add.zips: its SHA-256 (base64, as Lambda's CodeSha256), the package name its
  // *.dist-info/METADATA gives, and how many entries it has. Reads the bytes in memory with zip.js (site/zip.js).
  Graph.zipFacts = function (bytes) {
    var Z = root.Zip, u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!Z) return Promise.reject(new Error("Graph.zipFacts needs Zip (site/zip.js)"));
    var range = function (a, b) { return Promise.resolve(u8.slice(a, b + 1).buffer); };
    var sha = root.crypto.subtle.digest("SHA-256", u8).then(function (h) {
      var v = new Uint8Array(h), s = ""; for (var i = 0; i < v.length; i++) s += String.fromCharCode(v[i]); return root.btoa(s);
    });
    var meta = Z.list(range, u8.length).then(function (entries) {
      var m = entries.filter(function (e) { return /\.dist-info\/METADATA$/.test(e.name) && !e.dir; })[0];
      if (!m || m.size > 1048576) return { entries: entries.length, packageName: null };
      return Z.read(range, m).then(function (b) {
        var n = /^Name:\s*(.+)$/m.exec(new TextDecoder().decode(new Uint8Array(b)));
        return { entries: entries.length, packageName: n ? n[1].trim() : null };
      });
    });
    return Promise.all([sha, meta]).then(function (r) { return { sha256: r[0], packageName: r[1].packageName, entries: r[1].entries }; });
  };

  // An edge an AWS API answered for (evidence api or template). content and naming edges come from what files say or
  // from names, which bucket contents can plant (security R-020): show them as claims, never as proof.
  Graph.verified = function (e) { return !!e && (e.trust ? e.trust === "verified" : TRUST[e.evidence] === "verified"); };
  root.Graph = Graph;
})(typeof window !== "undefined" ? window : globalThis);
