// Checks docs/billing/prices.json: every price has a known source, a unit, and a number or a quote to back it.
// billing.aws.c@SovereignWebsite.dinis. Run: node docs/billing/check-prices.mjs  (prints OK or the problems)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const book = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "prices.json"), "utf8"));
const bad = [];
const ids = new Set();
for (const p of book.prices) {
  if (!p.id || ids.has(p.id)) bad.push("missing or repeated id: " + p.id);
  ids.add(p.id);
  if (!book.sources[p.source]) bad.push(p.id + ": source '" + p.source + "' not in sources");
  if (p.quote_source && !book.sources[p.quote_source]) bad.push(p.id + ": quote_source not in sources");
  if (!p.unit) bad.push(p.id + ": no unit");
  if (!p.label && !p.quote) bad.push(p.id + ": no label or quote from the page");
  const nums = [p.global, ...Object.keys(book.regions).map((r) => p[r])].filter((v) => v !== undefined);
  if (!nums.length && !p.free && !p.plans) bad.push(p.id + ": no price");
  for (const v of nums) if (typeof v !== "number" || v < 0) bad.push(p.id + ": price is not a number >= 0");
  if (/_data$/.test(p.source) && !p.label) bad.push(p.id + ": a data-file price needs the exact label from the file");
}
for (const [k, s] of Object.entries(book.sources)) {
  const url = typeof s === "string" ? s : s.url;
  if (!/^https:\/\/(aws\.amazon\.com|b0\.p\.awsstatic\.com)\//.test(url)) bad.push("source " + k + " is not an AWS public pricing address");
}
console.log(bad.length ? bad.join("\n") : `OK (${book.prices.length} prices, all cited)`);
process.exit(bad.length ? 1 : 0);
