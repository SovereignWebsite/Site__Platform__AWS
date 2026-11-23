// The player: plays any list of steps { i, t, from, to, kind, ... } (docs/viz/steps.mjs, docs/swarm/steps.mjs).
// viz.aws.a@SovereignWebsite.dinis, 23 Nov 2026. Motion only, no drawing and no DOM: a renderer asks frame(t)
// and draws what it gets. A travel (from != to) moves a sprite from one station to the next over its duration;
// a pulse (from == to) glows at one station. Duration of step n is t[n+1] - t[n]; the last step gets `tail` seconds.
// The clock is passed in (now(), in seconds), so tests drive it and the page uses performance.now() / 1000.

export const SPEEDS = [0.25, 1, 4, 16];

export function createPlayer(steps, opts = {}) {
  const list = [...steps].sort((a, b) => a.t - b.t);
  const tail = opts.tail ?? 0.5;
  const now = opts.now || (() => 0);
  const ends = list.map((s, n) => (n + 1 < list.length ? list[n + 1].t : s.t + tail));
  const duration = list.length ? ends[ends.length - 1] : 0;
  let pos = 0, speed = 1, playing = false, since = 0;

  const clock = () => (playing ? Math.min(duration, pos + (now() - since) * speed) : pos);
  const freeze = () => { pos = clock(); since = now(); };
  const index = (t) => { let n = -1; for (let k = 0; k < list.length && list[k].t <= t; k++) n = k; return n; };
  const clamp = (t) => Math.max(0, Math.min(duration, t));

  function frame(t = clock()) {
    const n = index(t);
    if (n < 0) return { t, index: -1, step: null, progress: 0, pulse: false, done: false };
    const s = list[n], span = ends[n] - s.t;
    const progress = span > 0 ? Math.min(1, (t - s.t) / span) : 1;
    return { t, index: n, step: s, progress, pulse: s.from === s.to, done: t >= duration };
  }

  return {
    get duration() { return duration; },
    get speed() { return speed; },
    get playing() { return playing && clock() < duration; },
    steps: list,
    frame,
    play() { if (clock() >= duration) pos = 0; since = now(); playing = true; },
    pause() { freeze(); playing = false; },
    setSpeed(x) { if (!SPEEDS.includes(x)) throw new Error("Speed must be one of " + SPEEDS.join(", ")); freeze(); speed = x; },
    seek(t) { pos = clamp(t); since = now(); },
    goTo(i) { const n = list.findIndex((s) => s.i === i); if (n < 0) throw new Error("No step " + i); this.seek(list[n].t); },
    next() { const n = index(clock()); if (n + 1 < list.length) this.seek(list[n + 1].t); },
    // Back: to the start of the current step if well into it (a quarter of its span, at most 0.05 s), else the one before.
    prev() { const t = clock(), n = index(t); if (n < 0) return; const into = t - list[n].t, grace = Math.min(0.05, (ends[n] - list[n].t) / 4);
      this.seek(into > grace || n === 0 ? list[n].t : list[n - 1].t); }
  };
}
