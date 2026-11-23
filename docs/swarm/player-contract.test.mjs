// Run: node --test docs/swarm/player-contract.test.mjs
// Contract between the swarm's steps (docs/swarm/steps.mjs) and viz.aws.a's player (docs/viz/player.mjs).
// The player is read from git (origin/work/viz.aws.a, or dev once landed) into a temporary folder, never copied
// into docs/swarm/: docs/viz/** is viz.aws.a's lane. Skips if neither ref has it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { stepsFrom } from "./steps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
function playerSource() {
  for (const ref of ["origin/dev", "origin/work/viz.aws.a"]) {
    try {
      const src = execFileSync("git", ["-C", root, "show", `${ref}:docs/viz/player.mjs`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const sha = execFileSync("git", ["-C", root, "rev-parse", "--short", ref], { encoding: "utf8" }).trim();
      return { src, where: `${ref} ${sha}` };
    } catch { /* try the next ref */ }
  }
  return null;
}

const found = playerSource();
const replay = JSON.parse(readFileSync(join(here, "data/replay.json"), "utf8"));

test("tonight's swarm plays in viz.aws.a's player", { skip: !found && "docs/viz/player.mjs not on dev or work/viz.aws.a" }, async (t) => {
  t.diagnostic(`player from ${found.where}`);
  const dir = mkdtempSync(join(tmpdir(), "viz-player-"));
  writeFileSync(join(dir, "player.mjs"), found.src);
  const { createPlayer } = await import(pathToFileURL(join(dir, "player.mjs")).href);

  const steps = stepsFrom(replay);
  let clock = 0;
  const p = createPlayer(steps, { now: () => clock, tail: 1 });
  assert.equal(p.steps.length, steps.length);
  assert.equal(p.duration, steps[steps.length - 1].t + 1);

  for (const s of steps) {                                     // each step is reached at its own t, as itself
    const f = p.frame(s.t);
    assert.equal(f.step.i, s.i);
    assert.equal(f.pulse, s.from === s.to, `step ${s.i} (${s.kind})`);
  }
  const kinds = new Set(steps.filter((s) => s.from !== s.to).map((s) => s.kind));
  assert.ok([...kinds].every((k) => ["spawn", "move", "handoff", "message"].includes(k)), [...kinds].join(","));

  const travel = steps.findIndex((s, n) => s.from !== s.to && n + 1 < steps.length && steps[n + 1].t > s.t);
  const mid = (steps[travel].t + steps[travel + 1].t) / 2;
  const f = p.frame(mid);
  assert.ok(f.progress > 0 && f.progress < 1 && !f.pulse);

  p.seek(0); let walked = 1;                                    // next() walks every step once, in order
  for (let last = p.frame().index; ; walked++) { p.next(); const n = p.frame().index; if (n === last) break; assert.equal(n, last + 1); last = n; }
  assert.equal(walked, steps.length);

  p.setSpeed(16); p.seek(0); p.play(); clock = p.duration;      // plays to the end at the top speed
  assert.ok(p.frame().done);
});
