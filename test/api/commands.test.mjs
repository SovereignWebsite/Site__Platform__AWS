// The Command console's command table (site/api/commands.json, ux.aws.a design 09 section 7): generated from the
// OpenAPI contracts by docs/dev.2/gen-commands.mjs and current; every row maps to a real operation of its contract and
// to a method of the real API object that takes its path parameters first; every row is x-role read until a change verb
// is designed on purpose. Node 22, no network. Run: node test/api/commands.test.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "../../docs/dev.2/gen-commands.mjs";

const dir = fileURLToPath(new URL("../../site/api/", import.meta.url));
const file = JSON.parse(readFileSync(new URL("../../site/api/commands.json", import.meta.url), "utf8"));
let failures = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };

// Current: the file is what the generator makes from the contracts today.
ok(JSON.stringify(file.commands) === JSON.stringify(build(dir)), "site/api/commands.json is current (run node docs/dev.2/gen-commands.mjs)");
const rows = file.commands;
const docs = readdirSync(dir).filter((f) => f.endsWith(".openapi.json"));
const opCount = docs.reduce((n, f) => n + Object.values(JSON.parse(readFileSync(dir + f, "utf8")).paths).reduce((m, ops) => m + Object.keys(ops).length, 0), 0);
ok(rows.length === opCount && rows.length > 0, "one row per operation: " + rows.length + " rows, " + opCount + " operations in " + docs.length + " contracts");
ok(new Set(rows.map((r) => r.command)).size === rows.length, "commands are unique");
ok(rows.every((r) => /^[a-z0-9]+ [A-Za-z]+$/.test(r.command) && r.command === r.service + " " + r.operationId), "every command is <service> <operationId>, words only");

// Read only, until a change verb is designed on purpose.
ok(rows.every((r) => r.role === "read"), "every row is x-role read: " + rows.filter((r) => r.role !== "read").map((r) => r.command));
ok(rows.every((r) => r.actions.length > 0 && r.actions.every((a) => /^[a-z0-9-]+:(List|Get|Describe|Filter)[A-Za-z]*$/.test(a))), "every row's AWS actions are reads");

// Every row maps to a real operation, and to a method of the API object that takes the path parameters first.
const ctx = { URLSearchParams, URL, Response, Headers, Promise, Error, TypeError, JSON, Object, Array, String, Number, RegExp, Math, Date, TextDecoder, TextEncoder, Uint8Array, crypto: globalThis.crypto };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js")).sort())
  vm.runInContext(readFileSync(dir + f, "utf8"), ctx, { filename: "api/" + f });
const send = () => Promise.reject(new Error("no request in this test"));
for (const r of rows) {
  const doc = JSON.parse(readFileSync(dir + r.doc, "utf8"));
  const op = Object.entries(doc.paths).flatMap(([route, ops]) => Object.values(ops).map((o) => ({ route, o }))).find((x) => x.o.operationId === r.operationId);
  ok(op && doc["x-browser-global"] === r.global, r.command + ": an operation of " + r.doc);
  ok(op && JSON.stringify([...op.route.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])) === JSON.stringify(r.params.map((p) => p.name)), r.command + ": path parameters in the path's order");
  const api = typeof ctx[r.global] === "function" ? ctx[r.global](send, { account: "111122223333" }) : null;
  ok(api && typeof api[r.operationId] === "function", r.command + ": " + r.global + "." + r.operationId + " exists");
  ok(api && api[r.operationId].length >= r.params.length, r.command + ": the method takes its " + r.params.length + " path parameters first (" + (api && api[r.operationId].length) + " arguments)");
}
// And no API method is missing from the table.
for (const g of [...new Set(rows.map((r) => r.global))]) {
  const methods = Object.keys(ctx[g](send, { account: "111122223333" })).sort(), listed = rows.filter((r) => r.global === g).map((r) => r.operationId).sort();
  ok(JSON.stringify(methods) === JSON.stringify(listed), g + ": every method has a row (" + methods + ")");
}

if (failures) { console.error(failures + " failed, " + passed + " passed"); process.exit(1); }
console.log("OK (commands: " + passed + " checks; " + rows.length + " commands from " + docs.length + " contracts, all reads)");
