// The twin's Route 53 reads (cloudformation.aws.a's seed, docs/cloudformation/seed/route53.json; boto3.aws.a note 20):
// ListHostedZones, GetHostedZone and ListResourceRecordSets for the platform account, in botocore route53 2013-04-01
// shapes; every other Route 53 call a 501; each answer marked "CORS per SDK v2 metadata, confirm with one real call";
// the customer account refused; reads write nothing. Node 22, no network. Run: node test/twin/route53.test.mjs
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";

const twin = loadTwin("baseline"), j0 = twin.journal().length, R53 = "https://route53.amazonaws.com/2013-04-01/";
const READ = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/us-east-1/route53/aws4_request, SignedHeaders=host, Signature=twin" };
const CUST = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/us-east-1/route53/aws4_request, SignedHeaders=host, Signature=twin" };
const get = async (p, h = READ, method = "GET") => { const r = await twin.handle(R53 + p, { method, headers: h }); return { status: r.status, note: r.headers.get("x-twin-note"), text: await r.text() }; };
const tag = (t, n) => [...t.matchAll(new RegExp("<" + n + ">([^<]*)</" + n + ">", "g"))].map((m) => m[1]);
const NOTE = "CORS per SDK v2 metadata, confirm with one real call";
let checks = 0;

// ListHostedZones
let r = await get("hostedzone");
assert.equal(r.status, 200); assert.equal(r.note, NOTE);
assert.match(r.text, /^<\?xml version="1\.0"\?><ListHostedZonesResponse xmlns="https:\/\/route53\.amazonaws\.com\/doc\/2013-04-01\/">/);
assert.deepEqual(tag(r.text, "Id"), ["/hostedzone/Z0DEMOTWIN0001"], "Id as /hostedzone/Z... in answers (note 20)");
assert.deepEqual(tag(r.text, "Name"), ["example.com."]); assert.deepEqual(tag(r.text, "PrivateZone"), ["false"]);
assert.deepEqual(tag(r.text, "ResourceRecordSetCount"), ["4"]); assert.deepEqual(tag(r.text, "IsTruncated"), ["false"]); assert.equal(tag(r.text, "NextMarker").length, 0);
for (const q of ["?maxitems=0", "?maxitems=101", "?maxitems=x", "?marker=ZNOPE"]) assert.equal((await get("hostedzone" + q)).status, 400, q);
checks += 11;

// GetHostedZone: the bare id in the path, the delegation set's name servers
r = await get("hostedzone/Z0DEMOTWIN0001");
assert.equal(r.status, 200); assert.equal(r.note, NOTE);
assert.deepEqual(tag(r.text, "NameServer"), ["ns-0000.awsdns-00.org", "ns-0001.awsdns-01.co.uk"]);
r = await get("hostedzone/ZNOSUCHZONE1");
assert.equal(r.status, 404); assert.deepEqual(tag(r.text, "Code"), ["NoSuchHostedZone"]); assert.equal(r.note, NOTE);
assert.equal((await get("hostedzone/z0lower")).status, 400, "a malformed id");
checks += 7;

// ListResourceRecordSets: the seed's four records, paged on name and type
r = await get("hostedzone/Z0DEMOTWIN0001/rrset");
assert.deepEqual(tag(r.text, "Name"), ["example.com.", "example.com.", "www.example.com.", "old.example.com."]);
assert.deepEqual(tag(r.text, "Type"), ["NS", "SOA", "A", "CNAME"]);
assert.deepEqual(tag(r.text, "DNSName"), ["d111111abcdef8.cloudfront.net."], "the www alias to the demo distribution's domain");
assert.equal(tag(r.text, "HostedZoneId").length, 0, "AliasTarget.HostedZoneId left out, as in the seed");
assert.deepEqual(tag(r.text, "Value").at(-1), "old.example.com.s3-website.eu-west-2.amazonaws.com", "the dangling CNAME");
r = await get("hostedzone/Z0DEMOTWIN0001/rrset?maxitems=2");
assert.deepEqual(tag(r.text, "IsTruncated"), ["true"]); assert.deepEqual(tag(r.text, "NextRecordName"), ["www.example.com."]); assert.deepEqual(tag(r.text, "NextRecordType"), ["A"]);
r = await get("hostedzone/Z0DEMOTWIN0001/rrset?maxitems=2&name=www.example.com.&type=A");
assert.deepEqual(tag(r.text, "Name"), ["www.example.com.", "old.example.com."]); assert.deepEqual(tag(r.text, "IsTruncated"), ["false"]);
for (const q of ["?maxitems=301", "?name=nope.example.com.", "?type=A", "?name=www.example.com.&identifier=x"]) assert.equal((await get("hostedzone/Z0DEMOTWIN0001/rrset" + q)).status, 400, q);
assert.equal((await get("hostedzone/ZNOSUCHZONE1/rrset")).status, 404);
checks += 15;

// Only these three reads; the customer account refused; nothing written
for (const p of ["healthcheck", "hostedzone/Z0DEMOTWIN0001/rrset/extra", "hostedzonecount", "change/C1"]) { r = await get(p); assert.equal(r.status, 501, p); assert.equal(r.note, NOTE); }
assert.equal((await get("hostedzone/Z0DEMOTWIN0001/rrset", READ, "POST")).status, 501, "ChangeResourceRecordSets is not in the twin");
assert.equal((await get("hostedzone", CUST)).status, 403, "the customer account has no Route 53 in the twin");
assert.equal(twin.journal().length, j0, "reads write nothing");
checks += 11;

console.log("OK (twin Route 53 reads: " + checks + " checks; three reads from the seed, paging, errors, 501 for the rest, customer refused, reads only)");
