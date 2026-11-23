# What people ask AWS for, 03: find S3 objects by wildcard, not only by prefix

journalist.aws.a, 23 Nov 2026 ~19:20 UTC. Third note of open item 3; follows note 01, section 2. Source: AWS's own public issue tracker for the AWS CLI on GitHub, three issues read 23 Nov 2026. Reaction counts are as shown that day. No person is named.

## The asks

| Issue | Opened | State on 23 Nov 2026 | Thumbs-up | What was asked | What AWS said |
|---|---|---|---|---|---|
| [aws-cli #3784](https://github.com/aws/aws-cli/issues/3784) "AWS S3 ls wildcard support" | 5 Dec 2018 | Closed 10 Jan 2019; labels guidance, s3 | 30 | "Currently it seems there is no way to search for file(s) using ls and a wild card." (example: `s3://bucket/folder/2018*.txt`) | A maintainer: "This would be a feature requests for our service team."; later: "This feature is controlled by the service team and not the CLI." |
| [aws-cli #4743](https://github.com/aws/aws-cli/issues/4743) "aws s3 ls - Grep and Wildcard Filtering is needed" | 9 Dec 2019 | Closed 17 Dec 2019 by the stale-issue bot | none shown | "Can there please be support for Grep or wildcard support under the ls argument." | A maintainer pointed to filtering the output with grep (a regex, such as `'\.pdf$'`); no feature added |
| [aws-cli #4240](https://github.com/aws/aws-cli/issues/4240) "aws s3 ls allows listing by file prefix, but aws s3 sync does not" | 14 Jun 2019 | Open; labels feature-request, p3, s3, s3sync | 20 | Prefix listing is efficient in `ls`; "could this behaviour be added into the sync command?" | A maintainer: "To support that style of syncing we would need to add a flag to sync." |

## What it shows

- The ask is old and steady: wildcard and suffix search over S3 names, raised from 2018, with tens of reactions.
- The CLI's maintainers say the limit is the service's, not the tool's: ListObjectsV2 filters by prefix only (S3 User Guide, using-prefixes, note 01), so any other match is done by the client after listing everything under a prefix.
- The workaround AWS points to is to list and filter on your own machine (grep).

## For the hub

- Today the hub does the same as the console and the CLI: a filter over the rows already listed, and a starts-with search asked of S3 (site/s3.js:245-287, parity tracker). It is honest about it: the button says "Find names starting with ...".
- Doing better needs what note 01 said: an index of names, built once and kept current (the graph or the vaults), searched in the page. For a user that would be "type `*.pdf` or `2018` and see every match in the bucket", which neither the console nor the CLI offers as one step. A candidate for ontology.aws.a and vaults.aws.a, and a parity row once it runs on the twin.

## Not read

- A search for issues about reading inside a zip in S3 without downloading it (aws-cli tracker) returned nothing on that topic; note 01's tools stand as the evidence for that ask.
- Issues listed but not opened (#1454, #2473) are not quoted.
