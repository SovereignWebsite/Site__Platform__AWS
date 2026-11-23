// Swarm replay, first cut: a 2D sky over docs/swarm/data/replay.json. No dependencies.
// The pragmatic engine (moving, jumping, follow the packet) is viz.aws.c's; this view
// owns only the data mapping and plugs into that engine once it exists.
// Every string from the data reaches the page as text (textContent), never as HTML.
"use strict";
(() => {
  const DATA = "../data/replay.json";
  const LIFE = 1.4;                        // replay seconds a flow or flash stays visible
  const $ = (id) => document.getElementById(id);
  const sky = $("sky"), ctx = sky.getContext("2d");
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ms = (t) => Date.parse(t.length === 17 ? t.replace("Z", ":00Z") : t);   // 2026-11-23T03:25Z has no seconds
  const hhmmss = (m) => new Date(m).toISOString().slice(11, 19) + " UTC";

  let maxDepth = 1;
  let agents = new Map(), events = [], R = 0, playing = false, speed = 2, last = 0, picked = null;

  // Time warp: long waits shrink, bursts (sixteen spawns in 21 s) spread out so each is seen.
  function warp(evs) {
    let r = 0, prev = null;
    for (const e of evs) {
      const gap = prev === null ? 0 : (e.ms - prev) / 1000;
      r += prev === null ? 0 : Math.min(2.0, Math.max(0.15, gap / 40));
      e.r = r; prev = e.ms;
    }
    return r + LIFE;
  }

  // Layout: rings by depth from the agents with no parent, each child near its parent's angle.
  function layout() {
    const kids = new Map(), roots = [];
    for (const a of agents.values()) {
      if (a.parent && agents.has(a.parent)) (kids.get(a.parent) || kids.set(a.parent, []).get(a.parent)).push(a);
      else roots.push(a);
    }
    const leaves = (a) => (kids.get(a.id) || []).reduce((n, k) => n + leaves(k), 0) || 1;
    const place = (a, depth, from, to) => {
      a.depth = depth; a.angle = (from + to) / 2;
      let at = from; const total = leaves(a);
      for (const k of kids.get(a.id) || []) { const span = (to - from) * leaves(k) / total; place(k, depth + 1, at, at + span); at += span; }
    };
    const total = roots.reduce((n, a) => n + leaves(a), 0);
    let at = -Math.PI / 2;
    const deep = (a) => 1 + Math.max(0, ...(kids.get(a.id) || []).map(deep));
    maxDepth = Math.max(1, ...roots.map(deep)) - 1;
    for (const a of roots) { const span = 2 * Math.PI * leaves(a) / total; place(a, 0, at, at + span); at += span; }
  }

  function pos(a) {
    const w = sky.width, h = sky.height, ring = Math.min(w, h) * 0.47 / (maxDepth + 0.6);
    const rad = a.depth === 0 && [...agents.values()].filter((b) => b.depth === 0).length === 1 ? 0 : (a.depth + 0.6) * ring;
    return [w / 2 + rad * Math.cos(a.angle) * (w / h) * 0.95, h / 2 + rad * Math.sin(a.angle)];
  }

  function visible(a) { return a.appear === null || R >= a.appear; }

  function draw() {
    const w = sky.width, h = sky.height, teal = css("--teal"), red = css("--red"), gold = css("--gold"), fg = css("--fg"), dim = css("--dim"), line = css("--line");
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    for (const a of agents.values()) {                            // parent links, faint
      const p = agents.get(a.parent);
      if (!p || !visible(a) || !visible(p)) continue;
      const [x1, y1] = pos(p), [x2, y2] = pos(a);
      ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    const end = R >= events[events.length - 1].r;
    for (const e of events) {                                    // flows and flashes alive now
      const age = R - e.r;
      if (age < 0 || age > LIFE) continue;
      const k = age / LIFE;
      if (e.type === "commit" || e.type === "wake") {
        const a = agents.get(e.agent); if (!a) continue;
        const [x, y] = pos(a);
        ctx.strokeStyle = e.type === "commit" ? gold : teal; ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.arc(x, y, 8 + 22 * k, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1;
      } else {
        const a = agents.get(e.from), b = agents.get(e.to); if (!a || !b) continue;
        const [x1, y1] = pos(a), [x2, y2] = pos(b);
        ctx.strokeStyle = e.type === "handoff" || e.type === "move" ? gold : teal; ctx.globalAlpha = 0.6 * (1 - k);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, 3.5, 0, 2 * Math.PI); ctx.fill();
      }
    }
    ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
    for (const a of agents.values()) {                            // bodies: size grows with commits so far
      if (!visible(a)) continue;
      const [x, y] = pos(a), n = a.commitsAt.filter((r) => r <= R).length;
      ctx.fillStyle = end && a.status === "blocked" ? red : teal;
      ctx.beginPath(); ctx.arc(x, y, 5 + Math.sqrt(n) * 2.5, 0, 2 * Math.PI); ctx.fill();
      if (a === picked) { ctx.strokeStyle = fg; ctx.beginPath(); ctx.arc(x, y, 14 + Math.sqrt(n) * 2.5, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.fillStyle = a.account === "a" ? gold : dim; ctx.fillText(a.id, x, y - 10 - Math.sqrt(n) * 2.5);
    }
  }

  function clockAt(r) {
    let i = 0; while (i + 1 < events.length && events[i + 1].r <= r) i++;
    return { i, ms: events[i].ms };
  }

  function update() {
    const { i, ms: now } = clockAt(R), e = events[i];
    $("clock").textContent = hhmmss(now);
    const shown = [...agents.values()].filter(visible).length;
    const commits = events.filter((x) => x.type === "commit" && x.r <= R).length;
    $("counts").textContent = `${shown} agents, ${commits} commits`;
    const who = e.agent || e.from || "";
    const what = e.subject || e.note || e.topic || (e.type === "spawn" ? `starts ${e.to}` : e.type === "move" ? `moves to account A as ${e.to}` : e.type === "message" ? `to ${e.to}` : "");
    $("caption").textContent = `${who ? who + ": " : ""}${what}`;
    $("scrub").value = String(Math.round((R / total) * 1000));
    rows.forEach((tr, j) => { tr.className = j < i ? "past" : j === i ? "now" : ""; });
    draw();
  }

  let total = 1, rows = [];
  function frame(t) {
    if (playing) { R = Math.min(total, R + ((t - last) / 1000) * speed); if (R >= total) { playing = false; $("play").textContent = "Replay"; } }
    last = t; update();
    if (playing) requestAnimationFrame(frame);
  }

  function cell(tr, text) { const td = document.createElement("td"); td.textContent = text || ""; tr.appendChild(td); }

  function load(data) {
    const since = ms(data.since);
    for (const a of data.agents) agents.set(a.id, { ...a, appear: null, commitsAt: [], account: (a.id.match(/\.([a-z])$/) || [])[1] });
    events = data.events.map((e) => ({ ...e, ms: ms(e.t) })).filter((e) => e.ms >= since).sort((x, y) => x.ms - y.ms);
    for (const e of events) for (const id of [e.agent, e.from, e.to]) if (id && !agents.has(id)) agents.set(id, { id, parent: null, appear: null, commitsAt: [], account: (id.match(/\.([a-z])$/) || [])[1] });
    total = warp(events);
    for (const e of events) {
      if ((e.type === "spawn" || e.type === "move") && agents.get(e.to).appear === null) agents.get(e.to).appear = e.r;
      if (e.type === "move") agents.get(e.to).parent = e.from;        // account A body hangs off the C role it replaces
      if (e.type === "commit" && agents.has(e.agent)) agents.get(e.agent).commitsAt.push(e.r);
    }
    layout();
    const body = $("rows");
    for (const e of events) {
      const tr = document.createElement("tr");
      cell(tr, hhmmss(e.ms).slice(0, 8)); cell(tr, e.type); cell(tr, e.agent || e.from); cell(tr, e.to);
      cell(tr, e.subject || e.note || e.topic || (e.type === "move" ? "moves from account C to account A" : e.sha || ""));
      body.appendChild(tr); rows.push(tr);
    }
    update();
  }

  function pick(ev) {
    const box = sky.getBoundingClientRect(), x = (ev.clientX - box.left) * sky.width / box.width, y = (ev.clientY - box.top) * sky.height / box.height;
    let best = null, bd = 400;
    for (const a of agents.values()) { if (!visible(a)) continue; const [ax, ay] = pos(a), d = (ax - x) ** 2 + (ay - y) ** 2; if (d < bd) { bd = d; best = a; } }
    picked = best; $("detail").hidden = !best; if (!best) return update();
    $("d-name").textContent = best.id;
    const dl = $("d-fields"); dl.replaceChildren();
    for (const [k, v] of [["started by", best.moved_from ? null : best.parent], ["took over from", best.moved_from], ["born", best.born], ["wake", best.cron], ["lane asked", (best.lane_requested || []).join(", ")], ["lane granted", (best.lane_granted || []).join(", ") || "none yet"], ["status at snapshot", best.status]]) {
      if (!v) continue; const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; dl.append(dt, dd);
    }
    const ol = $("d-commits"); ol.replaceChildren();
    for (const e of events) if (e.type === "commit" && e.agent === best.id) { const li = document.createElement("li"); li.textContent = `${e.sha} ${e.subject}`; ol.appendChild(li); }
    update();
  }

  $("play").addEventListener("click", () => { if (R >= total) R = 0; playing = !playing; $("play").textContent = playing ? "Pause" : "Play"; if (playing) { last = performance.now(); requestAnimationFrame(frame); } });
  $("scrub").addEventListener("input", (e) => { R = (Number(e.target.value) / 1000) * total; update(); });
  $("speed").addEventListener("change", (e) => { speed = Number(e.target.value); });
  sky.addEventListener("click", pick);

  fetch(DATA).then((r) => r.json()).then(load).catch(() => { $("caption").textContent = "Could not load ../data/replay.json. Serve the repository over HTTP (python3 -m http.server) and open docs/swarm/view/."; });
})();
