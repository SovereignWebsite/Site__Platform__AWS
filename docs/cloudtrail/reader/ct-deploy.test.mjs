// Tests for docs/cloudtrail/reader/ct-deploy.js over the twin-first scenario docs/cloudtrail/scenarios/vault-deploy.js.
// Run from the repository root: node docs/cloudtrail/reader/ct-deploy.test.mjs
import { readFileSync } from "node:fs";
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b)); };
globalThis.window = globalThis;
for (const f of ["./ct-reader.js", "./ct-alarms.js", "./ct-deploy.js", "../scenarios/vault-deploy.js"]) new Function(readFileSync(new URL(f, import.meta.url), "utf8"))();
const R = globalThis.CloudTrailReader, D = globalThis.CloudTrailDeployments, S = globalThis.CloudTrailScenarios, AL = globalThis.CloudTrailAlarms;
const V = "0a1b2c3d4e5f", W = "ffeeddccbbaa";
const events = (o) => R.read(S.vaultDeploy(o)).events;
const rules = (list) => list.map((a) => a.rule);
let cases = 0; const check = (a, b, m) => { cases++; eq(a, b, m); };

// a clean deployment: one Vault, both stacks, created by the customer's SSO role, every resource call by CloudFormation
let ds = D.group(events());
check(ds.length, 1, "one deployment");
let d = ds[0];
check([d.id, d.account, d.regions, d.state], [V, "111122223333", ["eu-west-2"], "created"], "id, account, regions, state");
check(Object.keys(d.stacks).sort(), ["sws-vault-" + V, "sws-vault-" + V + "-access"], "both stacks");
check(d.by.name, "AWSReservedSSO_AdministratorAccess_0123456789abcdef", "deployed by the customer's role");
check(d.counts, { calls: 12, failed: 0, byCloudFormation: 10, outOfBand: 0 }, "counts");
check(d.events[0].time >= d.events[d.events.length - 1].time, true, "events newest first");
check(D.alarms(ds), [], "a clean deployment raises nothing");
check(AL.run(events()).length, 0, "and no platform alarm either");

// out of band: the customer edits the bucket policy by hand an hour later
ds = D.group(events({ outOfBand: true }));
check(ds[0].counts.outOfBand, 1, "one out-of-band change");
check(rules(D.alarms(ds)), ["vault-out-of-band-change"], "out-of-band alarm");
check(D.alarms(ds)[0].events[0].action, "PutBucketPolicy", "names the call");

// a step refused by the deploy role's boundary: the deployment shows failed
ds = D.group(events({ refused: true }));
check(ds[0].state, "failed", "refused step fails the deployment");
check(rules(D.alarms(ds)), ["vault-deploy-refused"], "refused alarm");

// teardown: both stacks deleted, two deleted alarms (one per stack)
ds = D.group(events({ teardown: true }));
check(ds[0].state, "deleted", "teardown");
check(rules(D.alarms(ds)), ["vault-deleted", "vault-deleted"], "deleted alarms");

// approvals: with a window covering the deploy, quiet; a window that ends too early, or the wrong person, fires
const t = Date.parse("2026-11-24T09:00:00Z");
const role = "AWSReservedSSO_AdministratorAccess_0123456789abcdef";
check(D.alarms(D.group(events()), { approvals: [{ vault: V, from: t, to: t + 3600e3, by: role }] }), [], "approved deploy");
check(rules(D.alarms(D.group(events()), { approvals: [{ vault: V, from: t, to: t + 60e3 }] })), ["vault-change-not-approved"], "second stack outside the window");
check(rules(D.alarms(D.group(events()), { approvals: [{ vault: V, from: t, to: t + 3600e3, by: "someone-else" }] })), ["vault-change-not-approved", "vault-change-not-approved"], "wrong person");
check(rules(D.alarms(D.group(events()), { approvals: [{ vault: W, from: t, to: t + 3600e3 }] })), ["vault-change-not-approved", "vault-change-not-approved"], "approval for another Vault");

// two Vaults in one dump are two deployments, latest activity first; unrelated events are ignored
const both = R.merge([R.read(S.vaultDeploy()), R.read(S.vaultDeploy({ vaultId: W, start: "2026-11-24T12:00:00Z", region: "us-east-1" })),
  R.read({ Records: [{ eventID: "other", eventName: "GetObject", eventSource: "s3.amazonaws.com", eventTime: "2026-11-24T13:00:00Z", requestParameters: { bucketName: "someone-elses" }, userIdentity: { type: "Root" } }] })]).events;
ds = D.group(both);
check(ds.map((x) => [x.id, x.regions]), [[W, ["us-east-1"]], [V, ["eu-west-2"]]], "two Vaults, latest first");

// vaultOf: from a stack, a role, a bucket, a request parameter, or the deploy role's identity; not from 11 or 13 hex digits
const one = (r) => R.normalise(Object.assign({ eventID: "x", eventTime: "2026-11-24T09:00:00Z", eventSource: "s3.amazonaws.com", userIdentity: { type: "Root" } }, r));
check(D.vaultOf(one({ eventName: "PutBucketPolicy", requestParameters: { bucketName: "sws-vault-" + V + "-data-111122223333-eu-west-2" } })), V, "bucket");
check(D.vaultOf(one({ eventName: "CreateLogGroup", eventSource: "logs.amazonaws.com", requestParameters: { logGroupName: "/aws/lambda/sws-vault-" + V + "-api" } })), V, "log group in parameters");
check(D.vaultOf(one({ eventName: "PutBucketPolicy", requestParameters: { bucketName: "sws-vault-0a1b2c3d4e5-data" } })), null, "11 hex digits");
check(D.vaultOf(one({ eventName: "PutBucketPolicy", requestParameters: { bucketName: "sws-vault-0a1b2c3d4e5f0-data" } })), null, "13 hex digits");
check(D.vaultOf(one({ eventName: "GetObject", requestParameters: { bucketName: "b" } })), null, "not a Vault");

// the Vault working (its API role writing data) is not a change to the Vault
const apiPut = one({ eventName: "PutObject", eventCategory: "Management", requestParameters: { bucketName: "sws-vault-" + V + "-data-111122223333-eu-west-2", key: "k" },
  userIdentity: { type: "AssumedRole", sessionContext: { sessionIssuer: { userName: "sws-vault-" + V + "-api", arn: "arn:aws:iam::111122223333:role/sws-vault-" + V + "-api" } } } });
check(rules(D.alarms(D.group([apiPut]))), [], "API role writing data is quiet");
// security.aws.a's review of 7eda626
const base = S.vaultDeploy().Records, A = "111122223333", B = "sws-vault-" + V + "-data-" + A + "-eu-west-2";
const deployId = base.find((r) => r.userIdentity.sessionContext.sessionIssuer.userName === "sws-vault-" + V + "-deploy").userIdentity;
const customerId = base[0].userIdentity;
let rv = 0;
const add = (r) => D.group(R.read({ Records: [...base, Object.assign({ eventVersion: "1.09", eventTime: "2026-11-24T10:00:00Z", awsRegion: "eu-west-2", recipientAccountId: A, eventCategory: "Management", readOnly: false, sourceIPAddress: "198.51.100.23", eventID: "rv-" + (++rv) }, r)] }).events);
check(D.group(events())[0].mode, "access-stack", "scenario is access-stack mode");
// (1) the deploy role used without CloudFormation
const loose = Object.assign({}, deployId); delete loose.invokedBy;
check(rules(D.alarms(add({ userIdentity: loose, eventSource: "s3.amazonaws.com", eventName: "PutBucketPolicy", requestParameters: { bucketName: B } }))).sort(), ["vault-deploy-role-outside-cloudformation", "vault-out-of-band-change"], "deploy role outside CloudFormation");
// (2) a refused direct change
check(rules(D.alarms(add({ userIdentity: customerId, eventSource: "s3.amazonaws.com", eventName: "PutBucketPolicy", requestParameters: { bucketName: B }, errorCode: "AccessDenied" }))), ["vault-direct-change-refused"], "refused direct change");
// (3) token reads: the secret, the function configuration (with a version suffix); quiet for the Vault's own role
check(rules(D.alarms(add({ userIdentity: customerId, eventSource: "secretsmanager.amazonaws.com", eventName: "GetSecretValue", readOnly: true, requestParameters: { secretId: "sws-vault-" + V + "-token" } }))), ["vault-token-read"], "secret read");
check(rules(D.alarms(add({ userIdentity: customerId, eventSource: "lambda.amazonaws.com", eventName: "GetFunctionConfiguration20150331v2", readOnly: true, requestParameters: { functionName: "sws-vault-" + V + "-api" } }))), ["vault-token-read"], "function configuration read");
check(rules(D.alarms(add({ userIdentity: customerId, eventSource: "lambda.amazonaws.com", eventName: "GetFunctionUrlConfig", readOnly: true, requestParameters: { functionName: "sws-vault-" + V + "-api" } }))), [], "URL config read is not a token read");
const apiId = { type: "AssumedRole", sessionContext: { sessionIssuer: { type: "Role", userName: "sws-vault-" + V + "-api", arn: "arn:aws:iam::" + A + ":role/sws-vault-" + V + "-api" } } };
check(rules(D.alarms(add({ userIdentity: apiId, eventSource: "secretsmanager.amazonaws.com", eventName: "GetSecretValue", readOnly: true, requestParameters: { secretId: "sws-vault-" + V + "-token" } }))), [], "the Vault reading its own token");
// (4) access-stack mode: a CloudFormation call on the Vault's resources not as the deploy role is out of band
check(rules(D.alarms(add({ userIdentity: Object.assign({}, customerId, { invokedBy: "cloudformation.amazonaws.com" }), sourceIPAddress: "cloudformation.amazonaws.com", eventSource: "s3.amazonaws.com", eventName: "PutBucketPolicy", requestParameters: { bucketName: B } }))), ["vault-out-of-band-change"], "another stack touching the Vault in access-stack mode");
// one-stack mode: the same call counts as CloudFormation (stated limit)
const oneStack = base.filter((r) => !/-access$/.test(JSON.stringify(r.requestParameters.stackName || ""))).map((r) => { const c = structuredClone(r); if (c.requestParameters.roleARN) delete c.requestParameters.roleARN; if (c.userIdentity.sessionContext.sessionIssuer.userName.endsWith("-deploy")) c.userIdentity = Object.assign({}, customerId, { invokedBy: "cloudformation.amazonaws.com" }); return c; });
const ds1 = D.group(R.read({ Records: oneStack }).events);
check([ds1[0].mode, ds1[0].counts.outOfBand, D.alarms(ds1).length], ["one-stack", 0, 0], "one-stack mode: CloudFormation as the customer is quiet");
// (5) root acting on a Vault resource, even a read
check(rules(D.alarms(add({ userIdentity: { type: "Root", arn: "arn:aws:iam::" + A + ":root" }, eventSource: "s3.amazonaws.com", eventName: "GetBucketPolicy", readOnly: true, requestParameters: { bucketName: B } }))), ["vault-root-activity"], "root read");
// vault.yaml 0.4.5: the deploy role may delete the Vault's log group on rollback; still the audit trail going away
check(rules(D.alarms(add({ userIdentity: deployId, sourceIPAddress: "cloudformation.amazonaws.com", eventSource: "logs.amazonaws.com", eventName: "DeleteLogGroup", requestParameters: { logGroupName: "/aws/lambda/sws-vault-" + V + "-api" } }))), ["vault-deleted"], "log group deleted on rollback");
check(rules(D.alarms(add({ userIdentity: deployId, sourceIPAddress: "cloudformation.amazonaws.com", eventSource: "logs.amazonaws.com", eventName: "DeleteLogGroup", requestParameters: { logGroupName: "/aws/lambda/sws-vault-" + V + "-api" }, errorCode: "AccessDenied" }))), ["vault-deploy-refused"], "refused log group delete");
// the alarm stack (vault-alarm.yaml), run as the customer even in access-stack mode, and its kill switch
ds = D.group(events({ alarm: true }));
check(Object.keys(ds[0].stacks).sort(), ["sws-vault-" + V, "sws-vault-" + V + "-access", "sws-vault-" + V + "-alarm"], "three stacks");
check([ds[0].counts.outOfBand, D.alarms(ds)], [0, []], "the alarm stack's own calls are CloudFormation's, not out of band");
ds = D.group(events({ paused: true }));
check(rules(D.alarms(ds)), ["vault-paused", "vault-paused"], "the kill switch pausing the Vault is a notice, not an out-of-band change");
check(ds[0].counts.outOfBand, 0, "kill switch not counted out of band");
const ksRole = { type: "AssumedRole", sessionContext: { sessionIssuer: { type: "Role", userName: "sws-vault-" + V + "-killswitch", arn: "arn:aws:iam::" + A + ":role/sws-vault-" + V + "-killswitch" } } };
check(rules(D.alarms(add({ userIdentity: ksRole, eventSource: "lambda.amazonaws.com", eventName: "DeleteFunction20150331", requestParameters: { functionName: "sws-vault-" + V + "-api" }, errorCode: "AccessDeniedException" }))), ["vault-direct-change-refused"], "kill switch refused outside its job");
check(rules(D.alarms(add({ userIdentity: customerId, eventSource: "monitoring.amazonaws.com", eventName: "DisableAlarmActions", requestParameters: { alarmNames: ["sws-vault-" + V + "-requests"] } }))), ["vault-out-of-band-change"], "the customer disabling the cost alarm by hand");
// security.aws.a's review of ea31fc5. L1: a mention of an alarm-stack name elsewhere does not make a call the alarm stack's
const viaCfnCustomer = Object.assign({}, customerId, { invokedBy: "cloudformation.amazonaws.com" });
check(rules(D.alarms(add({ userIdentity: viaCfnCustomer, sourceIPAddress: "cloudformation.amazonaws.com", eventSource: "lambda.amazonaws.com", eventName: "UpdateFunctionConfiguration20150331v2",
  requestParameters: { functionName: "sws-vault-" + V + "-api", description: "see sws-vault-" + V + "-killswitch" } }))), ["vault-out-of-band-change"], "L1: a mention in a description is not the alarm stack's");
check(rules(D.alarms(add({ userIdentity: viaCfnCustomer, sourceIPAddress: "cloudformation.amazonaws.com", eventSource: "monitoring.amazonaws.com", eventName: "PutMetricAlarm",
  requestParameters: { alarmName: "sws-vault-" + V + "-requests-slow" } }))), [], "L1: the alarm stack's own named alarm");
// L2: only a pause is a pause
const ks = (name, params, src) => add({ userIdentity: ksRole, sourceIPAddress: "lambda.amazonaws.com", eventSource: src || "lambda.amazonaws.com", eventName: name, requestParameters: params });
check(rules(D.alarms(ks("PutFunctionConcurrency20171031", { functionName: "sws-vault-" + V + "-api", reservedConcurrentExecutions: 5 }))), ["vault-out-of-band-change"], "L2: concurrency above 0 is not a pause");
check(rules(D.alarms(ks("DeleteFunctionConcurrency20171031", { functionName: "sws-vault-" + V + "-api" }))), ["vault-out-of-band-change"], "L2: removing the throttle is not a pause");
check(rules(D.alarms(ks("UpdateDistribution", { id: "E2EXAMPLEVAULT", distributionConfig: { comment: "sws-vault-" + V, enabled: true } }, "cloudfront.amazonaws.com"))), ["vault-out-of-band-change"], "L2: enabling a distribution is not a pause");
check(rules(D.alarms(ks("UpdateDistribution", { id: "E2EXAMPLEVAULT", distributionConfig: { comment: "sws-vault-" + V } }, "cloudfront.amazonaws.com"))), ["vault-out-of-band-change"], "L2: no enabled field, not counted as a pause");
check(rules(D.alarms(ks("TagResource20170331v2", { resource: "arn:aws:lambda:eu-west-2:" + A + ":function:sws-vault-" + V + "-api", tags: { "sws-vault-paused": "true" } }))), [], "L2: the paused tag alone");
check(rules(D.alarms(ks("TagResource20170331v2", { resource: "arn:aws:lambda:eu-west-2:" + A + ":function:sws-vault-" + V + "-api", tags: { "sws-vault-paused": "true", owner: "x" } }))), ["vault-out-of-band-change"], "L2: any other tag is a direct change");
check(D.rules.length, 9, "nine rules");
console.log("ok ct-deploy: 9 rules, " + cases + " cases over the vault-deploy scenario (clean, out of band, refused, teardown, approvals, two Vaults, security review)");
