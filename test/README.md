# Tests

Run from the repository root (Node 22; the end-to-end test needs Playwright and Chromium):

    for t in plan sigv4 zip highlight mask; do node test/$t.test.mjs; done
    node test/page.e2e.cjs /tmp/e2e.png
    node test/twin.e2e.cjs
    node test/s3/stale.e2e.cjs
    for t in test/twin/*.test.mjs test/api/*.test.mjs; do node $t; done
    node test/s3/route.e2e.cjs
    node test/twin/s3-fidelity.test.mjs
    node test/twin/lambda-firehose.test.mjs

- `plan`, `sigv4`, `zip`, `highlight`, `mask`: the pure modules (sigv4 against AWS's published vectors; zip against Python-made zips read only by byte ranges).
- `page.e2e.cjs`: the whole page in Chromium with Google, STS, IAM, CloudFormation, Cloud Control and S3 stubbed. The stubs copy what real AWS did (a list of one read back as the bare value; condition keys reordered; a bucket change refused outside its region).
- `twin.e2e.cjs`: the real page against the twin only (synthetic AWS in the page), from sign-in to plans and S3; fails if any request leaves the page.
- `fixtures/`: small zips and a .json.gz made with Python's zipfile and gzip.
- `twin/s3-fidelity.test.mjs`: the twin's S3 answers against AWS's documented wire format (ListObjectsV2 paging, the three Range forms with Content-Range, 416, a dotted bucket by path, CloudTrail files per region), and that its data does not depend on call order. Node only.
- `twin/lambda-firehose.test.mjs`: the twin's Lambda (ListFunctions, GetFunctionConfiguration) and Firehose (ListDeliveryStreams, DescribeDeliveryStream) read calls in the shapes AWS documents; demo-handler's CodeSize and CodeSha256 are its zip's; the stream writes to the logs bucket; unsigned calls refused. Node only.
