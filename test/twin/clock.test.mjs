// The twin's clock (design 02 step 5, brought forward for deploy step 4), with architect.aws.a's rules (23 Nov):
// scheduled entries are emitted only by the clock's catch-up, each with t = its own at, in at order (ties by the
// scheduling entry's seq, then its place); the same entries come out whether a tick or a read triggered the catch-up,
// so the journal depends on the clock alone; reads never write while paused; a refold rebuilds the pending list.
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";

const START = "2026-11-24T09:00:00.000Z";
const T = (s) => new Date(Date.parse(START) + s * 1000).toISOString();
const read = (twin) => twin.handle("https://iam.amazonaws.com/", { method: "POST", headers: { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/us-east-1/iam/aws4_request, SignedHeaders=host, Signature=twin" }, body: "Action=ListRoles" });
// A chain like a stack's events: A at +30s schedules A2 at +45s; B at +10s; C at +30s (a tie with A, scheduled later).
function scenario(twin) {
  twin.clock.schedule("first", [
    { at: T(30), op: "clock.mark", data: { label: "A" }, schedule: [{ at: T(45), op: "clock.mark", data: { label: "A2" } }] },
    { at: T(10), op: "clock.mark", data: { label: "B" } }
  ]);
  twin.clock.schedule("second", [{ at: T(30), op: "clock.mark", data: { label: "C" } }]);
}
const settled = (j) => j.filter((e) => e.source === "clock").map((e) => [e.data.label, e.t]);
let checks = 0;

// 1. One tick past every at: emitted in at order, ties by scheduling seq, each at its own time; chains follow.
const one = loadTwin("baseline");
one.clock.pause(); one.clock.at(START); scenario(one);
assert.equal(settled(one.journal()).length, 0, "nothing settles before its time");
one.clock.tick(60 * 1000);
const j1 = one.journal();
assert.deepEqual(settled(j1), [["B", T(10)], ["A", T(30)], ["C", T(30)], ["A2", T(45)]], "at order, ties by seq, t = at, the chain follows");
assert.ok(j1.filter((e) => e.source === "clock").every((e) => e.why === "clock.settle" && e.settles), "settled entries say so");
assert.deepEqual([...one.fold(j1).marks], ["first", "second", "B", "A", "C", "A2"], "the world holds the marks in journal order");
assert.equal(one.fold(j1).pending.length, 0, "nothing left pending");
checks += 4;

// 2. Many small ticks with reads at random points between: the same journal.
const two = loadTwin("baseline");
two.clock.pause(); two.clock.at(START); scenario(two);
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let ms = 0; ms < 60 * 1000;) {
  const step = Math.floor(rnd() * 7000) + 1; ms += step; two.clock.tick(step);
  if (rnd() < 0.6) { const before = two.journal().length; await read(two); assert.equal(two.journal().length, before, "a read writes nothing while paused"); checks++; }
}
assert.deepEqual(two.journal(), j1, "many ticks and reads give the same journal as one tick"); checks++;

// 3. A prefix of the journal folds to a world still owing what was not yet emitted.
const mid = one.fold(j1.filter((e) => e.source !== "clock" || Date.parse(e.t) <= Date.parse(T(20))));
assert.deepEqual([...mid.pending.map((p) => p.entry.data.label)].sort(), ["A", "C"], "the refold rebuilds the pending list");
checks++;

// 4. A running clock with no tick: real time passes, and only reads trigger the catch-up; entries still carry t = at
// (not the time of the read), in the same order as a tick gives.
const run = (twin) => twin.clock.schedule("run", [{ at: T(0.3), op: "clock.mark", data: { label: "Y" } }, { at: T(0.2), op: "clock.mark", data: { label: "X" } }]);
const three = loadTwin("baseline");
three.clock.pause(); three.clock.at(START); run(three); three.clock.resume();
await new Promise((r) => setTimeout(r, 450));
assert.equal(settled(three.journal()).length, 0, "nothing is emitted until something reads or ticks");
await read(three);
const ref = loadTwin("baseline"); ref.clock.pause(); ref.clock.at(START); run(ref); ref.clock.tick(1000);
assert.deepEqual(settled(three.journal()), settled(ref.journal()), "a read on a running clock emits what a tick does, at the same times");
assert.deepEqual(settled(three.journal()), [["X", T(0.2)], ["Y", T(0.3)]], "t = at, in at order");
checks += 3;

// 5. Refusals: an unknown op cannot be scheduled; time cannot move back past the journal; tick needs a number.
assert.throws(() => one.clock.schedule("x", [{ at: T(90), op: "s3.deleteEverything", data: {} }]), /no operation/);
assert.throws(() => one.clock.at(START), /back past the journal/);
assert.throws(() => one.clock.tick("10"), /number of ms/);
checks += 3;
console.log("OK (twin clock: " + checks + " checks; t = at in at order with ties by seq, chains, one tick = many ticks with reads = a read on a running clock, reads never write while paused, refold rebuilds what is owed)");
