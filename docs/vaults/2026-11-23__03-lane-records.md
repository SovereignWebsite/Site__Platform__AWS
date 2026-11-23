# Vaults design 03: what goes into the snapshot lanes

Written by vaults.aws.a@SovereignWebsite.dinis, 23 November 2026 ~07:50 UTC. Status: **first draft, proposed**. Step 2 of design 01's section 10: the record each source appends to the snapshot vault's lanes (design 01 section 4). For data.aws.a and billing.aws.a to agree or change (their sources are theirs), architect.aws.c to build to, security.aws.c to review.

Grounded in: design 01 and 02 in this folder; data.aws.a's extract design (docs/data/2026-11-23__01-extract-workflow-first-design.md, schema v0 and its Privacy section); docs/billing/README.md; site/twin.js at 88148db (log lines now carry `country` and `vault_id`, the enricher's fields). No live server, no AWS calls.

## 1. Three layers, one rule each

```
lane file (.enc)         sgit's encrypted envelope, base64 text; sent base64 again as `payload` (design 02, section 3)
  └─ batch (JSON)        one per lane write: who wrote it, what it covers, a list of records
       └─ record         one per fact: a log line, a trail event, a metric window, a cost reading
```

- **Lane file:** sgit's format, not ours. Encrypted to the snapshot vault's public key (sgit PKI) before it leaves the writer. We never parse it except through sgit.
- **Batch:** ours. **Many records per write**, never one write per record: the lane caps at 1000 pending files per token and 5 MB per write, so a source writes at most one batch per source file read or per minute, whichever is fewer, and keeps the batch JSON under 2 MB: two base64 layers grow it by about 16/9, so 2 MB of JSON is about 3.6 MB of `payload`, a margin under the 5 MB cap (sgit.ai does not say whether the cap counts the decoded or the encoded payload, so assume the encoded).
- **Record:** ours, one schema per source, each versioned.

## 2. The batch

```json
{
  "v": 1,
  "source": "cloudfront-extract",
  "schema": "cloudfront-extract/1",
  "writer": "page",
  "batch_id": "<sha256 hex of source + the sorted record ids>",
  "written_at": "2026-11-22T11:59:30Z",
  "covers": { "from": "2026-11-22T11:00:00Z", "to": "2026-11-22T12:00:00Z" },
  "from": [{ "bucket_alias": "logs", "key": "cloudfront/2026/11/22/11/demo-distribution-1-2026-11-22-11-00-00.gz" }],
  "records": [ ... ]
}
```

- `writer`: `page` (Dinis's browser) or `action:<workflow name>` later. Never a person's name, never an account id.
- `from`: the objects read, by **bucket alias**, never account id or ARN (design 01 section 3).
- `batch_id` and every record's `id` are content hashes. Lane writes are blind (`{"ok": true}`, no file id), so a writer that retries after a timeout may write twice; the drain drops a batch it has already folded in and a record id it has already committed. Duplicates are expected, not an error.

## 3. Records per source

Every record has `id` (sha256 hex over source, object key and line or event id), `t` (UTC, ISO 8601, the time of the fact, not of capture) and `src` (key and line, so link mode reaches the exact line).

### 3.1 `cloudfront-extract/1` (owner: data.aws.a; agreed 07:40 UTC, its module at f28ef80 on work/data.aws.a)

data.aws.a's schema v0, with these fields:

| Field | From (twin field) | Note |
|---|---|---|
| `t`, `method`, `path`, `status`, `bytes`, `ms` | timestamp, cs_method, cs_uri_stem, sc_status, sc_bytes, time_taken x 1000 | as schema v0 |
| `edge`, `edge_city`, `country` | x_edge_location, country | `country` is the enricher's |
| `request_id`, `result`, `host`, `hour` | x-edge-request-id, x-edge-result-type, host | when present; P1 joins on `request_id`, P4 needs `result` (hit or miss) per edge |
| `agent_kind`, `kind` | cs_user_agent, path | as schema v0 |
| `vault` | path, by the extract | set only when the decoded path names a vault id with no `.`, `..` or slash; never taken from the enricher |
| `vault_claim` | vault_id | the enricher's value when it differs from `vault` (the twin's enricher gives `..` for `/vault/../../etc/passwd`) |
| `net` | c_ip | the truncated network only (section 4); named `net`, never `client`, so no one reads a lane as holding addresses |

Left out on purpose: the query string (probe strings, possibly tokens) and the raw user agent (`agent_kind` is enough).

### 3.2 `vault-usage/1` (owner: vaults.aws.a, derived)

Not read from AWS: written by the drain from 3.1 records whose `vault` is set, one record per vault per hour:

```json
{ "id": "...", "t": "2026-11-22T11:00:00Z", "vault": "vault-demo-001",
  "ok": 4, "refused": 0, "bytes": 21034, "clients": 3, "edges": ["LHR", "DUB"], "countries": ["GB", "IE"] }
```

`ok` counts 2xx and 3xx, `refused` 4xx and 5xx; "accessed" means `ok` only (in the twin's attack pack, nine probes on vault-demo-001 are all refused and must not count as use). Built only from records whose `vault` is set, never from `vault_claim`. `clients` is counted in the page before truncation. Counts only: no client, no path beyond the vault id, no user agent. This is the "what vaults are being accessed" view of memo section 6 without saying who.

### 3.3 `cloudtrail-event/1` (agreed with cloudtrail.aws.a, 07:39 UTC; its reference: docs/cloudtrail/2026-11-23__02-event-shape.md, 3a039f0)

| Field | From | Note |
|---|---|---|
| `t` | eventTime | |
| `event_id`, `request_id` | eventID, requestID | `request_id` joins to P1 |
| `service`, `action`, `region` | eventSource, eventName, awsRegion | |
| `read_only`, `category` | readOnly, eventCategory | |
| `who` | userIdentity | `{kind, name}`; kind from userIdentity.type: role, user, root, web, service, unknown. name: the issuer's role name for a role, userName for a user or a web sign-in, invokedBy for a service |
| `via` | webIdFederationData.federatedProvider, or identityProvider for a web sign-in | |
| `targets` | requestParameters, reduced | list of `{type, id}` by name, e.g. `s3:bucket` and `s3:object` for one GetObject, `iam:role`, `cloudformation:stack`; type names as ontology.aws.a's, so a record links to the graph |
| `failed` | errorCode | the code only, or null; denied calls feed the alarm view |

Left out on purpose: `accessKeyId`, `principalId`, full ARNs, `accountId`, `recipientAccountId`, `sourceIPAddress`, `errorMessage` (it can echo ARNs), and any `policyDocument` text (it belongs in vault 1's resource file, not in an event record). Consequences: cloudtrail.aws.a's "address never seen before" rule runs on full records in the browser, not on the lane; `account` comes back once there are two accounts.

### 3.4 `metric-window/1` (provisional; CloudWatch is not in the twin yet)

One record per metric and window, shaped after GetMetricData's `MetricDataResults` (Id, Label, Timestamps, Values, StatusCode), to be checked against AWS's documentation by boto3.aws.a before anything reads it:

```json
{ "id": "...", "t": "2026-11-22T11:00:00Z", "namespace": "AWS/CloudFront", "metric": "Requests",
  "dimensions": { "DistributionId": "<alias>" }, "stat": "Sum", "period_s": 300, "timestamps": [...], "values": [...], "status": "Complete" }
```

### 3.5 `cost-reading/1` (owner: billing.aws.a)

Two kinds, never mixed, so estimate and bill can be compared (docs/billing/README.md):

- `kind: "bill"`: one Cost Explorer `ResultsByTime` period: `start`, `end`, `metric` (`UnblendedCost`), `amount` (string, as AWS returns it), `unit`, `estimated` (Cost Explorer's `Estimated` flag: an open period is still moving, so no page scores an estimate against it), `region` when grouped by REGION, and the other group keys as given.
- `kind: "estimate"`: one line of `forecast.mjs --json` as it is (`price_id`, `unit_price`, `qty_month`), plus `start`, `end`, `region`, `basis` (`month_forecast` from forecast.mjs or `window` from twin-estimate.mjs), `cost_after_free_tiers` (the one compared with a bill) and `cost_before_free_tiers` (the gap is the free-tier effect), and `priced_with` (prices.json's retrieved date and its git commit, so an old estimate can be reproduced).

A page pairs a bill with estimates only when `start`, `end` and `region` match. Service names stay as each side gives them (Cost Explorer's on the bill, the estimate's own on the estimate): no translation in the lane; billing.aws.a keeps the mapping in docs/billing, taken from a real or twin Cost Explorer response. Agreed with billing.aws.a, 07:39 UTC.

On the twin the bill is the twin's made-up $42.17: such records get `"synthetic": true`, and so does every record from the twin, so a synthetic number can never be mistaken for Dinis's account (as R-011 warned for plans).

## 4. Privacy, until Dinis decides

data.aws.a's Privacy section asks Dinis to choose between a truncated network and a keyed hash for client addresses. Until he does, lanes hold **the truncated network only** (`203.0.113.0/24`; `/48` for IPv6). It is the choice that needs no new key anywhere, it is reversible (a later keyed hash can be added beside it), and it leaves nothing to leak if a lane is read. Recommendation for the decision: the same, plus distinct-client counts computed in the page before truncation.

Lanes are encrypted, but a record is still an untrusted claim (design 01 section 8.3): anyone holding an append token can write a well-formed batch. The drain checks every batch against its schema, drops what fails, and counts what it dropped in the hour's `_summary.json`.

## 5. What the drain writes (design 01 section 4, made concrete)

```
/<source>/<yyyy>/<mm>/<dd>/<hh>.jsonl        records, sorted by t then id, one per line, deduplicated
/<source>/<yyyy>/<mm>/<dd>/_summary.json     { "records": n, "dropped": n, "duplicates": n, "batches": [batch_id...], "lane_files": [file_id...] }
/vault-usage/<yyyy>/<mm>/<dd>/<hh>.jsonl     section 3.2, written in the same commit
```

An hour's file is rewritten while the hour is open and immutable once it closes plus a margin (late lines from Firehose buffering: up to 900 s, site/twin.js line 285). Then the static, cacheable export (design 01 section 4) can serve it.

## 6. Questions for the owners (not Dinis)

1. data.aws.a: answered 07:40 UTC, folded into 3.1 and 3.2.
2. billing.aws.a: answered 07:39 UTC, folded into 3.5.
3. cloudtrail.aws.a: answered 07:39 UTC, folded into 3.3.
4. boto3.aws.a: check 3.4 against GetMetricData's documentation (it notes `Messages` is also returned; to add when it answers in docs/boto3/).

## 7. Next (vaults.aws.a)

Design 01 section 10 step 3: the worked example on the twin, one bucket read into vault 1, its log lines into lanes as 3.1 batches, drained into 3.1 and 3.2 files, its edges into vault 3. That needs the vault twin (design 02), so it starts as a script over the AWS twin plus an in-memory lane, with tests.
