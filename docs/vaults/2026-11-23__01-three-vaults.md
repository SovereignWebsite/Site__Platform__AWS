# Vaults design 01: the three vaults and the capture store

Written by vaults.aws.c@SovereignWebsite.dinis, 23 November 2026 ~03:40 UTC. Status: **first draft, proposed**. For architect.aws.c, data.aws.c and aws.c to build on, security.aws.c to review, Dinis to decide the open questions (section 9). Board item VA-1; pipeline P3.

Sources: the memo (sections 5, 6, 9, 13), docs/board/pipeline.md (P3), docs/architecture/2026-11-23__01-one-transport-two-back-ends.md, docs/sealed-store.md, and sgit.ai at site v0.7.87, read on 23 Nov 2026: [API](https://sgit.ai/api/index.html), [append lanes](https://sgit.ai/api/append-lanes.html), [vault objects](https://sgit.ai/api/vault-objects.html), [vault from JavaScript](https://sgit.ai/docs/vault/vault-from-javascript.html), [sub-vaults](https://sgit.ai/docs/vault/sub-vaults.html), [static hosting](https://sgit.ai/docs/vault/static-hosting.html), [telemetry brief](https://sgit.ai/docs/briefs/vault-telemetry-append-lanes.html), [vault messaging](https://sgit.ai/docs/vault-messaging.html), [limitations](https://sgit.ai/docs/limitations.html), [self-hosting](https://sgit.ai/docs/self-host-for-agents.html). Nothing here was run against a live server: no live testing.

## 1. What sgit.ai says, in the facts this design rests on

- **The server is a capability-checked ciphertext store.** It keeps SHA-256 of each capability and compares hashes; it never sees a private key or plaintext. Reads are public by default because the bytes are useless without a key.
- **Four capabilities, split on purpose.** `append_token` (write to one lane, nothing else), `enum_key` (list, fetch, mark-processed), `write_key` (write objects, configure and purge lanes), and the private key (decrypt, never sent).
- **Reads are one GET each, writes are commits.** File ids are hashes or HMACs of the key, computed in the client, so a read needs no lookup. `POST /api/vault/batch/{vault_id}` takes up to 100 operations. In the browser library every file write is one commit sent as one batch, and `pushIfMatch()` publishes with compare-and-swap (`ECAS` means someone else published first: merge and retry). Never `push()`.
- **Append lanes sit outside the commit tree** at `bare/append/{token}/pending/` and `processed/`. A write never touches a branch, never contends with a read, never conflicts with a push. `write` needs no account; the response is exactly `{"ok": true}`. Filenames are server-assigned `{epoch_ms}_{24-hex}.enc`, so a lane sorts by time and pages by `after_file_id`.
- **Lane limits:** 5 MB per write, 1000 pending files per token (then 507), 100 ids per batch, 3 MB inline when listing, 200 per page. Routes are on `dev.send.sgraph.ai` only today.
- **Static hosting:** a vault's encrypted `bare/` tree served at `api/vault/read/<vault_id>/` on any static host (GitHub Pages, S3) opens read-only in the browser. Immutable objects (`-imm-`) can be cached forever; refs must be `no-store`. Measured by sgit.ai on 21 Sep 2026: the immutable cache header was not being sent by the live API.
- **Sub-vaults** are `*.link.json` pointer files; an owner record can hold a child's read key (never its write key) so it opens read-only for anyone holding the parent.
- **Edges stated by sgit.ai:** a partial clone is not an access boundary (separate vaults for separate audiences); the server cannot index or process content (all intelligence is client-side); lane addressing by `H(public key)` is proposed, not shipped; a lane folder is named by the raw append token today, so it lands in object keys and access logs.

## 2. The shape: three vaults and one capture lane set

```
 browser (Dinis signed in)        GitHub Actions (OIDC, later)
   |  live AWS read                 |  extract / transform jobs
   |                                |
   +--> [1] LIVE vault  <-- commits (latest state per resource)
   |
   +--> append lanes ---------------+--> [2] SNAPSHOT vault
   |    (capture store, P3)              lanes drained, compacted into dated files
   |
   +--> [3] GRAPH vault  <-- commits (cross-mapping folders)
            links to [1] and [2] by *.link.json, read keys only
```

Three vaults, not three folders in one vault, because sgit.ai says a folder is not an access boundary: each vault can then have its own audience, lifecycle and, later, its own publishing choice.

## 3. Vault 1: live reads

**What:** the last known state of each AWS resource Dinis uses, as read live by the page. AWS stays the source of truth; this vault is the memory of what was seen and when.

**Layout:** one file per resource, at a deterministic path, so a read is a single GET and the page can open before AWS answers:

```
/<account-alias>/<region>/<service>/<resource-type>/<resource-id>.json
/<account-alias>/_index.json        what was read, when, by which read
```

Account aliases, never account IDs, in paths (account IDs stay in the sealed store, as today). Each file holds the parsed resource, the read time, the request id and the AWS API call that produced it.

**Writes:** a commit only when the resource changed (compare a content hash first), batched per read session (`addFiles` is one commit for many files), published with `pushIfMatch()`. History then gives "what changed, when" for free, which feeds the time lapse (P5) and the graph.

**Reads:** the page opens the vault read-only for display; the twin (section 7) can seed from it.

## 4. Vault 2: snapshots of temporal data

**What:** data that is gone if not captured: CloudWatch metric windows, CloudTrail event pages, cost and usage readings for billing.aws.c, CloudFront log extracts for data.aws.c, and vault usage itself (memo section 6).

**Writes go through append lanes, never commits.** Each source appends encrypted records to its own lane: one `append_anchor` per source (browser, each GitHub Actions workflow, each extract), so one noisy source cannot bury another, and revoking a source is removing one anchor. Records are encrypted to the snapshot vault's public key (sgit PKI) before they leave the writer.

**Compaction (LETS: load, extract, transform, save):** a drain run lists lanes metadata-only (`include_content: false`, which reads no payloads), fetches in batches of 100, decrypts, normalises, and commits dated files:

```
/<source>/<yyyy>/<mm>/<dd>/<hh>.jsonl       one line per record
/<source>/<yyyy>/<mm>/<dd>/_summary.json    counts, ranges, hashes of the lane files folded in
```

then `mark-processed`, then `purge` of `processed`. Keep the ciphertext until the commit is pushed, since a processed file cannot be fetched again. Drain cadence is set by the 1000-pending cap: each source must be drained before it can reach 1000 files, with a margin.

**Reads:** dated files are immutable once the hour is closed, so they cache well; a static, read-only export of this vault (sgit.ai static hosting) can be served from S3 or GitHub Pages for fast reads by the time lapse and billing views.

## 5. Vault 3: the graph's cross-mapping folders

**What:** the semantic graph of memo section 9: on any asset, everything known to connect to it.

**Layout:** a folder per asset, holding its node and its edges, small files so a question loads only the slice it needs (the fractal graph approach on sgit.ai):

```
/assets/<service>/<resource-id>/node.json      type, alias, region, source file in vault 1
/assets/<service>/<resource-id>/edges.json     [{rel, to, evidence}] e.g. writes-logs-to, made-by-stack
/maps/<rel>.json                               the reverse index per relation
/live.link.json, /snapshots.link.json          sub-vault links, read keys only
```

Every edge carries its evidence: the file and commit in vault 1 or 2 it came from. Edges are rebuilt from vaults 1 and 2, so this vault can always be regenerated and is never the only copy of anything.

## 6. The capture store (P3) and the Secure Send S3 API

The capture store is section 4's lanes: S3 always works, and the vault layer adds encrypted, write-only capture and the mapping on top.

The SG/Send server is the API behind every vault on sgit.ai, and its self-hosting page documents `SEND__STORAGE_MODE=s3` with `SEND__S3_BUCKET` (needed for more than one replica), and the same image on Docker, Lambda, ECS Fargate, EC2 and others, configured by environment variables. I read this as the Secure Send S3 API the memo calls the foundation of the vault; **to confirm with maestro.c** (section 9). If so:

- A client deploys one SG/Send stack per region into their own account: an S3 bucket and a function, which is what "deploy it themselves, in many regions" needs. aws.c prepares any such plan; Dinis approves it on the site. This agent changes nothing in AWS.
- The vaults above can point at either endpoint (hosted `dev.send.sgraph.ai` or the client's own) with no change to their layout.
- Its CloudFront and S3 logs are where vault usage becomes visible, which joins data.aws.c's extract workflow.

## 7. Twin first

Like the AWS twin (`site/transport.js`, `site/twin.js`), a **vault twin** answers `/api/vault/batch`, `/api/vault/read` and the six `/api/vault/append/*` routes in the page, from synthetic state, with the same status codes and body shapes sgit.ai documents (blind `{"ok": true}`, 404 on a bad key, 400 on a prefixed token, 507 at 1000 pending, 413 over 5 MB). Everything above is built and tested against it before any live server. Proposed for architect.aws.c as one more back end behind the same seam.

## 8. Security notes for security.aws.c

1. **CSP.** Today `connect-src` allows only self, Google sign-in and `*.amazonaws.com`. A live vault needs the SG/Send host added, and the browser vault library must be copied into `site/` at a pinned commit (sgit.ai: the upstream path is not versioned and every deploy overwrites it), so `script-src 'self'` stays as it is. Both touch site/index.html and need aws.c; nothing is changed by this draft.
2. **Writes need an SG/Send access token.** It is a credential: it lives only in Dinis's browser, in the sealed store, never in this repository or in any agent. Agents never hold it.
3. **Append tokens can be published, with limits.** Write-only, so safe to ship in a page, but anything in the page can forge records and flood a lane. Every captured record is an untrusted claim; one anchor per source; drain before the cap.
4. **Raw tokens in object keys.** The lane folder is the raw append token today; it reaches S3 access logs and inventories. Matters if clients host their own SG/Send with logging on.
5. **What goes in which vault.** Little is confidential (memo section 9, to be double-checked), but resource ids, ARNs and CloudTrail principals may be. Default: all three vaults private; publishing any part is a later, per-vault decision by Dinis.

## 9. Open questions (to pm.aws.c for docs/board/decisions.md)

1. **Is the Secure Send S3 API the SG/Send server** (SGraph-AI__App__Send, `SEND__STORAGE_MODE=s3`)? Where are its code and current deployment, and which clients and regions come first? Ask maestro.c. Blocks section 6. Recommendation: assume yes, design against the documented API, confirm before any plan.
2. **Hosted or own endpoint first?** Recommendation: the twin now; then Dinis's own SG/Send in eu-west-2, since append routes are on `dev.send.sgraph.ai` only today. Blocks any live write.
3. **Who drains the snapshot lanes?** Recommendation: the browser while Dinis is signed in first (no new credential anywhere), a GitHub Actions job later. Blocks section 4's cadence.

## 10. Next steps (vaults.aws.c)

1. The vault twin's contract: request and response shapes per route, as a table architect.aws.c can build to.
2. The record schema for each lane source (CloudFront extract, CloudTrail page, metric window, cost reading), with data.aws.c and billing.aws.c.
3. A worked example on the twin: one S3 bucket read into vault 1, its log delivery captured into vault 2, its edges written into vault 3.
