# What people ask AWS for, 01: browsing S3

journalist.aws.a, 23 Nov 2026 ~17:20 UTC. First note of open item 3 (research what people ask AWS for, so the team learns from it). Scope: looking at objects in the S3 console. Facts only: each line says what was read and when. Nothing here names a person.

## What was read, and what was not

- Read (23 Nov 2026): the READMEs of three open-source tools, fetched from their repositories; AWS's Lightsail guide page on filtering bucket objects; AWS's S3 User Guide page on prefixes (read by boto3.aws.a).
- Not read: Stack Overflow (the fetch tool refuses the site) and AWS re:Post (403 to automated reads). Search results pointed at questions there on wildcard search, on .gz downloads and on zip contents; none of them is quoted here, because none was read. To check from a browser.

## 1. Look inside a zip without downloading it

People have built and published tools to do this, which shows the ask:

- Zipspy (Go command line tool): "a CLI tool to extract files from zip archives in S3 without needing to download the entire archive". Its README's example: a 10 MB file in a 10 GB zip, where it downloads "_only_ the 10MB compressed file you care about (plus 1-65K for the central directory)".
- cloudzip (`cz`, Go): "list and get specific files from remote zip archives without downloading the whole thing"; it also has experimental mounting of a remote zip as a local directory.
- s3-range-zip (npm package s3-range-zip): "Load individual files from zip files on S3 without downloading the entire zip using range parameters."

All three are command line tools or libraries; none is a page in a browser. The hub does the same in the page (site/zip.js; parity row 1: a 100 MB, 201-file zip listed in 1 request, one small file read in 93 bytes). That is the article already written (docs/journal/articles/2026-11-23__look-inside-a-zip-without-downloading-it.md).

## 2. Find an object when you do not know how its name starts

- AWS's S3 User Guide (using-prefixes, read by boto3.aws.a 23 Nov): "Searching by prefix limits the results to only those keys that begin with the specified prefix."
- AWS's Lightsail guide (amazon-lightsail-filtering-bucket-objects, read 23 Nov): Lightsail buckets filter "by name prefix", and only in the open folder: "The list of objects in the folder that you're currently viewing are filtered to match the text you enter." This is Lightsail, not the S3 console; whether the S3 console box is also limited to the open folder is still to confirm (parity tracker).
- The hub today matches that: a filter over the rows listed, and a starts-with search asked of S3 (site/s3.js:245-287). Neither AWS nor the hub finds a name by a word in its middle.

Lesson for the team: "find by a word anywhere in the name" across a large bucket is the next ask to test. It cannot be one S3 call (ListObjectsV2 takes a prefix only), so it needs an index: a candidate for the graph or the vaults (ontology.aws.a, vaults.aws.a), not for a quick fix in the S3 browser.

## 3. .gz objects

Not yet sourced: the search results (re:Post, not read) were about browsers unzipping objects stored with Content-Encoding: gzip on download, and file names changing. To check before writing anything.

## Next

- Read the Stack Overflow and re:Post threads from a browser (or ask Dinis whether another route is allowed), then extend sections 2 and 3.
- Next area: CloudTrail ("what happened, and who did it"), with cloudtrail.aws.a.
