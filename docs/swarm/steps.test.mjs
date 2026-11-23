// Run: node --test docs/swarm/steps.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stepsFrom, asText, warp } from "./steps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const small = { since: "2026-11-23T03:00Z", events: [
  { t: "2026-11-23T02:59:00Z", type: "commit", agent: "aws.c", sha: "0000000", subject: "before the window" },
  { t: "2026-11-23T03:21:42Z", type: "spawn", from: "conductor.aws.c", to: "viz.aws.c" },
  { t: "2026-11-23T03:21:43Z", type: "spawn", from: "conductor.aws.c", to: "swarm.aws.c" },
  { t: "2026-11-23T03:36:00Z", type: "move", from: "swarm.aws.c", to: "swarm.aws.a", source: "docs/team/handover/swarm.aws.md" },
  { t: "2026-11-23T03:40Z", type: "commit", agent: "swarm.aws.a", sha: "e302781", subject: "extractor", signature: "own key", branch: "work/swarm.aws.a" },
  { t: "2026-11-23T03:41Z", type: "commit", agent: "s3.aws.c", sha: "7cc0dd4", subject: "first note", signature: "unknown key" },
] };

test("travels go between two agents, pulses stay on one", () => {
  const s = stepsFrom(small);
  assert.deepEqual(s.map((x) => [x.kind, x.from, x.to]), [
    ["spawn", "conductor.aws.c", "viz.aws.c"], ["spawn", "conductor.aws.c", "swarm.aws.c"],
    ["move", "swarm.aws.c", "swarm.aws.a"], ["commit", "swarm.aws.a", "swarm.aws.a"], ["commit", "s3.aws.c", "s3.aws.c"]]);
  assert.deepEqual(s.map((x) => x.i), [1, 2, 3, 4, 5]);
});

test("time warp: a one-second burst is spread, a long wait is capped", () => {
  const s = stepsFrom(small);
  assert.equal(s[0].t, 0);
  assert.equal(s[1].t, 0.15);
  assert.equal(s[2].t, 2.15);
  assert.equal(warp(3600), 2);
});

test("the step shape is viz.aws.a's, and a bad signature shows in the text", () => {
  const s = stepsFrom(small);
  for (const x of s) assert.deepEqual(Object.keys(x).filter((k) => k !== "gap").sort(), ["fields", "from", "i", "kind", "t", "text", "title", "to"]);
  assert.match(s[4].text, /signature: unknown key/);
  assert.equal(s[3].fields.branch, "work/swarm.aws.a");
  assert.match(asText(s)[2], /^3\. 2026-11-23T03:36:00Z Move: swarm.aws.c moves to account A as swarm.aws.a$/);
});

test("tonight's replay turns into steps without loss", () => {
  const replay = JSON.parse(readFileSync(join(here, "data/replay.json"), "utf8"));
  const s = stepsFrom(replay);
  assert.equal(s.length, replay.events.length);
  assert.ok(s.every((x, n) => n === 0 || x.t > s[n - 1].t));
});
