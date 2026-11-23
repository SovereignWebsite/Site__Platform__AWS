// Builds the decision video (studio-storyboard/0 player) from the presentation.
// node build-video.mjs <path to Site__Agent__Studio checkout at 74ed159>
// Inputs: decisions-brief.html (the presentation; its scenes are the visuals),
//         decisions.storyboard.json (beats and decisions), the studio's default-yes player.
// Output: decision-video.html. Local files only; no network.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const studio = process.argv[2];
if (!studio) { console.error('usage: node build-video.mjs <Site__Agent__Studio checkout>'); process.exit(2); }
const player = readFileSync(path.join(studio, 'site/accounts/d/briefings/default-yes/index.html'), 'utf8');
// Optional: node build-video.mjs <studio> [brief.html] [storyboard.json] [out.html]
const briefFile = process.argv[3] || 'decisions-brief.html', sbFile = process.argv[4] || 'decisions.storyboard.json', outFile = process.argv[5] || 'decision-video.html';
const sb = JSON.parse(readFileSync(path.join(here, sbFile), 'utf8'));
const brief = readFileSync(path.join(here, briefFile), 'utf8');

const words = s => s.trim().split(/\s+/).length;
const secs = b => Math.max(2.5, words(b.narration) / 2.5);   // the player's own pace

const pres = JSON.parse(brief.match(/<script type="application\/json" id="storyboard">([\s\S]*?)<\/script>/)[1]);
const durOf = Object.fromEntries(pres.scenes.map(s => [s.id, s.dur]));
const plan = sb.beats.map(b => [b.visual.src, secs(b) / durOf[b.visual.src]]);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('**/*', r => r.request().url().startsWith('file:') || r.request().url().startsWith('data:') ? r.continue() : r.abort());
const tmp = path.join(here, '.brief-tmp.html');
writeFileSync(tmp, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + brief + '</body></html>');
await page.goto('file://' + tmp);
const SVGS = await page.evaluate((plan) => {
  const out = {};
  const style = `<style>
.awsd{--ink:#15202e;--mute:#5b6878;--line:#c9d1db;--paper:#ffffff;--chip:#e6ebf0;--accent:#c47a12;--risk:#b4322a;--ok:#11786b;--hold:#6b5bb5;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){.awsd{--ink:#e4e9ef;--mute:#93a0b0;--line:#2f3b4a;--paper:#16212a;--chip:#223040;--accent:#e9a43c;--risk:#ec6b5f;--ok:#3fbfa9;--hold:#a596f0}}
.awsd text{fill:var(--ink)}.awsd .t-s{font-size:13px}.awsd .t-m{font-size:16px;font-weight:600}.awsd .t-l{font-size:24px;font-weight:800}.awsd .t-xl{font-size:44px;font-weight:800}
.awsd .t-mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}.awsd .t-mute{fill:var(--mute)}.awsd .t-risk{fill:var(--risk)}.awsd .t-ok{fill:var(--ok)}.awsd .t-acc{fill:var(--accent)}
.awsd .bx{fill:var(--paper);stroke:var(--line);stroke-width:1.5}
.awsd .bx-risk{fill:color-mix(in srgb,var(--risk) 10%,var(--paper));stroke:var(--risk);stroke-width:2}
.awsd .bx-ok{fill:color-mix(in srgb,var(--ok) 10%,var(--paper));stroke:var(--ok);stroke-width:2}
.awsd .bx-acc{fill:color-mix(in srgb,var(--accent) 12%,var(--paper));stroke:var(--accent);stroke-width:2}
.awsd .bx-hold{fill:color-mix(in srgb,var(--hold) 10%,var(--paper));stroke:var(--hold);stroke-width:2}
.awsd .bx-ghost{fill:none;stroke:var(--line);stroke-width:1.5;stroke-dasharray:6 5}
.awsd .fill-ink{fill:var(--ink)}.awsd .fill-risk{fill:var(--risk)}.awsd .fill-ok{fill:var(--ok)}.awsd .fill-acc{fill:var(--accent)}.awsd .fill-hold{fill:var(--hold)}
.awsd .ln{fill:none;stroke:var(--mute);stroke-width:2}.awsd .ln-risk{fill:none;stroke:var(--risk);stroke-width:2.5}.awsd .ln-ok{fill:none;stroke:var(--ok);stroke-width:2.5}.awsd .dash{stroke-dasharray:7 6}
</style>`;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  for (const [id, scale] of plan) {
    const host = document.createElement('div');
    host.innerHTML = window.__brief.svgFor(id);
    const sv = host.firstElementChild;
    sv.setAttribute('class', 'awsd');
    sv.insertAdjacentHTML('afterbegin', style);
    const T = x => (x * scale).toFixed(2) + 's';
    sv.querySelectorAll('[data-t]').forEach(g => {
      g.removeAttribute('class'); g.setAttribute('opacity', '0');
      g.append(mk('animate', { attributeName: 'opacity', from: '0', to: '1', begin: T(+g.dataset.t), dur: '0.35s', fill: 'freeze' }));
      if (g.dataset.off !== undefined) g.append(mk('set', { attributeName: 'opacity', to: '0', begin: T(+g.dataset.off), fill: 'freeze' }));
    });
    sv.querySelectorAll('[data-d0]').forEach(p => {
      const d0 = +p.dataset.d0, d1 = +p.dataset.d1;
      p.classList.remove('draw'); p.setAttribute('stroke-dasharray', '1 1'); p.setAttribute('stroke-dashoffset', '1');
      p.append(mk('animate', { attributeName: 'stroke-dashoffset', from: '1', to: '0', begin: T(d0), dur: T(d1 - d0), fill: 'freeze' }));
    });
    sv.querySelectorAll('[data-m]').forEach(g => {
      const m0 = +g.dataset.m0, m1 = +g.dataset.m1, hold = g.dataset.hold !== undefined;
      g.removeAttribute('transform'); g.removeAttribute('style');
      const kt = (m0 / m1).toFixed(4);
      const am = mk('animateMotion', { begin: '0s', dur: T(m1), fill: 'freeze', calcMode: 'spline', keyTimes: `0;${kt};1`, keyPoints: '0;0;1', keySplines: '0 0 1 1;.42 0 .58 1' });
      const mp = mk('mpath', { href: '#' + g.dataset.m }); am.append(mp); g.append(am);
      if (!hold) { g.setAttribute('opacity', '0'); g.append(mk('set', { attributeName: 'opacity', to: '1', begin: T(m0), fill: 'freeze' })); }
      if (g.dataset.mh) g.append(mk('set', { attributeName: 'opacity', to: '0', begin: T(m1), fill: 'freeze' }));
    });
    sv.querySelectorAll('*').forEach(e => [...e.attributes].forEach(a => { if (a.name.startsWith('data-')) e.removeAttribute(a.name); }));
    sv.removeAttribute('role'); sv.setAttribute('role', 'img');
    out[id] = sv.outerHTML;
  }
  return out;
}, plan);
await browser.close();
try { (await import('node:fs')).unlinkSync(tmp); } catch {}

for (const b of sb.beats) {
  const s = secs(b);
  b.visual.at = 0; b.visual.play = +(s + 0.6).toFixed(1); b.visual.end = +s.toFixed(2);
}
const sbText = JSON.stringify(sb).replace(/</g, '\\u003c');
const svgText = JSON.stringify(SVGS).replace(/</g, '\\u003c');  // every '<' escaped, so nothing in the SVGs can end or confuse the script block
let out = player
  .replace(/<title>[^<]*<\/title>/, () => `<title>${sb.title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</title>`)
  .replace(/<script id="sb" type="application\/json">[\s\S]*?<\/script>/, () => `<script id="sb" type="application/json">${sbText}</script>`)
  .replace(/<script id="svgs" type="application\/json">[\s\S]*?<\/script>/, () => `<script id="svgs" type="application/json">${svgText}</script>`);
// First change to the studio's player: when paused, an SVG beat shows its final frame (v.end), not its first.
const before = "const at=v.at!=null?v.at:(v.seek||0);try{sv.pauseAnimations();sv.setCurrentTime(at);if(v.play){";
if (!out.includes(before)) throw new Error('player changed: patch point not found');
out = out.replace(before, "const at=(!playing&&v.end!=null)?v.end:(v.at!=null?v.at:(v.seek||0));try{sv.pauseAnimations();sv.setCurrentTime(at);if(v.play&&playing){");
// Second change: Play restarts the current beat, so its animation runs from the start.
const playBefore = "if(p)speak(i);else{";
if (!out.includes(playBefore)) throw new Error('player changed: play patch point not found');
out = out.replace(playBefore, "if(p)show(i);else{");
writeFileSync(path.join(here, outFile), out);
writeFileSync(path.join(here, sbFile), JSON.stringify(sb, null, 1) + '\n');
console.log(outFile, out.length, 'bytes;', sb.beats.length, 'beats;', Math.round(sb.beats.reduce((a, b) => a + secs(b) + 0.8, 0)), 's');
