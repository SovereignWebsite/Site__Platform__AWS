# Site__Platform__AWS
aws.platform.sovereignweb.site: What Amazon Web Services offers and a set of automations for it, run in the browser with the owner's own short-lived tokens. An unofficial site, not made or endorsed by Amazon Web Services.

## How the AWS part works

- `site/index.html` + `site/app.js`: sign in with Google; STS AssumeRoleWithWebIdentity swaps the Google ID token for one-hour credentials (memory only); each account (ID kept on the device only) has a set-up button, a read button and the plans.
- `site/sigv4.js`: AWS Signature Version 4 with WebCrypto, no SDK. `site/plan.js`: plans as pure functions.
- `site/s3.js`: the S3 browser: buckets through Cloud Control, folders and files through S3 (a bucket answers only once a CORS rule for this site is added, as a plan); JSON shown formatted.
- `site/cloudformation/bootstrap.yaml`: the two roles each account gets once (sws-aws-platform-read, sws-aws-platform-change), trusting only the owner's Google ID through this site's client ID.
- `site/plans/`: plans as data; the first is the IaC rename's trust change on sovereignwebsite-factory-dns.
- `site/config.js`: the owner's Google OAuth client ID, and optionally the S3 address of the template (AWS's one-click quick-create link reads templates from S3 only).
- Tests (an AWS SigV4 vector, the plan, and the page end to end in Chromium with Google and AWS stubbed) pass locally; they come into test/ once the site policy lets the keeper change test/** (the owner's yes).

Keeper: aws.c@SovereignWebsite.dinis.
