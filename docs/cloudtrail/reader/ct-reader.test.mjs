// Tests for docs/cloudtrail/reader/ct-reader.js: synthetic fixtures (account 111122223333, documentation addresses),
// then the twin's own trail files read from its S3 as the page would. Node 22; no network.
// Run from the repository root: node docs/cloudtrail/reader/ct-reader.test.mjs [path to a twin.js, default site/twin.js]
import { readFileSync } from "node:fs";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b)); };
globalThis.window = globalThis;
new Function(readFileSync(new URL("./ct-reader.js", import.meta.url), "utf8"))();
const R = globalThis.CloudTrailReader, A = "111122223333";
const base = (o) => Object.assign({ eventVersion: "1.09", eventTime: "2026-11-22T10:00:00Z", eventSource: "iam.amazonaws.com", awsRegion: "us-east-1", sourceIPAddress: "198.51.100.4", userAgent: "test", recipientAccountId: A, readOnly: false, eventCategory: "Management" }, o);
const assumed = (role) => ({ type: "AssumedRole", arn: "arn:aws:sts::" + A + ":assumed-role/" + role + "/s", sessionContext: { sessionIssuer: { type: "Role", arn: "arn:aws:iam::" + A + ":role/" + role, userName: role }, webIdFederationData: { federatedProvider: "accounts.google.com" } } });

// who, one per row of the table
const who = (u) => R.normalise(base({ eventID: "x", eventName: "GetRole", userIdentity: u })).who;
eq(who(assumed("sws-aws-platform-change")), { kind: "role", name: "sws-aws-platform-change", arn: "arn:aws:iam::" + A + ":role/sws-aws-platform-change", via: "accounts.google.com" }, "AssumedRole");
eq(who({ type: "IAMUser", userName: "ci", arn: "arn:aws:iam::" + A + ":user/ci" }), { kind: "user", name: "ci", arn: "arn:aws:iam::" + A + ":user/ci", via: null }, "IAMUser");
eq(who({ type: "Root", arn: "arn:aws:iam::" + A + ":root" }).kind, "root", "Root");
eq(who({ type: "WebIdentityUser", userName: "u", identityProvider: "accounts.google.com" }), { kind: "web", name: "u", arn: null, via: "accounts.google.com" }, "WebIdentityUser");
eq(who({ type: "AWSService", invokedBy: "firehose.amazonaws.com" }), { kind: "service", name: "firehose.amazonaws.com", arn: null, via: "firehose.amazonaws.com" }, "AWSService");
eq(who({ type: "SAMLUser" }).kind, "unknown", "other type");
eq(who(undefined).kind, "unknown", "no userIdentity");

// targets and words
const one = (o) => R.normalise(base(Object.assign({ eventID: "t", userIdentity: assumed("sws-aws-platform-change") }, o)));
let e = one({ eventName: "UpdateAssumeRolePolicy", requestParameters: { roleName: "sovereignwebsite-factory-dns", policyDocument: "{}" } });
eq(e.targets, [{ type: "role", id: "arn:aws:iam::" + A + ":role/sovereignwebsite-factory-dns", name: "sovereignwebsite-factory-dns" }], "trust change target");
eq(e.words, "the change role rewrote who may assume the role sovereignwebsite-factory-dns", "trust change words");
e = one({ eventSource: "s3.amazonaws.com", awsRegion: "eu-west-2", eventName: "GetObject", readOnly: true, eventCategory: "Data", userIdentity: assumed("sws-aws-platform-read"), requestParameters: { bucketName: "b1", key: "data/x.json" } });
eq(e.targets.map((t) => t.type + " " + t.id), ["bucket arn:aws:s3:::b1", "object arn:aws:s3:::b1/data/x.json"], "GetObject targets");
eq([e.change, e.category, e.words], [false, "Data", "the read role read data/x.json in b1"], "GetObject");
e = one({ eventSource: "sts.amazonaws.com", eventName: "AssumeRoleWithWebIdentity", userIdentity: { type: "WebIdentityUser", userName: "u", identityProvider: "accounts.google.com" }, requestParameters: { roleArn: "arn:aws:iam::" + A + ":role/sws-aws-platform-read" } });
eq(e.words, "u signed in to the read role with Google", "sign-in words");
e = one({ eventSource: "sts.amazonaws.com", eventName: "AssumeRoleWithWebIdentity", userIdentity: { type: "WebIdentityUser", userName: "u", identityProvider: "accounts.google.com" }, requestParameters: { roleArn: "arn:aws:iam::" + A + ":role/other" }, errorCode: "AccessDenied", errorMessage: "no" });
eq([e.failed, e.words], [{ code: "AccessDenied", message: "no" }, "u signed in to the role other with Google (refused: AccessDenied)"], "refused sign-in");
e = one({ eventSource: "cloudformation.amazonaws.com", awsRegion: "eu-west-2", eventName: "ExecuteChangeSet", requestParameters: { stackName: "sws-aws-platform", changeSetName: "c" } });
eq([e.targets[0].type, e.words], ["stack", "the change role applied a change to the stack sws-aws-platform"], "change set");
e = one({ eventSource: "cloudcontrolapi.amazonaws.com", awsRegion: "eu-west-2", eventName: "UpdateResource", requestParameters: { typeName: "AWS::S3::Bucket", identifier: "b2", patchDocument: "[]" } });
eq([e.targets[0].id, e.words], ["arn:aws:s3:::b2", "the change role changed the settings of the bucket b2"], "cloud control");
e = one({ eventSource: "cloudtrail.amazonaws.com", eventName: "StopLogging", requestParameters: { name: "demo" } });
eq(e.words, "the change role stopped the trail demo", "stop logging");
e = one({ eventSource: "ec2.amazonaws.com", eventName: "DescribeInstances", requestParameters: null });
eq([e.targets, e.words], [[], "the change role called DescribeInstances on ec2"], "unknown action");
const noRO = base({ eventID: "r", eventName: "GetRole", userIdentity: assumed("sws-aws-platform-read") }); delete noRO.readOnly;
eq(R.normalise(noRO).change, true, "missing readOnly counts as a change");

// inputs: duplicates, order, formats, junk
const r1 = base({ eventID: "1", eventTime: "2026-11-22T10:00:01Z", eventName: "GetRole", userIdentity: assumed("sws-aws-platform-read") });
const r2 = base({ eventID: "2", eventTime: "2026-11-22T10:00:02Z", eventName: "GetRole", userIdentity: assumed("sws-aws-platform-read") });
let rd = R.read({ Records: [r1, r2, r1, { not: "a record" }] });
eq([rd.format, rd.events.map((x) => x.id), rd.skipped], ["records", ["2", "1"], 2], "Records: newest first, duplicate and junk skipped");
rd = R.read({ Events: [{ CloudTrailEvent: JSON.stringify(r1) }, { CloudTrailEvent: JSON.stringify(r2) }] });
eq([rd.format, rd.events.length], ["lookup-events", 2], "LookupEvents wrapper");
rd = R.read(JSON.stringify(r1) + "\n" + JSON.stringify(r2) + "\n");
eq([rd.format, rd.events.length], ["lines", 2], "one record per line");
eq(R.read({ hello: 1 }).format, null, "unknown shape");
eq(R.merge([R.read({ Records: [r1] }), R.read({ Records: [r1, r2] })]).events.map((x) => x.id), ["2", "1"], "merge drops duplicates across files");

// the twin's own trail, read from its S3 as the page would
globalThis.location = { origin: "http://localhost", search: "" };
globalThis.document = { baseURI: "http://localhost/" };
globalThis.fetch = async (u) => new Response(readFileSync(new URL("../../../site/" + new URL(u).pathname.slice(1), import.meta.url), "utf8"));
const twinPath = process.argv[2] || new URL("../../../site/twin.js", import.meta.url);
new Function(readFileSync(twinPath, "utf8"))();
const T = globalThis.AwsTwin, auth = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/x" };
const host = "https://" + T.buckets.trail + ".s3.eu-west-2.amazonaws.com/";
const keys = async () => [...(await (await T.handle(host + "?list-type=2&prefix=AWSLogs%2F", { method: "GET", headers: auth })).text()).matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]);
const file = async (k) => JSON.parse(await new Response(new Blob([await (await T.handle(host + encodeURI(k), { method: "GET", headers: auth })).arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
const readAll = async () => R.merge(await Promise.all((await keys()).filter((k) => k.endsWith(".json.gz")).map(async (k) => R.read(await file(k)))));
T.reset();
let all = await readAll();
if (all.events.length < 2) fail("twin seeded trail: " + all.events.length + " events");
for (const x of all.events) { if (!x.id || !x.time || !x.who.name || !x.targets.length || /undefined|null/.test(x.words)) fail("twin event incomplete: " + JSON.stringify({ id: x.id, words: x.words, targets: x.targets })); }
const live = typeof T.handle === "function" && (await (async () => {
  await T.handle("https://iam.amazonaws.com/", { method: "POST", headers: { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCHANGE/x" }, body: new URLSearchParams({ Action: "UpdateAssumeRolePolicy", RoleName: "sovereignwebsite-factory-dns", PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [] }) }).toString() });
  return (await readAll()).events.length > all.events.length;
})());
if (live) {
  all = await readAll();
  const top = all.events[0];
  eq([top.action, top.who.name, top.change], ["UpdateAssumeRolePolicy", "sws-aws-platform-change", true], "twin live record is newest");
}
console.log("ok ct-reader: who (7 kinds), targets and words (10 actions), inputs (4 formats, duplicates, junk), twin trail (" + all.events.length + " events" + (live ? ", live records seen" : ", no live records: patch not applied") + ")");
