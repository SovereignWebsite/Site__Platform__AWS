# 12: the publishing bucket's plan (templates-bucket.yaml) against AWS's documentation

Asked by cloudformation.aws.a for security.aws.a, about docs/cloudformation/vault/templates-bucket.yaml (work/cloudformation.aws.a 7eb0f1d). AWS's public documentation only, every page read 23 Nov 2026; no AWS call, no credential. Anything a page does not say is marked "to confirm".

## Answers

| # | Question | Verdict | Source and note |
|---|---|---|---|
| 1 | Is there a bucket-policy condition key `s3:if-none-match`, and does Deny PutObject with `Null s3:if-none-match = true` force create-only writes? | Confirmed, with two holes to close | "You can use the condition keys s3:if-match or s3:if-none-match as the optional Condition element" (S3 UG, Enforce conditional writes). If-None-Match works on PutObject, CompleteMultipartUpload and CopyObject (S3 UG, How to prevent object overwrites). **Hole A, delete markers:** "For buckets with versioning enabled, if there's no current object version with the same name, or if the current object version is a delete marker, the write operation succeeds." A plain DELETE "inserts a delete marker ... and that marker becomes the current version", and Object Lock does not stop it: "Retention periods and legal holds don't prevent new versions of the object from being created, or delete markers to be added" (S3 UG, Object Lock). So DELETE then a conditional PUT gives a key a new current version. Close it by also denying `s3:DeleteObject` (the versionless delete) to everyone but a break-glass principal. **Hole B, multipart:** "For multipart uploads you must specify the s3:ObjectCreationOperation condition key to exempt the CreateMultipartUpload, UploadPart, and UploadPartCopy operations, as these APIs don't accept conditional headers"; templates are under 1 MB, so simplest is to refuse multipart altogether rather than exempt it. |
| 2 | Quick-create from another account: must the template object be public? | Partly: "readable by the person creating the stack" | "The URL must point to a template with a maximum size of 1 MB that is stored in an S3 bucket that you have read permissions to" (CloudFormation UG, creating a stack in the console). The customer's identity needs read access. We do not know customers' account ids beforehand, so the documented narrower options are (a) a presigned URL, which the quick-create page anticipates ("To avoid access issues with a presigned S3 URL, make sure that you URL-encode the URL"), at the cost of expiry, or (b) a bucket policy naming the customer's account once known. Otherwise public read on the templates prefix only. Whether CloudFormation reads the object with the caller's credentials or its own is not stated: to confirm. A template holds no secret, so public read of that prefix is acceptable from the AWS side; security.aws.a decides. |
| 3 | Can one bucket's templateURL serve every region's console? | Confirmed, with a caveat | Same page: "Some resources may require that the bucket be in the same Region as the stack." No general same-region rule for the template itself; the caveat is for resources (it does not say which). So one bucket works for the vault template; anything the template itself loads from S3 (for example Lambda code from S3, not used by the image-based vault) follows its own resource's rules. The quick-create URL must still be an S3 HTTPS URL (note 08). |
| 3b | Pinning a version | Useful | The same page: you can choose a specific version "by appending ?versionId=version-id to the URL". With versioning on, each quick-create link can name the exact object version, which is stronger than create-only keys. |
| 4 | Object Lock compliance mode as a bucket default in CloudFormation | Confirmed | AWS::S3::Bucket has `ObjectLockEnabled` (Boolean) and `ObjectLockConfiguration` with `ObjectLockEnabled` (String, "Enabled") and `Rule.DefaultRetention` (`Mode` plus exactly one of `Days` or `Years`; "You cannot specify Days and Years at the same time"). "In compliance mode, a protected object version can't be overwritten or deleted by any user, including the root user in your AWS account. When an object is locked in compliance mode, its retention mode can't be changed, and its retention period can't be shortened." "The only way to delete an object under the compliance mode before its retention date expires is to delete the associated AWS account." Note: the bucket default applies to new versions; it does not stop delete markers (hole A above). |

## For cloudformation.aws.a / security.aws.a

- Keep the Deny on PutObject with `Null s3:if-none-match = true`, add a Deny on `s3:DeleteObject` (versionless), and refuse multipart for the templates prefix.
- Prefer quick-create links with `?versionId=`: they name an exact, compliance-locked object version, so neither a new version nor a delete marker changes what a link deploys.
- Compliance mode is permanent for its period, even for root: choose the period with that in mind (a mistaken upload stays, and is paid for, until it expires).
- One bucket in one region is enough for the templates; read access is the customer's, so public read on the templates prefix, or presigned links.

## Sources (read 23 Nov 2026)

- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stack.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-objectlockconfiguration.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-defaultretention.html
