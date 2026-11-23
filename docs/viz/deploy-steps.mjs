// Watch a deployment happen: a stack's events become the steps the player plays (docs/viz/player.mjs).
// viz.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Step 7 of docs/team/plan-vault-deploy.md (conductor.aws.a).
// Input: CfnApi(region).events(name) as cloudformation.aws.a designed it
//   (docs/cloudformation/2026-11-23__seed-and-read-api.md): [{ time, logicalId, type, status, reason }], newest first.
// Optional: a DNS check result { name, answers: [..] } once the record answers; a health check { url, ok, status };
// labels: ontology.aws.a's docs/ontology/type-labels.json "types" map, so boxes read in plain words. Pure: no network, no DOM.
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
    const lab = (opts.labels || {})[e.type] || null;
    const name = isStack ? stack : lab ? lab.short + " (" + lab.aws + ")" : e.logicalId + " (" + e.type + ")";
    add({
      t: +((e.ms - t0) / 1000 / scale).toFixed(3),
      from: isStack || !working ? station : "stack",
      to: station,
      kind: phase,
      title: isStack ? "Stack" : lab ? lab.short : e.logicalId,
      text: name + ": " + (working ? (VERB[op] || op.toLowerCase()) : e.status.replace(/_/g, " ").toLowerCase()) + (e.reason ? ", " + e.reason : ""),
      fields: { time: e.time, logicalId: e.logicalId, type: e.type, status: e.status, ...(e.reason ? { reason: e.reason } : {}),
        ...(lab ? { label: lab.label, short: lab.short, aws: lab.aws } : {}) }
    });
  }
  if (opts.dns) {
    const live = Array.isArray(opts.dns.answers) && opts.dns.answers.length > 0;
    const last = out[out.length - 1];
    add({ t: +(last.t + 1).toFixed(3), from: "stack", to: "dns", kind: live ? "done" : "waiting", title: "DNS",
      text: opts.dns.name + (live ? " answers: " + opts.dns.answers.join(", ") : " does not answer yet"),
      fields: { name: opts.dns.name, answers: opts.dns.answers || [] } });
  }
  // v1 on real accounts ends with a health check (iam.aws.a's design, 68f4b8b): the Vault answers, or not yet.
  if (opts.health) {
    const last = out[out.length - 1];
    add({ t: +(last.t + 1).toFixed(3), from: opts.dns ? "dns" : "stack", to: "health", kind: opts.health.ok ? "done" : "waiting", title: "Health",
      text: opts.health.url + (opts.health.ok ? " is healthy" : " is not answering yet") + (opts.health.status ? " (HTTP " + opts.health.status + ")" : ""),
      fields: { url: opts.health.url, ok: !!opts.health.ok, ...(opts.health.status ? { status: opts.health.status } : {}) } });
  }
  return out;
}

// The board beside the scene: each resource's latest state, in the order it first appeared. Same data, as a list.
export function boardAt(steps, t) {
  const rows = new Map();
  for (const s of steps) if (s.t <= t) rows.set(s.to, { station: s.to, title: s.title, kind: s.kind, status: s.fields.status || null });
  return [...rows.values()];
}

// The Vault stack's resources in creation waves (cloudformation.aws.a, 0.3.3, 35fa42c; first 0.2.0, 7ea995f;
// docs/cloudformation/vault/vault.yaml). Conditional resources drop out by the customer's choices.
export const VAULT_WAVES = [
  ["VaultBucket", "AccessToken", "VaultLogs", "HealthFunction"],
  ["VaultBucketPolicy", "VaultFunctionRole"],
  ["VaultFunction"],
  ["VaultFunctionUrl", "VaultFunctionUrlPermission", "VaultFunctionInvokePermission"],
  ["VaultDistribution"],
  ["VaultRecordA", "VaultRecordAAAA"]
];
export function vaultWaves({ ownSecret = false, hostedZone = false } = {}) {
  return VAULT_WAVES.map((w) => w.filter((id) => !(ownSecret && id === "AccessToken") && !(!hostedZone && /^VaultRecord/.test(id))))
    .filter((w) => w.length);
}

// "How long is left", without guessing: count against the template's resources (`expected`: a flat list of
// logical ids, or waves as above), and estimate time left only from durations measured on earlier runs
// (`history`: { [logicalId]: seconds }). Waves run one after another, resources in a wave alongside each other.
// With no history for every resource, `left` is null and the page says "N of M ready".
export function progress(steps, t, expected = [], history = null) {
  const board = boardAt(steps, t).filter((r) => !["stack", "dns", "health"].includes(r.station));
  const done = new Set(board.filter((r) => r.kind === "done").map((r) => r.station));
  const failed = board.some((r) => r.kind === "failed");
  const waves = !expected.length ? [board.map((r) => r.station)] : Array.isArray(expected[0]) ? expected : [expected];
  const ids = waves.flat();
  let left = null;
  if (history && ids.every((id) => id in history)) {
    const started = new Map(steps.filter((s) => s.t <= t && s.kind === "working" && s.to !== "stack").map((s) => [s.to, s.t]));
    left = 0;
    for (const w of waves) {
      let wave = 0;
      for (const id of w) if (!done.has(id)) wave = Math.max(wave, history[id] - (started.has(id) ? t - started.get(id) : 0), 0);
      left += wave;
    }
    left = Math.round(left);
  }
  return { ready: ids.filter((id) => done.has(id)).length, total: ids.length, failed, left };
}

// The cost line under the list: billing.aws.a's figures as given, never a price of ours.
// Input: the JSON of `node docs/billing/vault-cost.mjs --json` (land/billing.aws.a 7e3edc4): by_region[region] with
// idle_month, stated_traffic_month, ephemeral_2h_* each { fixed, per_use, total } in USD, plus stated_traffic.
const usd = (v) => v < 0.01 ? "under 1 cent" : "$" + (v < 10 ? v.toFixed(2) : Math.round(v).toString());
export function costLine(cost, region) {
  const r = cost && cost.by_region && cost.by_region[region];
  if (!r) return { text: "Cost for " + region + ": not in billing's figures yet", source: "billing.aws.a" };
  const req = cost.stated_traffic && cost.stated_traffic.requests;
  return {
    text: "Idle, this Vault costs about " + usd(r.idle_month.total) + " a month in " + region +
      (req ? "; with " + req.toLocaleString("en-GB") + " requests an hour, about " + usd(r.stated_traffic_month.total) + " a month" : "") + ".",
    idle: r.idle_month.total, busy: r.stated_traffic_month ? r.stated_traffic_month.total : null,
    twoHoursIdle: r.ephemeral_2h_idle ? r.ephemeral_2h_idle.total : null,
    assumptions: cost.assumptions || [], source: "billing.aws.a (docs/billing/vault-cost.mjs)"
  };
}
