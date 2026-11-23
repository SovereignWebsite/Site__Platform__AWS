// Run: node --test docs/viz/deploy-steps.test.mjs   (no network; events in the shape of CfnApi.events, newest first)
import { test } from "node:test";
import assert from "node:assert/strict";
import { deploySteps, boardAt } from "./deploy-steps.mjs";
import { createPlayer } from "./player.mjs";

// A synthetic Vault deployment (names illustrative, not a real template), newest first as DescribeStackEvents returns.
const events = [
  { time: "2026-11-23T15:04:10Z", logicalId: "vault-demo", type: "AWS::CloudFormation::Stack", status: "CREATE_COMPLETE" },
  { time: "2026-11-23T15:04:05Z", logicalId: "VaultDns", type: "AWS::Route53::RecordSet", status: "CREATE_COMPLETE" },
  { time: "2026-11-23T15:03:30Z", logicalId: "VaultDns", type: "AWS::Route53::RecordSet", status: "CREATE_IN_PROGRESS" },
  { time: "2026-11-23T15:03:29Z", logicalId: "VaultCdn", type: "AWS::CloudFront::Distribution", status: "CREATE_COMPLETE" },
  { time: "2026-11-23T15:00:20Z", logicalId: "VaultCdn", type: "AWS::CloudFront::Distribution", status: "CREATE_IN_PROGRESS", reason: "Resource creation Initiated" },
  { time: "2026-11-23T15:00:19Z", logicalId: "VaultBucket", type: "AWS::S3::Bucket", status: "CREATE_COMPLETE" },
  { time: "2026-11-23T15:00:02Z", logicalId: "VaultBucket", type: "AWS::S3::Bucket", status: "CREATE_IN_PROGRESS" },
  { time: "2026-11-23T15:00:00Z", logicalId: "vault-demo", type: "AWS::CloudFormation::Stack", status: "CREATE_IN_PROGRESS", reason: "User Initiated" }
];

test("events become steps in time order: travel out on in-progress, pulse on complete", () => {
  const s = deploySteps(events, { stack: "vault-demo" });
  assert.equal(s.length, 8);
  assert.equal(s[0].title, "Stack"); assert.equal(s[0].from, s[0].to);
  assert.deepEqual([s[1].from, s[1].to, s[1].kind], ["stack", "VaultBucket", "working"]);
  assert.deepEqual([s[2].from, s[2].to, s[2].kind], ["VaultBucket", "VaultBucket", "done"]);
  assert.equal(s[1].t, 2); assert.equal(s[7].t, 250);
  assert.match(s[3].text, /VaultCdn \(AWS::CloudFront::Distribution\): creating, Resource creation Initiated/);
  assert.match(s[7].text, /vault-demo: create complete/);
});

test("a failure and a rollback show as failed steps, with AWS's reason", () => {
  const bad = [
    { time: "2026-11-23T15:00:00Z", logicalId: "v", type: "AWS::CloudFormation::Stack", status: "CREATE_IN_PROGRESS" },
    { time: "2026-11-23T15:00:05Z", logicalId: "VaultBucket", type: "AWS::S3::Bucket", status: "CREATE_FAILED", reason: "Bucket name already exists" },
    { time: "2026-11-23T15:00:06Z", logicalId: "v", type: "AWS::CloudFormation::Stack", status: "ROLLBACK_IN_PROGRESS" }
  ];
  const s = deploySteps(bad);
  assert.equal(s[1].kind, "failed"); assert.match(s[1].text, /create failed, Bucket name already exists/);
  assert.match(s[2].text, /rolling back/);
});

test("DNS: a last step that says whether the name answers yet", () => {
  const live = deploySteps(events, { dns: { name: "vault.example.org", answers: ["192.0.2.10"] } });
  assert.deepEqual([live.at(-1).to, live.at(-1).kind], ["dns", "done"]);
  const waiting = deploySteps(events, { dns: { name: "vault.example.org", answers: [] } });
  assert.equal(waiting.at(-1).kind, "waiting"); assert.match(waiting.at(-1).text, /does not answer yet/);
});

test("the board lists each resource's latest state at a moment; the shared player plays the run", () => {
  const s = deploySteps(events);
  assert.deepEqual(boardAt(s, 100).map((r) => r.station + ":" + r.kind), ["stack:working", "VaultBucket:done", "VaultCdn:working"]);
  assert.ok(boardAt(s, 999).every((r) => r.kind === "done"));
  const p = createPlayer(s);
  p.goTo(6); assert.equal(p.frame().step.title, "VaultDns");
  assert.deepEqual(deploySteps([]), []);
});

import { progress } from "./deploy-steps.mjs";

test("progress: N of M ready against the template, time left only from measured history", () => {
  const s = deploySteps(events);
  const ids = ["VaultBucket", "VaultCdn", "VaultDns"];
  assert.deepEqual(progress(s, 100, ids), { ready: 1, total: 3, failed: false, left: null });
  const p = progress(s, 100, ids, { VaultBucket: 17, VaultCdn: 190, VaultDns: 35 });
  assert.equal(p.left, 110, "CloudFront started at 20 s, takes 190 s: 110 s left");
  assert.equal(progress(s, 100, ids, { VaultBucket: 17 }).left, null, "partial history: no estimate");
  assert.deepEqual(progress(s, 999, ids), { ready: 3, total: 3, failed: false, left: null });
});
