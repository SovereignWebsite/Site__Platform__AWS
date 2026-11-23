// Twin-first scenario for Vault deploy step 9: the CloudTrail records one Vault deployment would leave in a
// customer's account, for the twin owner to replay (dev.1.aws.a, step 4) and for the deployment view to read.
// Synthetic: account 111122223333 and documentation addresses (RFC 5737); names follow cloudformation.aws.a's
// vault.yaml 0.4.0 and iam.aws.a's vault-access.yaml. Written by cloudtrail.aws.a. No network, no DOM.
//
// Story (access-stack mode): the customer, signed in to their console through SSO, creates the access stack; then
// the Vault stack with the deploy role; CloudFormation builds the resources as that role. Optional extras: a
// direct change to the bucket policy from the console (out of band), a refused step, and the teardown.
// Event names and identities per boto3.aws.a's note 09 addendum (b2a8e2c, AWS's pages read 23 Nov 2026):
// CreateFunction20150331 confirmed; CreateFunctionUrlConfig has no suffix; CloudFront: CreateDistributionWithTags
// (tags passed, as vault.yaml does) in us-east-1, *to confirm*. Identity on CloudFormation's calls: consistent with
// the docs, no AWS example; confirm on the first real trail.
(function (root) {
  "use strict";
  function vaultDeploy(o) {
    o = o || {};
    var A = o.account || "111122223333", R = o.region || "eu-west-2", V = o.vaultId || "0a1b2c3d4e5f";
    var t0 = Date.parse(o.start || "2026-11-24T09:00:00Z"), n = 0, out = [];
    var customer = { type: "AssumedRole", principalId: "AROAEXAMPLECUSTOMER:customer", arn: "arn:aws:sts::" + A + ":assumed-role/AWSReservedSSO_AdministratorAccess_0123456789abcdef/customer",
      accountId: A, sessionContext: { sessionIssuer: { type: "Role", arn: "arn:aws:iam::" + A + ":role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_AdministratorAccess_0123456789abcdef", userName: "AWSReservedSSO_AdministratorAccess_0123456789abcdef", accountId: A } } };
    var deployRole = "sws-vault-" + V + "-deploy";
    var deployer = { type: "AssumedRole", principalId: "AROAEXAMPLEDEPLOY:AWSCloudFormation", arn: "arn:aws:sts::" + A + ":assumed-role/" + deployRole + "/AWSCloudFormation",
      accountId: A, invokedBy: "cloudformation.amazonaws.com", sessionContext: { sessionIssuer: { type: "Role", arn: "arn:aws:iam::" + A + ":role/" + deployRole, userName: deployRole, accountId: A } } };
    var viaCfn = Object.assign({}, customer, { invokedBy: "cloudformation.amazonaws.com" }); // the access stack runs as the customer
    function rec(sec, who, source, name, params, x) {
      x = x || {};
      var cfn = who.invokedBy === "cloudformation.amazonaws.com";
      out.push(Object.assign({ eventVersion: "1.09", userIdentity: who, eventTime: new Date(t0 + sec * 1000).toISOString().replace(/\.000Z$/, "Z"),
        eventSource: source, eventName: name, awsRegion: source === "iam.amazonaws.com" || source === "cloudfront.amazonaws.com" ? "us-east-1" : R, // global services
        sourceIPAddress: cfn ? "cloudformation.amazonaws.com" : (x.ip || "198.51.100.23"), userAgent: cfn ? "cloudformation.amazonaws.com" : "Mozilla/5.0 (console)",
        requestParameters: params, responseElements: null, eventID: "vd-" + V + "-" + String(++n).padStart(3, "0"),
        readOnly: false, eventType: "AwsApiCall", managementEvent: true, recipientAccountId: A, eventCategory: "Management" },
        x.error ? { errorCode: x.error, errorMessage: x.message || null } : {}));
    }
    var stack = "sws-vault-" + V, access = stack + "-access", bucket = stack + "-data-" + A + "-" + R, tags = [{ key: "sws-vault", value: V }];
    // 1. the access stack: the deploy role and its boundary, made as the customer
    rec(0, customer, "cloudformation.amazonaws.com", "CreateStack", { stackName: access, templateURL: "https://example.com/vault-access.yaml", capabilities: ["CAPABILITY_NAMED_IAM"], tags: tags });
    rec(20, viaCfn, "iam.amazonaws.com", "CreatePolicy", { policyName: stack + "-boundary" });
    rec(25, viaCfn, "iam.amazonaws.com", "CreateRole", { roleName: deployRole, permissionsBoundary: "arn:aws:iam::" + A + ":policy/" + stack + "-boundary" });
    // 2. the Vault stack, run with the deploy role
    rec(90, customer, "cloudformation.amazonaws.com", "CreateStack", { stackName: stack, roleARN: "arn:aws:iam::" + A + ":role/" + deployRole, parameters: [{ parameterKey: "VaultId", parameterValue: V }, { parameterKey: "DeployMode", parameterValue: "access-stack" }], tags: tags });
    rec(100, deployer, "s3.amazonaws.com", "CreateBucket", { bucketName: bucket });
    rec(104, deployer, "s3.amazonaws.com", "PutBucketPolicy", { bucketName: bucket });
    rec(108, deployer, "secretsmanager.amazonaws.com", "CreateSecret", { name: stack + "-token" });
    rec(112, deployer, "iam.amazonaws.com", "CreateRole", { roleName: stack + "-api", permissionsBoundary: "arn:aws:iam::" + A + ":policy/" + stack + "-boundary" });
    rec(118, deployer, "logs.amazonaws.com", "CreateLogGroup", { logGroupName: "/aws/lambda/" + stack + "-api" });
    rec(125, deployer, "lambda.amazonaws.com", "CreateFunction20150331", { functionName: stack + "-api" });
    rec(130, deployer, "lambda.amazonaws.com", "CreateFunctionUrlConfig", { functionName: stack + "-api" });
    rec(140, deployer, "cloudfront.amazonaws.com", "CreateDistributionWithTags", { distributionConfigWithTags: { distributionConfig: { comment: stack }, tags: { items: [{ key: "sws-vault", value: V }] } } });
    if (o.refused) rec(150, deployer, "route53.amazonaws.com", "ChangeResourceRecordSets", { hostedZoneId: "Z0EXAMPLE", changeBatch: { comment: stack } }, { error: "AccessDenied", message: "not allowed by the boundary" });
    // 3. a direct change from the console: the customer edits the bucket policy by hand
    if (o.outOfBand) rec(3600, customer, "s3.amazonaws.com", "PutBucketPolicy", { bucketName: bucket }, { ip: "203.0.113.50" });
    // 4. teardown: the stacks go; Retain keeps the bucket, its policy and the logs
    if (o.teardown) {
      rec(7200, customer, "cloudformation.amazonaws.com", "DeleteStack", { stackName: stack });
      rec(7210, deployer, "lambda.amazonaws.com", "DeleteFunction20150331", { functionName: stack + "-api" });
      rec(7260, customer, "cloudformation.amazonaws.com", "DeleteStack", { stackName: access });
    }
    return { Records: out };
  }
  root.CloudTrailScenarios = Object.assign(root.CloudTrailScenarios || {}, { vaultDeploy: vaultDeploy });
})(typeof window !== "undefined" ? window : globalThis);
