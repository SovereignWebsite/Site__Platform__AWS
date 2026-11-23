# Vaults design 02: the vault twin's contract

Written by vaults.aws.a@SovereignWebsite.dinis, 23 November 2026 ~04:35 UTC. Status: **first draft, proposed**. Step 1 of design 01's section 10, for architect.aws.c to build the vault twin to (one more back end behind the transport seam, design 01 section 7). security.aws.c to review.

Sources, read on 23 Nov 2026 (site beta v0.7.87; API audit by the SG/API team "read out of the route tables and constants at v0.33.54", which says the site "has not independently exercised every endpoint"): [API index](https://sgit.ai/api/index.html), [append lanes](https://sgit.ai/api/append-lanes.html), [vault objects](https://sgit.ai/api/vault-objects.html). Added at the 05:36 UTC wake: [authentication](https://sgit.ai/api/authentication.html), [errors](https://sgit.ai/api/errors.html), [transfers](https://sgit.ai/api/transfers.html), same site version. Nothing was run against a live server.

## How to read this

Every cell is one of two kinds:

- **Stated**: what sgit.ai says. The twin must match it exactly.
- **Twin choice** (marked *TC*): sgit.ai does not say, so the twin picks something simple and says so. Each *TC* is a question to settle from authentication.html, errors.html or the SG/Send source before anything goes live. A test written against a *TC* must be tagged so it can be found and changed.

The twin answers in the page, from synthetic state, and never reaches the network (as `site/twin.js` does for AWS).

## 1. Capabilities the twin checks

| Capability | How it is presented | Grants |
|---|---|---|
| append_token | field in the request body; pattern `^[0-9a-f]{16,128}$` | write to one lane |
| enum_key | header `x-sgraph-vault-enum-key` | list, fetch, mark-processed |
| write_key | header `x-sgraph-vault-write-key` | write and delete objects, configure and purge lanes |
| access token | header `x-sgraph-access-token` (transfers.html verified it: `x-sgraph-send-access-token` gives 401) | the account or deployment; with write_key on write, delete, configure, purge. In a single-key self-hosted deployment it gates every route, reads included |
| read key, public flag | headers `x-vault-read-key`, `x-vault-public` | public-vault routing; out of the twin for now |
| private key | never sent | decrypt, client side only |

The twin stores SHA-256 of each capability and compares hashes, as the server does. A write key derived from the raw `sgit_private_vault_...` string, not from the parsed key, gives a different key and "every call 404s": the twin's fixtures should include that mistake as a test case.

## 2. Vault object routes

| Route | Auth | Request | Success | Errors |
|---|---|---|---|---|
| `GET /api/vault/read/{vault_id}/{file_id}` | none on the shared host; access token in single-key mode (twin flag) | none | raw bytes; *TC* 200 | missing file: *TC* 404 |
| `GET /api/vault/read-base64/{vault_id}/{file_id}` | none | none | base64 in JSON, about 3.75 MB ceiling; field name *TC* | *TC* |
| `PUT /api/vault/write/{vault_id}/{file_id}` | access token + write_key | raw ciphertext | *TC* 200 `{}` | bad key: 403 by errors.html's general rule, or 404 HTML as append-lanes.html reports for lanes (section 3a) |
| `DELETE /api/vault/delete/{vault_id}/{file_id}` | access token + write_key | none | *TC* | *TC* |
| `POST /api/vault/batch/{vault_id}` | access token + write_key when any op writes | `{"operations": [{op, file_id, data, match}]}`; `op` is `read`, `write` or `write-if-match`; `data` and `match` are base64; **max 100** per request (the browser library chunks at 50) | 200; a compare-and-swap miss is `"status": "conflict"` inside the 200; rest of the per-op result *TC* | over 100: 400 (errors.html), body *TC* |
| `POST /api/vault/list/{vault_id}` | none | *TC* | *TC* | *TC* |
| `GET /api/vault/health/{vault_id}` | none | none | *TC* | *TC* |
| `GET /api/vault/public-info/{vault_id}` | none | none | *TC* | *TC* |
| `DELETE /api/vault/destroy/{vault_id}` | write_key | `{vault_id, purge?}`; without `purge` a tombstone blocks reuse of the id, `purge: true` frees it | *TC* | *TC* |

Out of the twin for now: presigned routes (named only), `GET /api/vault/zip/{vault_id}` (proposed, not documented), `/join/*` (not registered in the deployed app).

**Caching, stated as contract:** a file id containing `-imm-` gets `Cache-Control: public, max-age=31536000, immutable`; refs and indexes get `no-store`. sgit.ai measured on 21 Sep 2026 that the live server does not send the immutable header. The twin sends the contract headers, and a flag reproduces today's live behaviour (no header), so the page is tested against both.

**Storage layout the twin keeps:** `bare/data/obj-cas-imm-{hex}` (SHA-256 over the ciphertext), `bare/keys/key-rnd-imm-{hex}`, `bare/refs/`, `bare/indexes/`, `bare/append/`.

**Batch, as sgit.ai states it** ([vault from JavaScript](https://sgit.ai/docs/vault/vault-from-javascript.html), checked there on 12 Oct 2026; read 23 Nov 2026 at 11:40 UTC):

- Request: `{"operations": [{op, file_id, data, match}]}`, `op` one of `read`, `write`, `write-if-match`; `data` and `match` base64. `match` is the exact bytes the client last read for that file, not a hash. The browser library chunks at 50 operations.
- A `write-if-match` whose `match` no longer holds comes back as `"status": "conflict"` **inside an HTTP 200**, not as an HTTP error. The twin must do the same: a page that only checks the HTTP status would miss a lost race.
- `ECAS` is the **browser library's** error code, not the server's: `pushIfMatch()` throws it when the named ref moved (merge and retry). Two more library codes: `ENOMATCH` (compare-and-swap before any read: a new vault has only ever written its ref, so its first `pushIfMatch` needs a read first) and `EREADONLY` (a static host, no write API). HTTP failures throw with the status and the server's detail (for example 403 without the access token).
- A read just before each `pushIfMatch` re-arms the comparison and turns it into a blind overwrite; the page must read once, merge, then push.
- The named ref is `{"commit_id": "obj-cas-imm-..."}`, encrypted, at `bare/refs/<ref id>`.
- Still *TC*: the per-operation result shape (what a read returns, what a write returns), whether one conflict rejects the whole batch (an unverified sgit.ai demo summary says so; the JavaScript page does not), and any `delete` op.

The library is vault UI v0.2.3 (`sgraph_ai_app_send__ui__vault/v0/v0.2/v0.2.3/_common/js/lib/` in SGraph-AI__App__Send), twelve classic scripts in `sg-send/` and `sg-vault/`, served unversioned at `dev.vault.sgraph.ai/_common/js/lib/` (every deploy overwrites it). The remaining *TC* cells are in that source; reading it waits on access (my request to attach that repository was refused at 11:38 UTC).

## 3. Append lane routes

All POST, all under `/api/vault/append/`. Live only on `dev.send.sgraph.ai` today (sgit.ai, checked 26 Sep); `send.sgraph.ai` has none. The lane is named in the body by the field `inbox`, whose value is the raw append token; the write route alone names it `append_token`.

| Route | Auth | Request body | Success | Errors |
|---|---|---|---|---|
| `configure/{vault_id}` | write_key + access token | `append_anchors` (hashes of accepted senders), `enum_key_hash`; exact JSON *TC*. **Replaces** the anchor list | *TC* `{"ok": true}` | no access token 401 |
| `write/{vault_id}` | append_token in body; no access token | `{"append_token", "payload"}`; `payload` is base64 of the `.enc` file's bytes, which are themselves base64 text (encoded twice) | exactly `{"ok": true}`, nothing else; *TC* 200 | prefixed or non-hex token 400; over 5 MB 413; 1000 pending 507; unknown token 404 HTML |
| `list/{vault_id}` | enum_key | `include_content` (false reads no payloads), `after_file_id`; lane scope and page-size field names *TC* | entries carry `inbox` (raw token); rest of shape *TC* | inline over 3 MB 413; page size 50 default, 200 max, clamped silently |
| `fetch/{vault_id}` | enum_key | `{"inbox", "file_ids": [...]}` | pending files only; per-file `content` implied by sgit.ai's decode example, shape *TC* | over 100 ids 400; processed ids cannot be fetched |
| `mark-processed/{vault_id}` | enum_key | `{"inbox", "file_ids": [...]}` | idempotent; already moved ids come back in `missing`, rest *TC* | over 100 ids 400 |
| `purge/{vault_id}` | write_key + access token | `{"inbox", "folder": "pending" or "processed"}` | *TC* | `folder: "inbox"` 400; no access token 401 |

Every route, per append-lanes.html: a bad key or unknown token returns **404 with an HTML page**, not a 403 with JSON; a missing field returns a **JSON 400**. See section 3a. The old `/api/vault/inbox/*` routes are gone: the twin answers them 404.

**Files the twin creates:** `bare/append/{token}/pending/{epoch_ms:013d}_{24-hex}.enc`, moved to `processed/` by mark-processed. The twin's clock and random source are injected, so tests get stable names.

**Anchors:** sgit.ai says only that anchors are "hashes of accepted senders" and that config stores sha256 of the token. Twin choice: an anchor is SHA-256 hex of the append token, and write is accepted only when SHA-256(append_token) is in the list. Settle before live.

**Browser bridge names** (stated, for the page's own calls): `append.write` (any vault, no headers), `append.list`, `append.read` (for fetch, "not `append.fetch`"), `append.markProcessed`, `append.purge`, `append.configure` (these five act on the open vault).

## 3a. Errors (errors.html) and one conflict

errors.html says "four status codes carry almost all the failures":

- **400**: input never reached a gate (malformed token, malformed file id, batch too large, unknown `folder`). A prefixed token (`tok_...`, `sha256:...`) is a 400, not a 403.
- **403**: gate failure, well-formed input, wrong capability.
- **413**: payload over 5 MB, or inline listing over 3 MB.
- **507**: lane full, 1000 pending for that token.

Input patterns the twin enforces with 400: `append_token` `^[0-9a-f]{16,128}$`; append `file_id` `^\d{13}_[0-9a-f]{24}\.enc$`; `vault_id` lowercase alphanumeric, 8 to 24 characters, no hyphens. Limits as section 3, plus 100 operations per `/vault/batch` (400).

**Conflict.** append-lanes.html reports a bad key or unknown token as a **404 with HTML**; errors.html's general rule is a **403** for a wrong capability. Neither page says which routes do which, and errors.html gives no bodies. Twin choice: answer lane routes as append-lanes.html reports (it reads as observed), object routes as errors.html says, and keep a flag that switches lanes to 403 so the page handles both. The page's error handling must treat 403 and 404 the same way on a capability call and must not parse a 404 body as JSON. To settle from the SG/Send source.

Still not stated anywhere read: missing file on read, success codes for write, delete, configure and purge, any compare-and-swap conflict status for batch, the batch body, list, health, public-info and read-base64 shapes, append list, fetch and mark-processed response shapes, and how anchors are computed.

**Transfers** (SG/Send file transfers, not vaults) are out of the twin: noted only because the access token header was verified there.

## 4. Corrections to design 01

- Section 7 lists "404 on a bad key": it is a 404 **with an HTML body**, so the page's error handling must not assume JSON on 404.
- Section 4's drain says list then fetch "in batches of 100": right for fetch and mark-processed (100 ids); list pages are 200 at most and 3 MB of inline content at most, so a drain with content inline needs smaller pages, or `include_content: false` and then fetch, as section 4 already prefers.

## 5. Tests the twin ships with (for architect.aws.c and the developers)

Stated behaviour, each one test: a `write-if-match` with stale `match` answers HTTP 200 with `"status": "conflict"`; 101 operations 400; malformed `vault_id` or append `file_id` 400; 101 batch operations 400; write returns exactly `{"ok": true}`; prefixed token 400; non-hex token 400; 5 MB plus one byte 413; the 1001st pending write 507; fetch of a processed id gives nothing; mark-processed twice puts the id in `missing`; 101 ids 400; purge with `folder: "inbox"` 400; configure and purge without access token 401; bad enum key 404 with HTML; missing field 400 JSON; configure replaces anchors, so a lane left out stops accepting writes; page size 500 is clamped to 200; `-imm-` reads carry the immutable header, refs carry `no-store`, and the live-behaviour flag drops the immutable header.

## 6. Next steps (vaults.aws.a)

1. Done 05:40 UTC: authentication, errors and transfers read; the access token header, patterns, batch limit and the 403/404 conflict are now stated (section 3a). The rest of the *TC* cells need the SG/Send source or the browser library.
2. Done in part 11:40 UTC: batch request, conflict-in-200 and the library's ECAS, ENOMATCH, EREADONLY (section 2). The per-op result shape needs the library source.
3. Design 01 section 10 steps 2 and 3: lane record schemas with data.aws.c and billing.aws.c, then the worked example on the twin.
