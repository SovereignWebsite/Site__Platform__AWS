// Activity (site/api/activity.js): cloudtrail.aws.a's reader tests (docs/cloudtrail/reader/ct-reader.test.mjs,
// work/cloudtrail.aws.a ee4a1f7) run against the moved code, then fromBytes over the twin's own trail files,
// fetched through the real transport, SigV4 and S3Api, and unpacked by Decode. Node 22, no network.
// Run: node test/api/activity.test.mjs
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import vm from "node:vm";

const store = {};
const ctx = {
  TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, Response, Headers, URL, URLSearchParams,
  CompressionStream, DecompressionStream, Promise, Error, TypeError, JSON, Date, Math, Number, String, RegExp, Object, Array,
  setTimeout, crypto: globalThis.crypto, console, btoa,
  location: { search: "?twin", origin: "https://example.test" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => { throw new Error("a request left the page"); }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["sigv4.js", "twin.js", "transport.js", "api/s3-api.js", "data/extract.js", "api/decode.js", "api/activity.js"])
  vm.runInContext(readFileSync(new URL("../../site/" + f, import.meta.url), "utf8"), ctx, { filename: f });
const R = ctx.Activity, A = "111122223333";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b)); };
let checks = 0; const _eq = eq; const eqc = (a, b, m) => { _eq(a, b, m); checks++; };

// ---- cloudtrail.aws.a's reader tests, as written ----
const base = (o) => Object.assign({ eventVersion: "1.09", eventTime: "2026-11-22T10:00:00Z", eventSource: "iam.amazonaws.com", awsRegion: "us-east-1", sourceIPAddress: "198.51.100.4", userAgent: "test", recipientAccountId: A, readOnly: false, eventCategory: "Management" }, o);
const assumed = (role) => ({ type: "AssumedRole", arn: "arn:aws:sts::" + A + ":assumed-role/" + role + "/s", sessionContext: { sessionIssuer: { type: "Role", arn: "arn:aws:iam::" + A + ":role/" + role, userName: role }, webIdFederationData: { federatedProvider: "accounts.google.com" } } });

// who, one per row of the table
const who = (u) => R.normalise(base({ eventID: "x", eventName: "GetRole", userIdentity: u })).who;
eqc(who(assumed("sws-aws-platform-change")), { kind: "role", name: "sws-aws-platform-change", arn: "arn:aws:iam::" + A + ":role/sws-aws-platform-change", via: "accounts.google.com" }, "AssumedRole");
eqc(who({ type: "IAMUser", userName: "ci", arn: "arn:aws:iam::" + A + ":user/ci" }), { kind: "user", name: "ci", arn: "arn:aws:iam::" + A + ":user/ci", via: null }, "IAMUser");
eqc(who({ type: "Root", arn: "arn:aws:iam::" + A + ":root" }).kind, "root", "Root");
eqc(who({ type: "WebIdentityUser", userName: "u", identityProvider: "accounts.google.com" }), { kind: "web", name: "u", arn: null, via: "accounts.google.com" }, "WebIdentityUser");
eqc(who({ type: "AWSService", invokedBy: "firehose.amazonaws.com" }), { kind: "service", name: "firehose.amazonaws.com", arn: null, via: "firehose.amazonaws.com" }, "AWSService");
eqc(who({ type: "SAMLUser" }).kind, "unknown", "other type");
eqc(who(undefined).kind, "unknown", "no userIdentity");

// targets and words
const one = (o) => R.normalise(base(Object.assign({ eventID: "t", userIdentity: assumed("sws-aws-platform-change") }, o)));
let e = one({ eventName: "UpdateAssumeRolePolicy", requestParameters: { roleName: "sovereignwebsite-factory-dns", policyDocument: "{}" } });
eqc(e.targets, [{ type: "role", id: "arn:aws:iam::" + A + ":role/sovereignwebsite-factory-dns", name: "sovereignwebsite-factory-dns" }], "trust change target");
eqc(e.words, "the change role rewrote who may assume the role sovereignwebsite-factory-dns", "trust change words");
e = one({ eventSource: "s3.amazonaws.com", awsRegion: "eu-west-2", eventName: "GetObject", readOnly: true, eventCategory: "Data", userIdentity: assumed("sws-aws-platform-read"), requestParameters: { bucketName: "b1", key: "data/x.json" } });
eqc(e.targets.map((t) => t.type + " " + t.id), ["bucket arn:aws:s3:::b1", "object arn:aws:s3:::b1/data/x.json"], "GetObject targets");
eqc([e.change, e.category, e.words], [false, "Data", "the read role read data/x.json in b1"], "GetObject");
e = one({ eventSource: "sts.amazonaws.com", eventName: "AssumeRoleWithWebIdentity", userIdentity: { type: "WebIdentityUser", userName: "u", identityProvider: "accounts.google.com" }, requestParameters: { roleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read" } });
eqc(e.words, "u signed in to the read role with Google", "sign-in words");
e = one({ eventSource: "sts.amazonaws.com", eventName: "AssumeRoleWithWebIdentity", userIdentity: { type: "WebIdentityUser", userName: "u", identityProvider: "accounts.google.com" }, requestParameters: { roleArn: "arn:aws:iam::" + A + ":role/other" }, errorCode: "AccessDenied", errorMessage: "no" });
eqc([e.failed, e.words], [{ code: "AccessDenied", message: "no" }, "u signed in to the role other with Google (refused: AccessDenied)"], "refused sign-in");
e = one({ eventSource: "cloudformation.amazonaws.com", awsRegion: "eu-west-2", eventName: "ExecuteChangeSet", requestParameters: { stackName: "sws-aws-platform", changeSetName: "c" } });
eqc([e.targets[0].type, e.targets[0].id, e.words], ["stack", "arn:aws:cloudformation:eu-west-2:" + A + ":stack/sws-aws-platform", "the change role applied a change to the stack sws-aws-platform"], "change set (graph stack id)");
eqc(e.node, "urn:sws:cloudtrail-event:t", "event node id");
if ("raw" in R.forGraph(e) || !R.forGraph(e).targets) fail("forGraph keeps raw or loses targets");
e = one({ eventSource: "cloudcontrolapi.amazonaws.com", awsRegion: "eu-west-2", eventName: "UpdateResource", requestParameters: { typeName: "AWS::S3::Bucket", identifier: "b2", patchDocument: "[]" } });
eqc([e.targets[0].id, e.words], ["arn:aws:s3:::b2", "the change role changed the settings of the bucket b2"], "cloud control");
e = one({ eventSource: "cloudtrail.amazonaws.com", eventName: "StopLogging", requestParameters: { name: "demo" } });
eqc([e.targets[0].id, e.words], ["urn:sws:cloudtrail-trail:demo", "the change role stopped the trail demo"], "stop logging");
e = one({ eventSource: "ec2.amazonaws.com", eventName: "DescribeInstances", requestParameters: null });
eqc([e.targets, e.words], [[], "the change role called DescribeInstances on ec2"], "unknown action");
const noRO = base({ eventID: "r", eventName: "GetRole", userIdentity: assumed("sws-aws-platform-read") }); delete noRO.readOnly;
eqc(R.normalise(noRO).change, true, "missing readOnly counts as a change");

// inputs: duplicates, order, formats, junk
const r1 = base({ eventID: "1", eventTime: "2026-11-22T10:00:01Z", eventName: "GetRole", userIdentity: assumed("sws-aws-platform-read") });
const r2 = base({ eventID: "2", eventTime: "2026-11-22T10:00:02Z", eventName: "GetRole", userIdentity: assumed("sws-aws-platform-read") });
let rd = R.read({ Records: [r1, r2, r1, { not: "a record" }] });
eqc([rd.format, rd.events.map((x) => x.id), rd.skipped], ["records", ["2", "1"], 2], "Records: newest first, duplicate and junk skipped");
rd = R.read({ Events: [{ CloudTrailEvent: JSON.stringify(r1) }, { CloudTrailEvent: JSON.stringify(r2) }] });
eqc([rd.format, rd.events.length], ["lookup-events", 2], "LookupEvents wrapper");
rd = R.read(JSON.stringify(r1) + "\n" + JSON.stringify(r2) + "\n");
eqc([rd.format, rd.events.length], ["lines", 2], "one record per line");
eqc(R.read({ hello: 1 }).format, null, "unknown shape");
eqc(R.merge([R.read({ Records: [r1] }), R.read({ Records: [r1, r2] })]).events.map((x) => x.id), ["2", "1"], "merge drops duplicates across files");


// ---- additions in the move ----
// Privacy (design 03): the caller's network, never the address; the record as AWS wrote it stays in raw only.
e = one({ sourceIPAddress: "203.0.113.66", eventName: "GetRole" });
eqc([e.from.net, "ip" in e.from, e.raw.sourceIPAddress, "raw" in R.forGraph(e)], ["203.0.113.0/24", false, "203.0.113.66", false], "from.net only; raw kept for the detail panel, not for the graph");
eqc(one({ sourceIPAddress: "2001:db8:1234:5678::1", eventName: "GetRole" }).from.net, "2001:db8:1234::/48", "IPv6 /48");
eqc([one({ sourceIPAddress: "lambda.amazonaws.com", eventName: "GetRole" }).from.net, one({ sourceIPAddress: "lambda.amazonaws.com", eventName: "GetRole" }).from.via], [null, "lambda.amazonaws.com"], "a service caller has no network, its name in via");

// A bad line in the one-record-per-line form is skipped and counted, not thrown.
rd = R.read(JSON.stringify(r1) + "\nnot json\n" + JSON.stringify(r2) + "\n");
eqc([rd.format, rd.events.length, rd.skipped], ["lines", 2, 1], "bad line skipped");

// fromBytes: .json.gz, plain JSON, JSON Lines, a cap that cuts a gzip file.
const enc = (s) => new TextEncoder().encode(s), gz = (s) => new Uint8Array(gzipSync(s));
rd = await R.fromBytes(gz(JSON.stringify({ Records: [r1, r2] })), { name: "x.json.gz" });
eqc([rd.format, rd.events.map((x) => x.id), rd.truncated], ["records", ["2", "1"], false], "fromBytes .json.gz");
rd = await R.fromBytes(enc(JSON.stringify({ Records: [r1] })), { name: "x.json" });
eqc([rd.format, rd.events.length], ["records", 1], "fromBytes .json");
rd = await R.fromBytes(enc(JSON.stringify(r1) + "\n" + JSON.stringify(r2) + "\n"), { name: "x.jsonl" });
eqc([rd.format, rd.events.length], ["lines", 2], "fromBytes JSON Lines");
const many = Array.from({ length: 200 }, (_, i) => JSON.stringify(Object.assign({}, r1, { eventID: "m" + i }))).join("\n") + "\n";
rd = await R.fromBytes(gz(many), { name: "big.jsonl.gz", maxBytes: 20000 });
if (!(rd.truncated && rd.events.length > 0 && rd.events.length < 200 && rd.skipped === 0)) fail("cut gzip: " + JSON.stringify({ t: rd.truncated, n: rd.events.length, s: rd.skipped }));
checks++;

// The twin's own trail: list and fetch through S3Api as the page does, read with fromBytes.
const assume = async (role) => {
  const r = await ctx.AwsTransport.fetch("https://sts.amazonaws.com/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", RoleArn: "arn:aws:iam::" + A + ":role/" + role, RoleSessionName: "t", WebIdentityToken: "twin", Version: "2011-06-15" }).toString() });
  const t = await r.text(), g = (k) => (new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(t) || [])[1];
  return { accessKeyId: g("AccessKeyId"), secretAccessKey: g("SecretAccessKey"), sessionToken: g("SessionToken") };
};
const creds = await assume("sws-aws-platform-read");
const send = async (req) => ctx.AwsTransport.fetch(req.url, { method: req.method, headers: await ctx.SigV4.sign({ method: req.method, url: req.url, headers: req.headers, body: req.body }, creds, req.region, req.service), body: req.body });
const api = ctx.S3Api(send), bucket = ctx.AwsTwin.buckets.trail, region = (await api.getBucket(bucket)).region;
// The trail bucket has a CORS rule in the twin's seed, so the page can read it directly.
const files = [];
let page = { next: undefined };
do { page = await api.listObjects(bucket, region, { prefix: "AWSLogs/", delimiter: "", token: page.next }); files.push(...page.files.filter((f) => f.key.endsWith(".json.gz"))); } while (page.next);
if (files.length < 2) fail("twin trail files: " + files.length);
const reads = await Promise.all(files.map(async (f) => R.fromBytes((await api.getObject(bucket, region, f.key)).bytes, { name: f.key })));
const all = R.merge(reads);
if (all.events.length < 2) fail("twin trail events: " + all.events.length);
for (const x of all.events) if (!x.id || !x.time || !x.who.name || !x.targets.length || /undefined|null/.test(x.words) || !/^urn:sws:cloudtrail-event:/.test(x.node)) fail("twin event incomplete: " + JSON.stringify({ id: x.id, words: x.words, node: x.node }));
checks++;
console.log("OK (activity: " + checks + " checks; cloudtrail.aws.a's reader cases, bad lines, fromBytes over gzip, JSON, JSON Lines and a cap, the twin's trail through S3Api: " + all.events.length + " events in " + files.length + " files)");
