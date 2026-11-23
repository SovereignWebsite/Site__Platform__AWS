// Tests for docs/cloudtrail/reader/ct-alarms.js over synthetic events read by ct-reader.js (account 111122223333,
// documentation addresses): each rule fires on what it should and stays quiet on what it should not.
// Run from the repository root: node docs/cloudtrail/reader/ct-alarms.test.mjs
import { readFileSync } from "node:fs";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b)); };
globalThis.window = globalThis;
for (const f of ["ct-reader.js", "ct-alarms.js"]) new Function(readFileSync(new URL("./" + f, import.meta.url), "utf8"))();
const R = globalThis.CloudTrailReader, AL = globalThis.CloudTrailAlarms, A = "111122223333";
let n = 0;
const rec = (o) => Object.assign({ eventVersion: "1.09", eventID: "e" + (++n), eventTime: "2026-11-22T10:" + String(n).padStart(2, "0") + ":00Z", eventSource: "iam.amazonaws.com", awsRegion: "us-east-1",
  sourceIPAddress: "203.0.113.7", userAgent: "Mozilla/5.0", recipientAccountId: A, readOnly: false, eventCategory: "Management",
  userIdentity: { type: "AssumedRole", sessionContext: { sessionIssuer: { type: "Role", arn: "arn:aws:iam::" + A + ":role/sws-aws-platform-change", userName: "sws-aws-platform-change" } } } }, o);
const alarms = (records) => AL.run(R.read({ Records: records }).events);
const ids = (records) => alarms(records).map((a) => a.rule).sort();

// a quiet day: reads, a change from the usual address, a change to some other role
const quiet = [rec({ eventName: "GetRole", readOnly: true, requestParameters: { roleName: "sws-aws-platform-read" } }),
  rec({ eventName: "UpdateAssumeRolePolicy", requestParameters: { roleName: "someone-elses-role" } }),
  rec({ eventSource: "s3.amazonaws.com", eventName: "GetObject", readOnly: true, eventCategory: "Data", requestParameters: { bucketName: "b", key: "k" } })];
eq(ids(quiet), [], "quiet day");

// trust change on the DNS role (R-005) and on a platform role
eq(ids([...quiet, rec({ eventName: "UpdateAssumeRolePolicy", requestParameters: { roleName: "sovereignwebsite-factory-dns" } })]), ["iam-trust-or-permissions"], "DNS trust change");
eq(ids([...quiet, rec({ eventName: "PutRolePolicy", requestParameters: { roleName: "sws-aws-platform-change", policyName: "p" } })]), ["iam-trust-or-permissions"], "platform role policy");
eq(ids([...quiet, rec({ eventName: "PutRolePolicy", requestParameters: { roleName: "sws-aws-platform-change" }, errorCode: "AccessDenied" })]).includes("iam-trust-or-permissions"), false, "refused change does not fire the change rule");

// R-008: change set applied to the hub's stack, not just prepared
const cs = (name) => rec({ eventSource: "cloudformation.amazonaws.com", awsRegion: "eu-west-2", eventName: name, requestParameters: { stackName: "sws-aws-platform", changeSetName: "c" } });
eq(ids([...quiet, cs("CreateChangeSet")]), [], "prepared change set is quiet");
eq(ids([...quiet, cs("CreateChangeSet"), cs("ExecuteChangeSet")]), ["hub-stack-change-applied"], "applied change set");

// trail stopped
eq(ids([...quiet, rec({ eventSource: "cloudtrail.amazonaws.com", eventName: "StopLogging", requestParameters: { name: "demo" } })]), ["trail-changed"], "trail stopped");

// refused burst: 5 in ten minutes fires once; 4 does not; 5 spread over an hour does not
const denied = (t) => rec({ eventName: "GetRole", readOnly: true, eventTime: t, errorCode: "AccessDenied", requestParameters: { roleName: "x" } });
eq(ids([...quiet, ...["10:00", "10:02", "10:04", "10:06", "10:08"].map((m) => denied("2026-11-22T" + m + ":30Z"))]), ["refused-burst"], "five refusals in ten minutes");
eq(ids([...quiet, ...["10:00", "10:02", "10:04", "10:06"].map((m) => denied("2026-11-22T" + m + ":30Z"))]), [], "four refusals");
eq(ids([...quiet, ...["10:00", "10:15", "10:30", "10:45", "11:00"].map((m) => denied("2026-11-22T" + m + ":30Z"))]), [], "five refusals over an hour");

// new address: a change from an address never seen before; a read from one is quiet; a service is not an address
eq(ids([...quiet, rec({ eventName: "UpdateAssumeRolePolicy", eventTime: "2026-11-22T11:00:00Z", sourceIPAddress: "198.51.100.66", requestParameters: { roleName: "someone-elses-role" } })]), ["new-network"], "change from a new network");
eq(ids([...quiet, rec({ eventName: "GetRole", readOnly: true, eventTime: "2026-11-22T11:00:00Z", sourceIPAddress: "198.51.100.66", requestParameters: { roleName: "x" } })]), [], "read from a new network");
eq(ids([...quiet, rec({ eventName: "UpdateAssumeRolePolicy", eventTime: "2026-11-22T11:00:00Z", sourceIPAddress: "cloudformation.amazonaws.com", requestParameters: { roleName: "someone-elses-role" } })]), [], "service, not an address");

// R-021: eventID and action names that are Object properties; the wider IAM, stack and trail-bucket lists;
// one refused attempt on a protected thing; IPv4-mapped IPv6 counts as its IPv4 network
eq(ids([...quiet, rec({ eventID: "constructor", eventName: "PutRolePolicy", requestParameters: { roleName: "sws-aws-platform-change" } })]), ["iam-trust-or-permissions"], "eventID constructor is not dropped");
eq(ids([...quiet, rec({ eventName: "constructor", requestParameters: { roleName: "sws-aws-platform-change" } })]), [], "action constructor is not an IAM change");
for (const a of ["UpdateRole", "PutRolePermissionsBoundary", "DeleteRolePermissionsBoundary", "CreateRole", "DeleteRole", "TagRole", "UntagRole"])
  eq(ids([...quiet, rec({ eventName: a, requestParameters: { roleName: "sws-aws-platform-change" } })]), ["iam-trust-or-permissions"], a);
for (const a of ["UpdateStack", "DeleteStack"]) eq(ids([...quiet, cs(a)]), ["hub-stack-change-applied"], a);
const s3 = (name, b, o) => rec(Object.assign({ eventSource: "s3.amazonaws.com", eventName: name, requestParameters: { bucketName: b } }, o));
for (const a of ["PutBucketPolicy", "PutBucketLifecycle", "DeleteBucket"]) eq(ids([...quiet, s3(a, "aws-cloudtrail-logs-" + A + "-demo")]), ["trail-changed"], a + " on the trail bucket");
eq(ids([...quiet, s3("PutBucketPolicy", "some-site")]), [], "bucket policy on another bucket");
eq(ids([...quiet, rec({ eventSource: "cloudtrail.amazonaws.com", eventName: "CreateTrail", readOnly: false, requestParameters: { name: "t2", s3BucketName: "my-own-logs" } }), s3("DeleteBucket", "my-own-logs")]), ["trail-changed"], "a bucket named by CreateTrail is a trail bucket");
eq(ids([...quiet, rec({ eventName: "PutRolePolicy", requestParameters: { roleName: "sws-aws-platform-change" }, errorCode: "AccessDenied" })]), ["refused-on-protected"], "one refused change on a hub role");
eq(ids([...quiet, Object.assign(cs("ExecuteChangeSet"), { errorCode: "AccessDenied" })]), ["refused-on-protected"], "one refused change set on the hub stack");
eq(ids([...quiet, rec({ eventSource: "cloudtrail.amazonaws.com", eventName: "StopLogging", requestParameters: { name: "demo" }, errorCode: "AccessDenied" })]), ["refused-on-protected"], "one refused StopLogging");
eq(ids([...quiet, rec({ eventName: "UpdateAssumeRolePolicy", eventTime: "2026-11-22T11:00:00Z", sourceIPAddress: "::ffff:198.51.100.66", requestParameters: { roleName: "someone-elses-role" } })]), ["new-network"], "IPv4-mapped change from a new network");
eq(ids([...quiet, rec({ eventName: "UpdateAssumeRolePolicy", eventTime: "2026-11-22T11:00:00Z", sourceIPAddress: "::ffff:203.0.113.99", requestParameters: { roleName: "someone-elses-role" } })]), [], "IPv4-mapped address in a known /24");

// the Vault templates bucket: root on bucket settings, retention or legal hold by anyone; quiet otherwise
const TB = "sws-vault-templates-" + A + "-eu-west-2", ROOT = { type: "Root", arn: "arn:aws:iam::" + A + ":root" };
for (const a of ["PutBucketPolicy", "PutBucketVersioning", "DeleteBucketPolicy", "DeleteBucket"]) eq(ids([...quiet, s3(a, TB, { userIdentity: ROOT })]), ["vault-templates-bucket"], "root " + a + " on the templates bucket");
eq(ids([...quiet, s3("PutBucketPolicy", TB, { userIdentity: ROOT, errorCode: "AccessDenied" })]), ["vault-templates-bucket"], "refused root attempt still fires");
eq(ids([...quiet, s3("PutObjectRetention", TB, { eventCategory: "Data", requestParameters: { bucketName: TB, key: "vault/0.4.5/vault.yaml" } })]), ["vault-templates-bucket"], "retention by anyone");
eq(ids([...quiet, s3("PutObjectLegalHold", TB, { eventCategory: "Data", requestParameters: { bucketName: TB, key: "vault/0.4.5/vault.yaml" } })]), ["vault-templates-bucket"], "legal hold by anyone");
eq(ids([...quiet, s3("PutBucketPolicy", TB)]), [], "a role changing the policy is not this rule");
eq(ids([...quiet, s3("PutBucketPolicy", "sws-vault-templates-x", { userIdentity: ROOT })]), [], "not the templates bucket name");

// the R-008 story as the attack pack would play it: three alarms, newest first, each with its events and words
const story = [...quiet,
  rec({ eventSource: "cloudformation.amazonaws.com", awsRegion: "eu-west-2", eventName: "CreateChangeSet", eventTime: "2026-11-22T12:00:00Z", sourceIPAddress: "198.51.100.66", requestParameters: { stackName: "sws-aws-platform", changeSetName: "x" } }),
  rec({ eventSource: "cloudformation.amazonaws.com", awsRegion: "eu-west-2", eventName: "ExecuteChangeSet", eventTime: "2026-11-22T12:01:00Z", sourceIPAddress: "198.51.100.66", requestParameters: { stackName: "sws-aws-platform", changeSetName: "x" } }),
  rec({ eventName: "UpdateAssumeRolePolicy", eventTime: "2026-11-22T12:02:00Z", sourceIPAddress: "198.51.100.66", requestParameters: { roleName: "sovereignwebsite-factory-dns" } })];
const got = alarms(story);
eq(got.map((a) => a.rule), ["iam-trust-or-permissions", "hub-stack-change-applied", "new-network"], "R-008 story, newest first");
if (got.some((a) => !a.words || !a.events.length || !a.level)) fail("alarm without words, events or level");
eq(got[2].events[0].action, "CreateChangeSet", "new-network names the first call from that network");
eq(AL.rules.length, 7, "seven rules listed");
console.log("ok ct-alarms: 7 rules, 47 cases (21 for R-021, 9 for the templates bucket), R-008 story gives 3 alarms newest first");
