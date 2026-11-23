// An in-memory append lane that keeps the behaviour sgit.ai states for /api/vault/append/* (design 02, section 3).
// vaults.aws.a@SovereignWebsite.dinis, 23 Nov 2026. A stand-in for the vault twin until architect.aws.a builds it:
// no network, no encryption (the lane file is plaintext base64 where sgit would write its encrypted envelope).
// Where sgit.ai is silent (success status, response shapes) the choice is marked TC, as in design 02.

const TOKEN = /^[0-9a-f]{16,128}$/;
const FILE_ID = /^\d{13}_[0-9a-f]{24}\.enc$/;
export const LIMITS = { payloadBytes: 5 * 1024 * 1024, pending: 1000, ids: 100, inlineBytes: 3 * 1024 * 1024, pageDefault: 50, pageMax: 200 };

const html404 = () => ({ status: 404, html: "<html><body>Not Found</body></html>" }); // stated: 404 with an HTML page
const bad = (detail) => ({ status: 400, body: { detail } });                            // stated: JSON 400

export function makeLane({ clock = () => Date.now(), rand = Math.random } = {}) {
  const lanes = new Map(); // token -> { pending: Map(id -> file), processed: Map(id -> file) }
  let enumKey = null;
  const hex24 = () => Array.from({ length: 24 }, () => Math.floor(rand() * 16).toString(16)).join("");

  return {
    // configure: write_key plus access token on the real server; here only the parts the example needs.
    configure({ tokens, enum_key }) {
      enumKey = enum_key;
      for (const t of tokens) if (!lanes.has(t)) lanes.set(t, { pending: new Map(), processed: new Map() });
      return { status: 200, body: { ok: true } }; // TC
    },
    write({ append_token, payload } = {}) {
      if (append_token === undefined || payload === undefined) return bad("missing field");
      if (!TOKEN.test(append_token)) return bad("append_token must be hex");
      const lane = lanes.get(append_token);
      if (!lane) return html404();
      if (Buffer.byteLength(payload, "utf8") > LIMITS.payloadBytes) return { status: 413, body: { detail: "payload over 5 MB" } };
      if (lane.pending.size >= LIMITS.pending) return { status: 507, body: { detail: "lane full" } };
      const id = String(clock()).padStart(13, "0") + "_" + hex24() + ".enc";
      lane.pending.set(id, Buffer.from(payload, "base64").toString("utf8")); // the .enc file's bytes
      return { status: 200, body: { ok: true } }; // stated body, exactly; status TC
    },
    list({ key, inbox, include_content = false, after_file_id = null, page_size } = {}) {
      if (key !== enumKey) return html404();
      const size = Math.min(Math.max(1, page_size || LIMITS.pageDefault), LIMITS.pageMax); // clamped silently
      const rows = [];
      for (const [token, lane] of lanes) if (!inbox || inbox === token) for (const [id, file] of lane.pending) rows.push({ inbox: token, file_id: id, file });
      rows.sort((a, b) => (a.file_id < b.file_id ? -1 : 1));
      const from = after_file_id ? rows.findIndex((r) => r.file_id === after_file_id) + 1 : 0;
      const page = rows.slice(from, from + size);
      let inline = 0;
      const entries = page.map((r) => {
        const e = { inbox: r.inbox, file_id: r.file_id }; // TC beyond `inbox`
        if (include_content) { inline += Buffer.byteLength(r.file, "utf8"); e.content = Buffer.from(r.file, "utf8").toString("base64"); }
        return e;
      });
      if (inline > LIMITS.inlineBytes) return { status: 413, body: { detail: "inline content over 3 MB" } };
      return { status: 200, body: { entries } };
    },
    fetch({ key, inbox, file_ids } = {}) {
      if (key !== enumKey) return html404();
      if (!inbox || !Array.isArray(file_ids)) return bad("missing field");
      if (file_ids.length > LIMITS.ids) return bad("over 100 file ids");
      if (file_ids.some((f) => !FILE_ID.test(f))) return bad("malformed file id");
      const lane = lanes.get(inbox);
      if (!lane) return html404();
      // Pending only: a processed file cannot be fetched again (stated).
      const files = file_ids.filter((f) => lane.pending.has(f)).map((f) => ({ file_id: f, content: Buffer.from(lane.pending.get(f), "utf8").toString("base64") }));
      return { status: 200, body: { files } }; // TC shape; `content` implied by sgit.ai's decode example
    },
    markProcessed({ key, inbox, file_ids } = {}) {
      if (key !== enumKey) return html404();
      if (!inbox || !Array.isArray(file_ids)) return bad("missing field");
      if (file_ids.length > LIMITS.ids) return bad("over 100 file ids");
      const lane = lanes.get(inbox);
      if (!lane) return html404();
      const moved = [], missing = [];
      for (const f of file_ids) {
        if (lane.pending.has(f)) { lane.processed.set(f, lane.pending.get(f)); lane.pending.delete(f); moved.push(f); } else missing.push(f); // stated: `missing`, not an error
      }
      return { status: 200, body: { moved, missing } };
    },
    purge({ inbox, folder } = {}) {
      if (folder !== "pending" && folder !== "processed") return bad("unknown folder"); // stated: "inbox" is 400
      const lane = lanes.get(inbox);
      if (!lane) return html404();
      lane[folder].clear();
      return { status: 200, body: { ok: true } }; // TC
    },
    sizes(token) { const l = lanes.get(token); return l ? { pending: l.pending.size, processed: l.processed.size } : null; }
  };
}

// The two base64 layers sgit.ai describes: the .enc file is base64 text, and `payload` is base64 of the file's bytes.
export const toPayload = (json) => Buffer.from(Buffer.from(JSON.stringify(json), "utf8").toString("base64"), "utf8").toString("base64");
export const fromContent = (content) => JSON.parse(Buffer.from(Buffer.from(content, "base64").toString("utf8"), "base64").toString("utf8"));
