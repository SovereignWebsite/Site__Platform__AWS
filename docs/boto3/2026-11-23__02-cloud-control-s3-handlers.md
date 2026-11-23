# What Cloud Control needs for `AWS::S3::Bucket`, and what that means for the S3 browser's roles

Written by boto3.aws.a@SovereignWebsite.dinis, 23 Nov 2026, 04:41 UTC wake. Answers open item 1 of docs/boto3/2026-11-23__01-s3-map.md (boto3.aws.c). Read from site/s3.js and site/cloudformation/bootstrap.yaml at dev 1be7f7f and the `AWS::S3::Bucket` resource schema (source below). No AWS endpoint was called; nothing here changes AWS.

## Source

The resource schema's `handlers` section lists the IAM permissions each handler (create, read, update, delete, list) needs. AWS's own copy is in the CloudFormation registry, which needs an AWS call to read (`DescribeType`), so I read the copy that cfn-lint ships, taken from the registry's public schema download for us-east-1:

- cfn-lint 1.61.0 from PyPI, `cfn_lint-1.61.0-py3-none-any.whl` (sha256 `0fe32c20bce54dde16b777f453c071b633a76de75e6ee32e5bb7fc12e052856e`), file `cfnlint/data/schemas/resources/112018f236e91c5c.json`, the entry for `AWS::S3::Bucket` in `cfnlint/data/schemas/providers/us-east-1.json`. Read 23 Nov 2026.

It is a snapshot: AWS adds actions to these lists as S3 grows (this one already has `s3:GetBucketAbac` and the S3 Tables actions). Recheck it when the read role is next written.

## What each call the page makes needs

| Page call (site/s3.js) | Cloud Control handler | S3 permissions the handler lists | Held today |
|---|---|---|---|
| `ListResources` for `AWS::S3::Bucket` (s3.js:43) | list | `s3:ListAllMyBuckets` | Yes: read role `s3:List*` |
| `GetResource` for one bucket, to read `RegionalDomainName` and CORS (s3.js:66) | read | 22 actions: `s3:GetAccelerateConfiguration`, `s3:GetAnalyticsConfiguration`, `s3:GetBucketAbac`, `s3:GetBucketCORS`, `s3:GetBucketDefaultStorageClass`, `s3:GetBucketLogging`, `s3:GetBucketMetadataTableConfiguration`, `s3:GetBucketNotification`, `s3:GetBucketObjectLockConfiguration`, `s3:GetBucketOwnershipControls`, `s3:GetBucketPublicAccessBlock`, `s3:GetBucketTagging`, `s3:GetBucketVersioning`, `s3:GetBucketWebsite`, `s3:GetEncryptionConfiguration`, `s3:GetIntelligentTieringConfiguration`, `s3:GetInventoryConfiguration`, `s3:GetLifecycleConfiguration`, `s3:GetMetricsConfiguration`, `s3:GetReplicationConfiguration`, `s3:ListBucket`, `s3:ListTagsForResource` | Yes: every one starts `s3:Get` or `s3:List` |
| `UpdateResource` with a CORS patch (s3.js:90) | update | 48 actions, the full set for any property, including `iam:PassRole` and every bucket `Put`/`Delete` | Partly: the change role holds `s3:PutBucketCORS` and `s3:Get*`/`s3:List*` only |
| `GetResourceRequestStatus` (s3.js:93) | none (Cloud Control only) | none | Yes |

`RegionalDomainName` is a read-only property of the schema, so `GetResource` is the right place for it; `BucketName` is the identifier.

## What this changes in the S3 map

1. **Section 2's narrowed policy is not enough, as the map feared.** With only `s3:ListBucket` and `s3:GetObject`, bucket listing fails (no `s3:ListAllMyBuckets`) and `GetResource` fails on the configuration reads. A corrected proposal for iam.aws.a and aws.c to weigh, still narrower than `s3:Get*` / `s3:List*` on `*`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Sid": "CloudControlForBuckets", "Effect": "Allow",
         "Action": ["cloudformation:ListResources", "cloudformation:GetResource"], "Resource": "*" },
       { "Sid": "BucketListHandler", "Effect": "Allow",
         "Action": "s3:ListAllMyBuckets", "Resource": "*" },
       { "Sid": "BucketReadHandler", "Effect": "Allow",
         "Action": ["s3:GetAccelerateConfiguration", "s3:GetAnalyticsConfiguration", "s3:GetBucketAbac",
                    "s3:GetBucketCORS", "s3:GetBucketDefaultStorageClass", "s3:GetBucketLogging",
                    "s3:GetBucketMetadataTableConfiguration", "s3:GetBucketNotification",
                    "s3:GetBucketObjectLockConfiguration", "s3:GetBucketOwnershipControls",
                    "s3:GetBucketPublicAccessBlock", "s3:GetBucketTagging", "s3:GetBucketVersioning",
                    "s3:GetBucketWebsite", "s3:GetEncryptionConfiguration",
                    "s3:GetIntelligentTieringConfiguration", "s3:GetInventoryConfiguration",
                    "s3:GetLifecycleConfiguration", "s3:GetMetricsConfiguration",
                    "s3:GetReplicationConfiguration", "s3:ListBucket", "s3:ListTagsForResource"],
         "Resource": "arn:aws:s3:::*" },
       { "Sid": "ReadObjects", "Effect": "Allow",
         "Action": "s3:GetObject", "Resource": "arn:aws:s3:::*/*" }
     ]
   }
   ```

   What it drops compared with today's `s3:Get*`/`s3:List*`: reading bucket policies (`s3:GetBucketPolicy`) and ACLs (`s3:GetBucketAcl`, `s3:GetObjectAcl`), object versions, object tags and object attributes, and listing versions, multipart uploads and access points. The page uses none of these. This narrows R-007 (security.aws.c) without closing it: `s3:GetObject` still reads every object.

   Caveats, not assumed: a few names in the schema (`s3:GetBucketAbac`, `s3:GetBucketDefaultStorageClass`, `s3:GetBucketMetadataTableConfiguration`) are recent. Before this becomes a plan, check each against the Service Authorization Reference for S3, because IAM rejects a policy that names an action it does not know. If one is missing there, keep `s3:Get*` for the bucket statement only and narrow objects separately.

2. **The read handler reads more than the page needs.** The page wants `RegionalDomainName` and CORS; the handler reads 20 other configurations to build the full model. That is how Cloud Control works (one read returns the whole resource), not something the page can trim. A lighter path for the region alone would be S3's `GetBucketLocation`, but that is a bucket call from the browser and needs a CORS rule first, so it cannot replace `GetResource` for a bucket the page has not configured yet. Keep `GetResource`.

3. **The CORS plan may fail live where the twin says it succeeds.** The update handler lists 48 permissions, the full set for any property; the change role holds `s3:PutBucketCORS` and the `s3:Get*`/`s3:List*` reads only. The schema does not say which of the 48 a CORS-only patch actually calls, and AWS documents no per-property breakdown. If the handler calls another `Put` (for example to re-apply tags it read), the plan ends `FAILED` with an access-denied status message: a safe failure, nothing changes. The twin's `UpdateResource` (site/twin.js:214) always succeeds for a valid CORS patch, so this is untested. Suggestion for aws.c: show the `StatusMessage` of a failed `GetResourceRequestStatus` to the owner word for word (s3.js already reads the progress event), and add a twin pack where the handler answers `AccessDenied` so the page's failure path is seen. Not a fix to make before a first live run shows the real answer.

4. **For security.aws.c, no new row, one note on R-006:** `cloudformation:UpdateResource` acts with the caller's own permissions, so for `AWS::S3::Bucket` the change role can only change what its S3 permissions allow (CORS). The update handler also lists `iam:PassRole`, which the change role does not hold, so no patch can make the handler pass a role (for example a replication role). That is what keeps R-006 bounded today.

## Still open

- Which buckets the hub may see (map section 4 item 2): unchanged, for Dinis through pm.aws.c once iam.aws.a has looked.
- Twin fixes Q1 to Q4 (map section 3): patches to site/twin.js for aws.c and architect.aws.c, next wake.
- The action-name check in point 1, against the Service Authorization Reference for S3.

## Addendum, 23 Nov 2026 16:50 UTC: the three recent action names, checked

The caveat above asked for the recent names in the narrowed read policy to be checked against the Service Authorization Reference (SAR) for S3 before it becomes a plan. All 30 action names in this note were compared with the SAR's actions table (https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html) and botocore's S3 model (s3 2006-03-01), both read 23 Nov 2026:

| Action | SAR | botocore operation | Verdict |
|---|---|---|---|
| `s3:GetBucketAbac` | listed ("retrieve ABAC configuration for a general purpose bucket") | `GetBucketAbac` | Confirmed |
| `s3:GetBucketMetadataTableConfiguration` | listed ("return the S3 Metadata configuration for a specified general purpose bucket") | `GetBucketMetadataTableConfiguration` | Confirmed |
| `s3:GetBucketDefaultStorageClass` | **not listed** | **no such operation** | To confirm |

The other 27 names are in the SAR (`s3:Get*` and `s3:List*` in section 2 are wildcards, not names). `s3:GetBucketDefaultStorageClass` is in the AWS::S3::Bucket read handler of the cfn-lint 1.61.0 schema, but neither the SAR nor botocore knows it, and its API reference page has no content. It may be an action AWS has not yet published, or a schema slip. Keep it in the narrowed policy (a name that is not an action matches no call, so it cannot widen anything), and treat a Cloud Control read that fails with AccessDenied on it as the sign to look again. Not a blocker for the read plan.
