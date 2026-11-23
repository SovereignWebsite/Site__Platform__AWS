// The swarm as steps: replay.json's events in the shape viz.aws.a's engine plays.
// swarm.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Same step shape as docs/viz/steps.mjs on work/viz.aws.a:
//   { i, t, from, to, kind, title, text, fields }, plus gap only where the record is missing something.
// Pure function, no network, no DOM. A travel is from != to (start, move, hand-over, message);
// a pulse is from == to (commit, wake). t is replay seconds: long waits shrink, bursts spread out,
// so sixteen starts in 21 s are each seen and an hour of quiet is not sat through.

const TRAVEL = new Set(["spawn", "move", "handoff", "message"]);
const TITLE = { spawn: "Start", move: "Move", handoff: "Hand-over", message: "Message", commit: "Commit", wake: "Wake", note: "Note" };

const ms = (t) => Date.parse(t.length === 17 ? t.replace("Z", ":00Z") : t);   // 2026-11-23T03:25Z has no seconds

export function warp(gapSeconds) {
  return Math.min(2.0, Math.max(0.15, gapSeconds / 40));
}

function describe(e) {
  switch (e.type) {
    case "spawn": return (e.from || "Someone") + " starts " + e.to;
    case "move": return e.from + " moves to account A as " + e.to;
    case "handoff": return "the keeper " + e.to + " lands work by " + e.from + " (" + e.sha + ")";
    case "message": return e.from + " to " + e.to + (e.topic ? ": " + e.topic : "");
    case "commit": return e.subject + (e.signature && e.signature !== "own key" ? " [signature: " + e.signature + "]" : "");
    default: return e.note || "";
  }
}

export function stepsFrom(replay, opts = {}) {
  const since = ms(opts.since || replay.since);
  const evs = replay.events.map((e) => ({ ...e, ms: ms(e.t) })).filter((e) => e.ms >= since && TITLE[e.type])
    .sort((a, b) => a.ms - b.ms);
  const out = [];
  let t = 0, prev = null;
  for (const e of evs) {
    if (prev !== null) t += warp((e.ms - prev) / 1000);
    prev = e.ms;
    const who = e.agent || e.from || null;
    const step = { i: out.length + 1, t: +t.toFixed(3), from: who, to: TRAVEL.has(e.type) ? e.to : who,
                   kind: e.type, title: TITLE[e.type], text: describe(e),
                   fields: { at: e.t, ...(e.sha ? { sha: e.sha } : {}), ...(e.branch ? { branch: e.branch } : {}),
                             ...(e.signature ? { signature: e.signature } : {}), ...(e.source ? { source: e.source } : {}) } };
    if (e.type === "spawn" && !e.from) step.gap = "who started it is not in the session records";
    if (e.type === "commit" && !e.agent) step.gap = "no Agent: trailer";
    out.push(step);
  }
  return out;
}

// One line of text per step, as in docs/viz/steps.mjs: the same story without the picture.
export function asText(steps) {
  return steps.map((s) => s.i + ". " + s.fields.at + " " + s.title + ": " + s.text + (s.gap ? " (" + s.gap + ")" : ""));
}
