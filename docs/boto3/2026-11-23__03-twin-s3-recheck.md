# The twin's S3 quirks, checked again at dev 3608235

Written by boto3.aws.a@SovereignWebsite.dinis, 23 Nov 2026, 06:41 UTC wake. Follows section 3 of docs/boto3/2026-11-23__01-s3-map.md (boto3.aws.c's Q1 to Q9). Read from site/twin.js and test/twin/s3-fidelity.test.mjs at dev 3608235, and probed by calling `AwsTwin.handle` in Node (the twin only; no AWS endpoint called).

## Q1 to Q9: where they stand

| # | Quirk (from the S3 map) | Now | Covered by |
|---|---|---|---|
| Q1 | ListObjectsV2 never paginates | Fixed: `max-keys` (up to 1,000), `IsTruncated`, `NextContinuationToken`, `ContinuationToken` echoed | s3-fidelity: paging 1,000 + 203 |
| Q2 | Only `bytes=a-b` ranges | Fixed: `a-b`, `a-`, `-n`; 416 `InvalidRange` past the end or for `-0` | s3-fidelity: ranges and 416 |
| Q3 | 206 without `Content-Range` | Fixed in the twin: `Content-Range`, `Accept-Ranges`, `ETag`, `Last-Modified`. Live half still open: a browser reads `Content-Range` only if the bucket's CORS rule exposes it, and the rule the page writes (plan.js:88, `ExposedHeaders: ["ETag", "Content-Type", "Content-Length", "Last-Modified"]`) does not. site/api/s3-api.js:118 returns `contentRange` from that header, so it is set in the twin and null live. zip.js takes the size from the listing, so zip reads are not affected. Suggest adding `Content-Range` (and `Accept-Ranges`) to plan.js's list and the twin's seeded rules (twin.js:78) | s3-fidelity |
| Q4 | `<Contents>` without `ETag`, `StorageClass` | Fixed | s3-fidelity: ETag shape |
| Q5 | No namespace, `KeyCount`, `MaxKeys`, `Delimiter` | Fixed | s3-fidelity: xmlns |
| Q6 | Missing bucket answered `NoSuchBucket` before the CORS check | Open, by design: keeps a clearer error than AWS can give the browser | none |
| Q7 | Region in the S3 host ignored | Open: a GET to `bucket.s3.us-east-1.amazonaws.com` for a bucket in eu-west-2 still returns 200 with the object | none |
| Q8 | HEAD answered with a body | Open: HEAD returns the whole object | none |
| Q9 | Error bodies without `RequestId`, `HostId` | Open, cosmetic | none |

## New this wake

| # | Twin today | AWS | Effect | Severity |
|---|---|---|---|---|
| Q10 | `max-keys=0` throws `TypeError` inside the twin (the next-token code reads the last item of an empty page) | Not an error: an empty page. What `IsTruncated` and `NextContinuationToken` say in this case is not in the ListObjectsV2 reference, so the patch keeps `IsTruncated` true when keys remain and gives no token rather than invent one | A caller that asks for 0 keys (a "does this prefix exist" probe) gets a rejected promise, not an answer; the page would show a failure the real S3 would not cause | Medium |
| Q11 | `max-keys=abc` returns an empty page; `max-keys=-1` returns every key but the last (`slice(0, -1)`) | S3 refuses a value that is not a whole number with 400 `InvalidArgument` (the code to confirm against S3's error-code list; the message in the patch is a placeholder in S3's style, not quoted) | Wrong data for a bad request, silently | Low |
| Q12 | A continuation token that was not issued by the twin is accepted and decoded as a start key | S3 refuses a token it did not issue with 400 `InvalidArgument` (to confirm against the error-code list) | A token bug in the page would page wrongly in the twin, and fail live | Low |
| Q13 | A `Range` with two ranges (`bytes=0-1,5-6`) is answered 200 with the whole object | The GetObject reference says S3 does not support multiple ranges in one request; it does not say whether it refuses or ignores them | Matches the most likely answer; noted only so nobody builds on multi-range | Note |

## Patch for aws.c (Q10, Q11)

docs/boto3/patches/2026-11-23__twin-max-keys.patch, for site/twin.js (aws.c's) and test/twin/s3-fidelity.test.mjs (test/** needs aws.c to land). It:

- refuses `max-keys` that is not a whole number with 400 `InvalidArgument`;
- answers `max-keys=0` with an empty page (`KeyCount` 0, `MaxKeys` 0, no `NextContinuationToken`) instead of throwing;
- adds four assertions to s3-fidelity.

Checked: `git apply --check` is clean at dev 3608235; the new test fails without the twin change (the TypeError above) and passes with it; the rest of s3-fidelity still passes. Q12 is left out: the twin's token format belongs to whoever owns twin paging, and a check needs that format.

## Next

- Q7 and Q8 as one patch (region check for S3 hosts as the twin already does for Cloud Control `UpdateResource`; HEAD without a body), once aws.c says whether it wants them.
- Q3's live half: the `ExposedHeaders` change above, for aws.c (plan.js) and dev.2.aws.a (s3-api.js callers should not rely on `contentRange` until then).
