# Design 01: one transport, two back ends (S3 first)

Written by architect.aws.c@SovereignWebsite.dinis, 23 November 2026 ~03:00 UTC. Status: **proposed**. For s3.aws.c and aws.c to build on, security.aws.c to review. Committed by aws.c (keeper) on the author's behalf. Sources: the memo (sections 2.2, 2.7, 9), the code as it stands on dev (e5f90f5), https://coding.sgit.ai and https://nfrs.sgit.ai.

## Update, 03:00 UTC: twin v0 is on dev (5371ed9)

aws.c built twin v0 with the same seam this design asks for: every AWS call goes through `AwsTransport.fetch(url, init)` (`site/transport.js`), answered in twin mode by `AwsTwin.handle` (`site/twin.js`). This design adopts v0 as the transport; `Transport.send` below reads as `AwsTransport.fetch`. Signing stays above the seam, so the twin sees signed requests (and checks them), which is better than this design's first version. Reshaping notes for v0:

1. **Fail closed in twin mode.** v0 fell through to the real `fetch` when the twin did not know a host or had not loaded. Done by aws.c (c8cece5): in twin mode the transport never calls `fetch`; it answers an AWS-shaped `501`, and `test/twin.e2e.cjs` checks it.
2. **Mode in `localStorage`.** Done (c8cece5): `?twin` and `?aws` override the stored mode, and the banner shows whenever twin mode is on.
3. **Next splits, when twin.js grows past one idea**: one file per service twin (`twin/s3.js`, `twin/cloudcontrol.js`, ...) behind `twin.js` as the router, and the seed data as JSON apart from the code.
4. **Above the seam**, the service APIs (`S3Api`) and the OpenAPI with `x-aws-actions` are unchanged by v0 and are the next designs.

## The decision (first version, before v0)

Every AWS call the site makes goes through **one transport** with one method:

```js
Transport.send({ service, region, method, url, headers, body }) // -> Promise<Response>
```

It returns a real `Response`, exactly what `fetch` returns. Behind it sits one of two back ends, chosen once when the page loads and never mixed:

| Back end | What it does | Network |
|---|---|---|
| `AwsBackend` | Gets credentials from `Platform.assume`, signs with `SigV4.sign`, calls `fetch`. Today's code, moved behind one door. | `https://*.amazonaws.com` only, as now |
| `TwinBackend` | Answers the same request in the page from synthetic state: same status codes, same headers, same XML or JSON bodies, same error shapes. | None |

Above the transport, a **service API** per primitive (`S3Api` first) turns wire responses into plain objects. The UIs (today `site/s3.js`; later the five consoles) call only the service API. Neither the API nor the UI can tell which back end answered: Dinis's "the code should not know the difference".

```
 UI (s3.js, console 1..5)
        |  plain objects: Bucket, ObjectSummary, Bytes
 S3Api (site/api/s3-api.js)            <- parses XML / JSON, pages, ranges
        |  Transport.send(req) -> Response
 Transport (site/api/transport.js)     <- one back end per page load
     /                      \
 AwsBackend                TwinBackend (site/twin/)
 (SigV4 + fetch)           (in-page S3 + Cloud Control, synthetic data)
```

## Why the twin sits at the wire, not at the API

The twin answers HTTP-shaped requests with AWS-shaped bodies. So when the page runs on the twin, the XML parsing, paging (`NextContinuationToken`), byte ranges (the zip reader's `Range` requests), gzip handling and error paths in `S3Api` all run for real. A twin at the API level (returning ready-made objects) would skip exactly the code most likely to break, and would be a mock in all but name; nfrs.sgit.ai says "No mocks. No patches."

## Options considered

| Option | For | Against | Verdict |
|---|---|---|---|
| **A. In-page twin back end behind one transport** | No server; no CSP change; deterministic; runs in Node tests and in the browser; one seam to review | Needs the call sites refactored onto the transport (small: two helpers today, `s3get` and `cc`/`jsonCall`) | **Chosen** |
| B. Service Worker intercepting `fetch` to `*.amazonaws.com` | Zero change to call sites | Hidden: a worker that rewrites AWS traffic is the thing security should fear most; lifecycle and caching surprises; harder to test in Node | Rejected for now; revisit only for an offline demo |
| C. A twin server (LocalStack-style) | Very complete | Server code, which CLAUDE.md forbids for this site; network; another thing to run | Rejected |
| D. Fake objects at the `S3Api` level | Quickest | Skips parsing and paging; a mock; the code does know the difference | Rejected |

## The S3 slice (what the twin must answer first)

From `site/s3.js` as it stands, the S3 browser uses two wire protocols. The twin answers both, nothing more:

| Operation | Wire | Used for |
|---|---|---|
| Cloud Control `ListResources` (`AWS::S3::Bucket`) | POST, `application/x-amz-json-1.0`, `X-Amz-Target: CloudApiService.ListResources` | Bucket list, paged by `NextToken` |
| Cloud Control `GetResource` | same, `CloudApiService.GetResource` | Bucket properties, region from `RegionalDomainName` |
| Cloud Control `UpdateResource` + `GetResourceRequestStatus` | same | Applying a plan (the CORS rule), only after Approve |
| S3 `ListObjectsV2` | GET `?list-type=2&prefix=&delimiter=/&continuation-token=` | Folders and files |
| S3 `GetObject`, with and without `Range` | GET on the key; `206` with `Content-Range` for ranges | Files, and reading inside zips |

Twin rules for fidelity:

- **Errors look like AWS's**: S3 returns `<Error><Code>…</Code><Message>…</Message></Error>` with the right status (`NoSuchKey` 404, `AccessDenied` 403, `NoSuchBucket` 404); Cloud Control returns JSON with `__type` and `message`. `Platform.awsError` then works unchanged.
- **Faults on request**: the twin can be told to refuse a bucket as if CORS were missing (the promise rejects with `TypeError: Failed to fetch`, as the browser does), to deny a role, or to be slow. This makes the unhappy paths in the UI testable and demonstrable.
- **Plans apply to the twin's state**: `UpdateResource` on the twin changes its in-memory bucket, so the whole plan, diff, Approve, apply loop can be shown without a real account.
- **Credentials**: `TwinBackend` never asks for them and `Platform.assume` is not called; the twin has a role model of its own (read and change) so "read-only by default" is still visible.

## Synthetic data

- Seed state is JSON in `site/twin/data/` (one file per service, for example `s3.json`), loaded once, held in memory, never written back. Reset is a page reload.
- Every name is obviously synthetic (`example-site-logs`, account `111122223333`, the account ID AWS uses in its own documentation). No real account ID, bucket, key or customer; no copy of Dinis's data.
- The seed covers what the S3 browser shows today: a few buckets in eu-west-1 and eu-west-2 (one with a dot in its name, which takes the path-style URL), nested prefixes, more than 1000 keys in one prefix (to exercise paging), a `.zip`, a `.json.gz`, JSON Lines, CSV, a Firehose-style log prefix (`YYYY/MM/DD/HH/`) for the extract workflow, and one bucket with no CORS rule.
- Object bodies are generated from a seed at load (deterministic), so the repository holds kilobytes, not megabytes.

## Choosing the back end

- The hub shows a clear choice before sign-in: **Your AWS** (Google sign-in, as now) or **The twin (synthetic data)**. `?twin` in the address picks the twin too, for links in articles and demos.
- On the twin, a banner that cannot be dismissed says "Twin: synthetic data, not your AWS". The two are never mixed in one page load.
- The CSP does not change: the twin needs no `connect-src`.

## The service API and its OpenAPI document

- `S3Api` methods: `listBuckets()`, `getBucket(name)`, `listObjects(bucket, prefix, token)`, `getObject(bucket, key, range)`, `planCors(bucket)` (returns a plan; it never applies one), `applyPlan(plan)` (change role, after Approve only).
- Each service API is described by an OpenAPI 3.1 document, `site/api/s3.openapi.json`, as a browser-side contract (operation IDs match the method names). Each operation carries `x-aws-actions`: the IAM actions it needs. For S3 objects these are `s3:ListBucket` (ListObjectsV2) and `s3:GetObject`. For the Cloud Control operations they are `cloudformation:ListResources`, `cloudformation:GetResource` and `cloudformation:UpdateResource` plus the handler permissions that the `AWS::S3::Bucket` resource schema lists for list, read and update; aws.c confirms that list against AWS's published schema before it goes into a plan (I have not copied it here to avoid stating it wrongly).
- The union of `x-aws-actions` over the operations a UI uses is the least-privilege list aws.c turns into the template's next plan. One source of truth, generated, not hand-kept twice.

## Code shape

The site today is plain browser JavaScript, one file per idea, no framework, no bundler, each file a function that sets one global (`SigV4`, `Platform`). coding.sgit.ai asks for one idea per file and the filename matching what it defines; this keeps that:

```
site/api/transport.js        Transport: send(req), use(backend)
site/api/aws-backend.js      AwsBackend: assume + SigV4.sign + fetch
site/api/s3-api.js           S3Api over Transport
site/api/s3.openapi.json     contract + x-aws-actions
site/twin/twin-backend.js    TwinBackend: routes req to a service twin
site/twin/s3-twin.js         S3 REST answers (ListObjectsV2, GetObject, Range)
site/twin/cloudcontrol-twin.js  Cloud Control answers for AWS::S3::Bucket
site/twin/data/s3.json       seed
test/api/*.test.mjs          S3Api against TwinBackend (Node has Response)
test/twin/*.test.mjs         twin fidelity: bodies and errors match AWS's documented examples
```

## Tests

- **Contract tests** run `S3Api` over `TwinBackend` in Node (no browser, no network): paging, ranges, gzip, errors, faults.
- **Fidelity tests** check the twin's bodies against the example responses in AWS's public API reference, so the twin cannot drift into answering what we wish AWS said.
- **AwsBackend** is tested as today: SigV4 against AWS's published test vector, and the end-to-end page test with AWS stubbed. No request ever goes to AWS from a test.
- The existing e2e page test can switch to `?twin` and lose its hand-written AWS stub.

## Migration (small steps, each shippable)

1. Add `transport.js`, `aws-backend.js`; move `jsonCall` and `s3get` onto it. No behaviour change. (keeper or s3.aws.c, in `site/app.js` and `site/s3.js`)
2. Add `s3-api.js`; `s3.js` calls it instead of parsing XML itself.
3. Add the twin for the S3 slice, its seed, and the tests.
4. Add the hub choice and the banner.
5. The OpenAPI document and `x-aws-actions`; aws.c builds template v3's S3 part from it.

## Security notes for security.aws.c

- The transport is the one place every AWS request passes: a good spot for the page's own behaviour policy (memo section 9) later, for example refusing any host outside an allow-list of AWS endpoints, and any write outside `applyPlan`.
- Credentials stay inside `AwsBackend`; `S3Api` and the UIs never see them.
- The twin adds no network, no storage and no new origin. Its risk is confusion (believing synthetic data is real), hence the banner and the explicit choice.

## Open questions

1. Step 1 of the migration is done in v0 (`site/transport.js`). Steps 2 to 5 are designed next in docs/architecture/, as notes for aws.c and s3.aws.c, who own the code.
2. The split of `twin.js` into one file per service twin, with seeds as JSON, is the next design (02).
3. For Dinis, via pm.aws.c, not blocking: should the twin also be public on its own (for example a twin link on each area site) so anyone can try the consoles without an AWS account? My recommendation: yes, it is the best demonstration and costs nothing.
