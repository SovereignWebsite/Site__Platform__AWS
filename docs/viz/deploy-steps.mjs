// Watch a deployment happen: a stack's events become the steps the player plays (docs/viz/player.mjs).
// viz.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Step 7 of docs/team/plan-vault-deploy.md (conductor.aws.a).
// Input: CfnApi(region).events(name) as cloudformation.aws.a designed it
//   (docs/cloudformation/2026-11-23__seed-and-read-api.md): [{ time, logicalId, type, status, reason }], newest first.
// Optional: a DNS check result { name, answers: [..] } once the record answers. Pure: no network, no DOM.
// A resource is a station; the stack is the hub. A CREATE_IN_PROGRESS travels from the stack to the resource,
// a *_COMPLETE or *_FAILED pulses at it. Status words are AWS's own (ResourceStatus).

const PHASE = (s) => /_FAILED$/.test(s) ? "failed" : /_COMPLETE$/.test(s) ? "done" : /_IN_PROGRESS$/.test(s) ? "working" : "other";
const VERB = { CREATE: "creating", UPDATE: "updating", DELETE: "deleting", ROLLBACK: "rolling back", IMPORT: "importing" };

export function deploySteps(events, opts = {}) {
  const stack = opts.stack || "stack";
  const list = [...events].map((e) => ({ ...e, ms: Date.parse(e.time) })).filter((e) => !isNaN(e.ms)).sort((a, b) => a.ms - b.ms);
  if (!list.length) return [];
  const t0 = list[0].ms, scale = opts.secondsPerSecond || 1;   // 1 = real time; the player's speed control does the rest
  const out = [];
  const add = (s) => out.push({ i: out.length + 1, ...s });
  for (const e of list) {
    const isStack = e.type === "AWS::CloudFormation::Stack";
    const station = isStack ? "stack" : e.logicalId;
    const phase = PHASE(e.status), op = e.status.split("_")[0];
    const working = phase === "working";
    add({
      t: +((e.ms - t0) / 1000 / scale).toFixed(3),
      from: isStack || !working ? station : "stack",
      to: station,
      kind: phase,
      title: isStack ? "Stack" : e.logicalId,
      text: (isStack ? stack : e.logicalId + " (" + e.type + ")") + ": " + (working ? (VERB[op] || op.toLowerCase()) : e.status.replace(/_/g, " ").toLowerCase()) + (e.reason ? ", " + e.reason : ""),
      fields: { time: e.time, logicalId: e.logicalId, type: e.type, status: e.status, ...(e.reason ? { reason: e.reason } : {}) }
    });
  }
  if (opts.dns) {
    const live = Array.isArray(opts.dns.answers) && opts.dns.answers.length > 0;
    const last = out[out.length - 1];
    add({ t: +(last.t + 1).toFixed(3), from: "stack", to: "dns", kind: live ? "done" : "waiting", title: "DNS",
      text: opts.dns.name + (live ? " answers: " + opts.dns.answers.join(", ") : " does not answer yet"),
      fields: { name: opts.dns.name, answers: opts.dns.answers || [] } });
  }
  return out;
}

// The board beside the scene: each resource's latest state, in the order it first appeared. Same data, as a list.
export function boardAt(steps, t) {
  const rows = new Map();
  for (const s of steps) if (s.t <= t) rows.set(s.to, { station: s.to, title: s.title, kind: s.kind, status: s.fields.status || null });
  return [...rows.values()];
}
