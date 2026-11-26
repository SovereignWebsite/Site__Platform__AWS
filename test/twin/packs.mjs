// The twin's demo packs as tests hand them to twin.js (design 02 step 2): site/twin/packs/<id>.json read from disk,
// as { <id>: pack }. A harness that runs twin.js alone sets window.AwsTwinPacks = packsFromDisk() before it runs,
// so the twin needs no fetch (in the page it fetches the same files, same origin).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "site", "twin", "packs");
export function packsFromDisk() {
  const out = {};
  for (const f of fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith(".json") && f !== "index.json").sort())
    out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, f), "utf8"));
  return out;
}
