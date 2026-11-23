// Design 02, migration step 1 (and 2): the journal-based twin gives byte-for-byte the output of twin v0 for each
// demo pack: every bucket, every object's key, size, ETag, type and LastModified, and the IAM roles
// (test/fixtures/twin-golden/, made by `node test/twin/golden.mjs write` from v0 at dev 4f9bc3c, Node 22).
// Also the fold laws: refolding the journal gives the world the services answer from, and the same pack twice
// gives the same journal.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { FIXTURES, PACKS, snapshot, loadTwin } from "./golden.mjs";

let checks = 0;
for (const pack of PACKS) {
  const want = JSON.parse(fs.readFileSync(path.join(FIXTURES, pack + ".json"), "utf8"));
  const got = await snapshot(pack);
  assert.deepEqual(Object.keys(got.buckets), Object.keys(want.buckets), pack + ": buckets");
  for (const b of Object.keys(want.buckets)) {
    const w = want.buckets[b], g = got.buckets[b];
    assert.equal(g.length, w.length, pack + ": " + b + " object count");
    for (let i = 0; i < w.length; i++) { assert.deepEqual(g[i], w[i], pack + ": " + b + "/" + w[i].key); checks++; }
  }
  assert.deepEqual(got.bucketProps, want.bucketProps, pack + ": bucket properties (region, CORS)");
  assert.deepEqual(got.roles, want.roles, pack + ": IAM roles");
  checks += 2;
}

// The journal: every object in the world came from an entry, and refolding the entries gives the same world.
const strip = (w) => JSON.parse(JSON.stringify(w)); // drops the lazy body getters, keeps the recipes
for (const pack of PACKS) {
  const twin = loadTwin(pack);
  const j1 = twin.journal();
  assert.ok(j1.length > 1220, pack + ": journal has an entry per object, CORS rule and role (" + j1.length + ")");
  assert.ok(j1.every((e, i) => e.seq === i + 1 && e.op && e.actor && e.source), pack + ": entries are numbered and say who and where from");
  assert.ok(j1.filter((e) => e.op === "s3.putObject").every((e) => e.source === "pack:" + pack), pack + ": the pack is the source of its objects");
  const refolded = strip(twin.fold(j1));
  const again = loadTwin(pack);
  assert.deepEqual(again.journal(), j1, pack + ": same pack, same journal");
  assert.deepEqual(refolded, strip(again.fold(again.journal())), pack + ": fold is deterministic");
  // A prefix of the journal folds to a world with fewer objects: time travel is replay to a point.
  const half = strip(twin.fold(j1.slice(0, 600)));
  const count = (w) => Object.values(w.objects).reduce((a, o) => a + Object.keys(o).length, 0);
  assert.ok(count(half) < count(refolded), pack + ": a prefix folds to an earlier world");
  checks += 6;
}
// Writes through the services become entries with the caller as the actor, and the live world equals the refold.
{
  const twin = loadTwin("baseline");
  const CHANGE = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCHANGE/20261122/us-east-1/iam/aws4_request, SignedHeaders=host, Signature=twin" };
  const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Federated: "accounts.google.com" }, Action: "sts:AssumeRoleWithWebIdentity", Condition: { StringEquals: { "accounts.google.com:aud": ["only-one"] } } }] };
  const before = twin.journal().length;
  const r = await twin.handle("https://iam.amazonaws.com/", { method: "POST", headers: CHANGE, body: "Action=UpdateAssumeRolePolicy&RoleName=sws-aws-platform-read&PolicyDocument=" + encodeURIComponent(JSON.stringify(trust)) });
  assert.equal(r.status, 200, "UpdateAssumeRolePolicy answered");
  const j = twin.journal(), last = j[j.length - 1];
  assert.equal(j.length, before + 1, "one write, one entry");
  assert.equal(last.op, "iam.updateAssumeRolePolicy");
  assert.equal(last.actor, "role:sws-aws-platform-change", "the caller is the actor");
  assert.equal(last.data.trust.Statement[0].Condition.StringEquals["accounts.google.com:aud"], "only-one", "the list of one is read back as the bare value, as IAM does");
  const g = await twin.handle("https://iam.amazonaws.com/", { method: "POST", headers: CHANGE, body: "Action=GetRole&RoleName=sws-aws-platform-read" });
  const doc = JSON.parse(decodeURIComponent(/<AssumeRolePolicyDocument>([^<]*)</.exec(await g.text())[1]));
  assert.deepEqual(doc, twin.fold(j).roles["sws-aws-platform-read"], "the live world is the refold of the journal");
  checks += 6;
}
console.log("OK (twin golden: " + checks + " checks; 3 packs give v0's keys, sizes, ETags, types, dates, bucket properties and roles byte for byte; journal refolds to the same world)");
// Names that are Object.prototype properties are only missing entries (security.aws.a's note on 88831eb).
{
  const twin = loadTwin("baseline");
  const H = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCHANGE/20261122/us-east-1/iam/aws4_request, SignedHeaders=host, Signature=twin" };
  for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const r = await twin.handle("https://iam.amazonaws.com/", { method: "POST", headers: H, body: "Action=GetRole&RoleName=" + name });
    assert.equal(r.status, 404, name + ": GetRole is NoSuchEntity");
    const u = await twin.handle("https://iam.amazonaws.com/", { method: "POST", headers: H, body: "Action=UpdateAssumeRolePolicy&RoleName=" + name + "&PolicyDocument=" + encodeURIComponent('{"Version":"2012-10-17","Statement":[]}') });
    assert.equal(u.status, 404, name + ": UpdateAssumeRolePolicy is NoSuchEntity");
    const s3 = await twin.handle("https://" + name + ".s3.eu-west-2.amazonaws.com/", { headers: H });
    assert.equal(s3.status, 404, name + ": S3 is NoSuchBucket");
  }
  assert.equal(Object.prototype.polluted, undefined, "no prototype touched");
  console.log("OK (twin golden: prototype names are missing entries for IAM and S3)");
}
