// Captures the seven beats of docs/video/2026-11-23__twin-v0-narrative-plan.md from the site, twin mode only.
// By video.aws.a@SovereignWebsite.dinis. Re-run: serve site/ on 127.0.0.1:8765, then
//   node docs/video/capture-twin-v0.js
// Every request that is not to the local server is aborted (no Google, no AWS), and the run fails if one is tried
// other than Google's sign-in script, which the hub loads and the twin does not need.
// The twin's account id and the real role name it reuses are masked before each capture; the run fails if either
// is still readable on screen. Output: docs/video/twin-v0/b1.png .. b7.png at 1080x1010 (540x505 CSS px at 2x).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.SITE || 'http://127.0.0.1:8765/';
const OUT = path.join(__dirname, 'twin-v0');
// Costs too: studio.c and the plan keep every cost off screen, even a synthetic one.
const SECRET = [/111122223333/g, /sovereignwebsite-factory-dns/g, /\d[\d,]*\.\d{2} USD/g];
const ALLOWED_BLOCKED = ['https://accounts.google.com/gsi/client'];

async function mask(page) {
  await page.evaluate((sources) => {
    const res = sources.map((s) => new RegExp(s, 'g'));
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.parentElement.closest('.cap-mask')) continue;
      if (res.some((r) => { r.lastIndex = 0; return r.test(n.nodeValue); })) hits.push(n);
    }
    for (const n of hits) {
      const frag = document.createDocumentFragment();
      let text = n.nodeValue;
      const all = new RegExp(sources.join('|'), 'g');
      let last = 0;
      for (const m of text.matchAll(all)) {
        frag.append(text.slice(last, m.index));
        const s = document.createElement('span');
        s.className = 'cap-mask';
        s.textContent = m[0];
        s.style.cssText = 'filter:blur(5px);background:currentColor;border-radius:3px;opacity:.35';
        frag.append(s);
        last = m.index + m[0].length;
      }
      frag.append(text.slice(last));
      n.replaceWith(frag);
    }
  }, SECRET.map((r) => r.source));
  for (const r of SECRET) {
    const leaked = await page.evaluate((src) => {
      const re = new RegExp(src);
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.parentElement.closest('.cap-mask')) continue;
        if (n.parentElement.offsetParent !== null && re.test(n.nodeValue)) return n.nodeValue;
      }
      // attributes a viewer can see: input values and placeholders
      for (const el of document.querySelectorAll('input,textarea')) {
        if (el.offsetParent !== null && re.test(el.value || '')) return el.value;
      }
      for (const el of document.querySelectorAll('select')) {
        const t = el.selectedOptions[0]?.textContent || '';
        if (el.offsetParent !== null && re.test(t)) return t;
      }
      return null;
    }, r.source);
    if (leaked) throw new Error(`unmasked on screen: ${leaked.slice(0, 80)}`);
  }
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  await mask(page);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('captured', name);
}

async function openFirstFile(page, bucket, fileRe) {
  await page.click(`#s3-buckets >> text=${bucket}`);
  for (let depth = 0; depth < 10; depth++) {
    await page.waitForTimeout(500);
    const file = page.locator('#s3-list tr.file button').filter({ hasText: fileRe }).first();
    if (await file.count()) { await file.scrollIntoViewIfNeeded(); return file; }
    const folder = page.locator('#s3-list button').filter({ hasText: /\/$/ }).first();
    if (!(await folder.count())) throw new Error(`no ${fileRe} under ${bucket}`);
    await folder.click();
  }
  throw new Error(`too deep looking for ${fileRe}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 540, height: 505 }, deviceScaleFactor: 2 });
  const blocked = [];
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    blocked.push(u);
    return r.abort();
  });

  await page.goto(BASE);
  await shot(page, 'b1.png');                                   // 1 hub, signed out

  await page.click('#twin-enter');
  await page.waitForSelector('#twin-bar:not([hidden])');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'b2.png');                                   // 2 the twin bar

  await page.click('#tab-accounts');
  await page.locator('#accounts > li').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'b3.png');                                   // 3 the account, read role, one-hour credentials

  await page.click('#tab-s3');
  await page.click('#s3-list-buckets');
  await page.waitForSelector('#s3-buckets li');
  await page.locator('#step4').scrollIntoViewIfNeeded();
  await shot(page, 'b4.png');                                   // 4 bucket list

  const zip = await openFirstFile(page, 'lambda-deps', /\.zip$/);
  await zip.click();
  await page.waitForTimeout(1200);
  await page.locator('#s3-file').scrollIntoViewIfNeeded();
  await shot(page, 'b5.png');                                   // 5 a zip, entries listed without downloading it all

  await page.click('#s3-list-buckets');
  await page.waitForSelector('#s3-buckets li');
  const gz = await openFirstFile(page, 'cloudfront-logs', /\.gz$/);
  await gz.click();
  await page.waitForTimeout(1200);
  await page.locator('#s3-file').scrollIntoViewIfNeeded();
  await shot(page, 'b6.png');                                   // 6 a compressed log, unpacked and formatted

  await page.click('#twin-leave');
  await page.waitForSelector('#twin-enter', { state: 'visible' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'b7.png');                                   // 7 back on the hub, sign-in

  await browser.close();
  const unexpected = blocked.filter((u) => !ALLOWED_BLOCKED.includes(u));
  if (unexpected.length) throw new Error(`requests outside the local site were tried: ${unexpected.join(', ')}`);
  console.log('ok; blocked as expected:', [...new Set(blocked)].join(', ') || 'none');
})().catch((e) => { console.error(e.message); process.exit(1); });
