---
title: "Look inside a zip in your S3 bucket without downloading it"
date: 2026-11-23
time: "03:50"
summary: "Open any zip in S3 from your browser and see what is inside, then read a single file from it, fetching only the bytes you need. Try it now on the twin, with no AWS account."
tags: [aws, s3, zip, twin, browser]
status: draft (journalist.aws.c, figures updated by journalist.aws.a); Dinis Cruz publishes
---

# Look inside a zip in your S3 bucket without downloading it

You have a zip in S3: a Lambda dependency bundle, a log archive, a release. You want to know one thing: is the file you are looking for inside it, and what does it say? Until now that meant downloading the whole zip, unzipping it on your machine and looking. On the AWS Platform Sovereign Website you click the zip and see the list of files inside. Click one file and it opens in the page. You never download the zip.

## What you can do

- **See every file inside a zip**, with its size and date, and filter the list as you type.
- **Open one file** from inside the zip and read it in the page, or save just that file.
- **Still download the whole zip** if you want it: the button is there, with the size on it.

It works for .zip and the formats built on it (.whl, .jar and others), including zip64 files over 4 GB.

## Why it matters to you

The bigger the zip, the more it saves. We measured the page's own code on a 100 MB zip holding 201 files: listing every file took 1 request and 64 KB (65,577 bytes), under a thousandth of the zip. Reading one small text file from inside it took 2 more requests and 93 bytes: its 30-byte header, then its 63 compressed bytes. On a phone, on a slow connection, or with a zip of several gigabytes, that is the difference between waiting and not.

Nothing leaves your browser either. The page talks to S3 directly with credentials that last an hour; there is no server in between that sees your files.

## Try it now, with no AWS account

1. Go to https://aws.platform.sovereignweb.site/ and choose **Try the twin**. The twin is a synthetic AWS that runs in the page: the same calls, made-up data, nothing touches a real account.
2. Press **Read this account**, then open the **S3** tab and press **List buckets**.
3. Open the bucket whose name ends in **demo-lambda-deps--eu-west-2**. The first time you open any bucket, the page shows a plan: S3 lets a web page read a bucket only when the bucket's CORS rules allow it, and the plan adds one rule (read only, from this site only) and keeps any rules already there. Press **Approve**. On the twin this changes nothing real; on your own account, nothing changes until you press it.
4. Open **lambdas-dependencies**, then **demo-handler==v1.0.0.zip**. You see the 4 files inside.
5. Click **demo_handler-1.0.0.dist-info/METADATA**. It opens in the page: 56 bytes, fetched by reading 81 bytes of the zip.

The twin's zip is tiny (797 bytes), so there the saving does not show; the point is the same steps on a zip of any size.

## How it works

A zip keeps its table of contents at the end of the file. S3, like most web servers, will send any slice of a file you ask for (a byte-range request). So the page asks for the last 64 KB of the zip, finds the table of contents, and reads the name, size, date and position of every file inside; when the table of contents sits in those 64 KB, as it does for most zips, that one request is all it takes. To open one file, it asks for that file's short header and then exactly its compressed bytes, and the browser unzips them itself (DecompressionStream). That is about ninety lines of JavaScript, in site/zip.js, with no library.

## What this article does not claim

- The 100 MB figures were measured by running the site's zip.js (dev at 003976e) over a local file of random data on 23 November 2026, not over S3; over S3 the bytes and requests are the same, the time depends on your connection.
- We have not checked every zip variant. Password-protected files are listed but cannot be opened, and only the two common compression methods (stored and deflate) can be unzipped in the browser.
- We do not say the AWS console cannot look inside a zip, only that AWS documents no way to: its S3 console steps offer Download or Download as, one object at a time, and document byte-range reads for the command line and the API only (checked by boto3.aws.c against the S3 User Guide, not in the console).
- This site is unofficial: not made or endorsed by Amazon Web Services. It is built by agents working for Dinis Cruz, who owns it.

## Sources (read 23 November 2026)

- site/zip.js and site/s3.js in https://github.com/SovereignWebsite/Site__Platform__AWS, dev at 9f89cc2; zip.js again at 003976e for the figures.
- The twin, walked in Chromium at 1280 px wide, dev at 9f89cc2.
- AWS S3 User Guide, Downloading objects: https://docs.aws.amazon.com/AmazonS3/latest/userguide/download-objects.html
- The 100 MB measurement: a zip of 200 files of 500,000 random bytes each plus one text file (100,053,181 bytes, made with Python's zipfile, deflate), listed and read with zip.js at 003976e, counting every byte range requested. Before 063967d (s3.aws.c's fix) the listing took 2 requests and 78,233 bytes.
