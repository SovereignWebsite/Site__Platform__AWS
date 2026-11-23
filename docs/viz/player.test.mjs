// Run: node --test docs/viz/player.test.mjs   (no network, no DOM; the clock is driven by the test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlayer, SPEEDS } from "./player.mjs";

const packet = [ // the shape docs/viz/steps.mjs gives
  { i: 1, t: 0, from: "visitor", to: "edge", kind: "request" },
  { i: 2, t: 0.02, from: "edge", to: "edge", kind: "request" },
  { i: 3, t: 0.04, from: "edge", to: "keeper", kind: "data" },
  { i: 4, t: 0.06, from: "keeper", to: "visitor", kind: "data" }
];
const swarm = [ // the shape docs/swarm/steps.mjs gives (work/swarm.aws.a): travels and pulses
  { i: 1, t: 0, from: "conductor", to: "viz", kind: "spawn" },
  { i: 2, t: 2, from: "viz", to: "viz", kind: "commit" },
  { i: 3, t: 2.15, from: "viz", to: "swarm", kind: "message" }
];
const clock = () => { let s = 0; const now = () => s; now.add = (d) => { s += d; }; return now; };

test("travel progress and pulses, for both kinds of run", () => {
  const p = createPlayer(swarm, { tail: 1 });
  assert.equal(p.duration, 3.15);
  let f = p.frame(1);
  assert.equal(f.step.i, 1); assert.equal(f.pulse, false); assert.equal(f.progress, 0.5);
  f = p.frame(2.1);
  assert.equal(f.step.kind, "commit"); assert.equal(f.pulse, true);
  assert.equal(p.frame(-1).index, -1);
  assert.equal(p.frame(3.15).done, true);
});

test("play, pause and speed follow the clock; play stops at the end", () => {
  const now = clock(), p = createPlayer(packet, { now, tail: 0.02 });
  p.play(); now.add(0.03);
  assert.ok(Math.abs(p.frame().t - 0.03) < 1e-9);
  p.setSpeed(0.25); now.add(0.04);
  assert.ok(Math.abs(p.frame().t - 0.04) < 1e-9);
  p.pause(); now.add(10);
  assert.ok(Math.abs(p.frame().t - 0.04) < 1e-9);
  p.setSpeed(16); p.play(); now.add(10);
  assert.equal(p.frame().t, p.duration); assert.equal(p.playing, false);
  p.play(); assert.equal(p.frame().t, 0, "play at the end starts again");
  assert.throws(() => p.setSpeed(3), /Speed must be one of/);
  assert.deepEqual(SPEEDS, [0.25, 1, 4, 16]);
});

test("step forward, step back, and jump to a step", () => {
  const p = createPlayer(packet);
  p.next(); assert.equal(p.frame().step.i, 2);
  p.next(); p.next(); assert.equal(p.frame().step.i, 4);
  p.next(); assert.equal(p.frame().step.i, 4, "no step after the last");
  p.prev(); assert.equal(p.frame().step.i, 3);
  p.seek(0.05); p.prev(); assert.equal(p.frame().step.i, 3, "mid-step: back to its start");
  p.goTo(1); assert.equal(p.frame().t, 0);
  assert.throws(() => p.goTo(9), /No step 9/);
});

test("an empty run plays nothing and does not throw", () => {
  const p = createPlayer([]);
  assert.equal(p.duration, 0); assert.equal(p.frame(0).step, null);
  p.play(); p.next(); p.prev();
});
