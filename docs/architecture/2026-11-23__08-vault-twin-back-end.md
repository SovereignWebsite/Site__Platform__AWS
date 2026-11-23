# Design 08: the vault twin as a back end

architect.aws.a@SovereignWebsite.dinis, 23 Nov 2026, session https://claude.ai/code/session_018yvwtMBzo4iQ9dN7icjvXK. Status: proposed; vaults.aws.a agreed with two catches, taken (22:40Z); security.aws.a agreed with four changes, taken. Where the vault twin sits in the twin's engine, so it can be built in steps without guessing what sgit.ai does not say.

The **contract** is vaults.aws.a's: docs/vaults/2026-11-23__02-vault-twin-contract.md (on dev), every cell either *stated* (sgit.ai says it; the twin matches exactly) or a *twin choice* (*TC*; a tagged test, settled before anything goes live). This design does not add or change a single cell. It says how the routes land in design 01's transport, design 02's journal, design 06's edge and design 07's clock.

## 1. Where requests reach it

A Vault is reached at its endpoint (vaults.aws.a design 04): the CloudFront address `dXXXX.cloudfront.net` (or the customer's domain, design 06b), in front of a Lambda Function URL. In the twin:

- The transport routes a request to the vault twin when, and only when, its host is on the **exact allow list** of twin distribution hosts (design 07 section 2), the distribution's origin is a Vault Function URL, and the path starts with `/api/vault/`. `/health` stays the CloudFront Function's (design 05). `GET /api/info/health` is the server's own (stated on sgit.ai's self-host page: 401 without `x-sgraph-access-token`, `{"status":"ok"}` with it; vaults.aws.a design 04 section 4 step 3 and dev.1.aws.a's customer account use it). Any other path on that host is the Vault server's own 404.
- **Routing hygiene** (security.aws.a C4): the path is normalised and refused before routing if it holds `%2e%2e`, an encoded slash or a double slash; the vault id and file id are checked against the contract's patterns before any lookup, and every map is own-key only (`Object.create(null)`, as in the twin today).
- **Custom domains** (design 06b, security.aws.a C2): a customer domain joins the host allow list only if it is a reserved name (`example.com`, `example.net`, `example.org`, `.test`, `.invalid`) or a twin-issued one; never a registered real domain, or twin mode would shadow a real site. The allow list does this filtering, since the twin's `-edge` stack accepts any `DomainName`.
- No other host reaches the vault twin. In particular `dev.send.sgraph.ai`, `send.sgraph.ai` and `sgit.ai` are **never** answered by the twin (they are real services; the twin does not impersonate them). A page that talks to a real Vault goes through the real network, outside twin mode, by the same rule as AWS (design 01).
- The vault twin answers from **the world of the account that owns that distribution** (design 02: one journal per account). The deploy is the entries the stack created (dev.1.aws.a's step 4); a Vault starts empty with its access token in the stack's secret (the twin's copy; never shown, as design 04 says for the real one).

## 2. State as journal entries

Every write is a journal entry with `actor` the capability's holder (`vault-writer:<hash prefix>`, `append:<hash prefix>`, never the raw key or token) and `source` the request:

| Entry | From route | Fold |
|---|---|---|
| `vault.put` | `PUT write`, batch `write` | `w.vaults[id].files[file_id] = { size, sha256, bytes }` |
| `vault.cas` | batch `write-if-match` | applied only if the current bytes equal `match`; a miss is recorded as `vault.conflict` (no state change), so the 200-with-`"status": "conflict"` answer is reproducible from the journal |
| `vault.delete` | `DELETE delete` | removes the file |
| `vault.destroy` | `DELETE destroy` | tombstone, or free with `purge` |
| `append.configure` | lane configure | replaces the anchor list (stored as hashes) |
| `append.write` | lane write | a pending file, name from the clock and `rng("vault:<id>/append")` |
| `append.processed` | mark-processed | pending to processed |
| `append.purge` | purge | empties a folder |

- **Bytes:** a Vault holds ciphertext the twin never decrypts. Entries carry the sha256 and size; the bytes live in the world's object store keyed by sha256 (as `obj-cas-imm-` does), so the journal stays small and export (JSON Lines) can include or leave out bodies.
- **Reads write nothing** (design 06's rule for CloudFront, design 02 step 3's for derivations).
- **Capabilities:** the twin stores sha256 of each and compares hashes (contract section 1); entries and logs never hold a raw key, token or access token. The access token comes from the stack's secret in the world; tests get it from a **Node test export only** (security.aws.a C3): never on `window`, never switched on by a query string, hash or storage flag (compare R-011), never from an API answer.
- **Derivations:** each Vault request also derives one Lambda invocation (the function's CloudWatch Logs, lambda.aws.a's twin) and, through the distribution, one CloudFront log line (design 07 section 2's edge twin). One request, every side effect, as design 02 intends.

## 3. Steps

1. **Read-only and append, with seeded Vaults:** two Vaults with **valid ids** (`vaultdemo001`, `vaultdemo002`: errors.html states a vault id is lowercase alphanumeric, 8 to 24 characters, no hyphens), each tagged with the golden's names `vault-demo-001` and `vault-demo-002`, which are the demo site's own `/vault/<name>/files` paths in the CloudFront logs, not SG/Send ids; the graph joins the logs' `refers_to` to the Vault through that tag (ontology.aws.a). Files from vaults.aws.a's worked example (its lane batches). Then the routes: `read`, `read-base64`, the lane routes, from entries a pack seeds (`vault.put`, `append.write`), all contract cells *stated* first, then the *TC* ones tagged. vaults.aws.a's worked example (docs/vaults/example/, on dev) becomes the test's data.
2. **Writes and batch:** `PUT`, `DELETE`, batch with `write-if-match` and the in-200 conflict; tests for a lost race (two writers, one conflict), the 100-operation cap, and the raw-string write-key mistake from the contract.
3. **The derivations:** Lambda logs and CloudFront lines per request; test: counts equal, and the golden graph gains the Vault's `refers_to` edges from real paths.
4. **Later, in vaults.aws.a's order:** (a) the batch per-operation result shape (`pushIfMatch` depends on it); (b) whether one conflict rejects the whole batch or only that operation; (c) the success status and body of `PUT write` and `DELETE`; (d) the lane 403-versus-404 default, both behind a switch until the source says; list, health, public-info and read-base64 shapes after. All wait on decision 8 and once vaults.aws.a can read the SG/Send library source (access still refused); then vaults.aws.a's three vaults (live reads, snapshots, cross-mapping) as packs. **Packs are synthetic** (security.aws.a C1, R-025): packs ship in `site/`, which is public, and a real Vault's ciphertext and metadata (file ids, sizes, times, lane names) never go into one; a pack made from a real Vault needs its owner's consent and Dinis's yes.

## 4. Asks

- **vaults.aws.a:** agreed (22:40Z): nothing added to the contract; seeded ids corrected; `/api/info/health` kept; *TC* order taken.
- **ontology.aws.a:** the tag that joins the golden's `urn:sws:vault:vault-demo-00N` to the seeded Vault.
- **security.aws.a:** agreed (22:40Z, 5407b54), four changes taken (C1 synthetic packs, C2 reserved or twin-issued custom domains, C3 Node-only token export, C4 path normalisation and id checks).
- **dev.1.aws.a:** steps 1 to 3 after design 07's steps, each its own commit.
- **lambda.aws.a:** one invocation log per Vault request in the Vault function's log group.
