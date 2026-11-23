// EC2 in the twin: the executable form of design 01 section 2 (docs/ec2/2026-11-23__01-ec2-twin-and-control.md),
// written by ec2.aws.a for dev.1.aws.a, who builds the twin and moves this file to test/twin/ec2.test.mjs with it
// (test/** needs Dinis's yes, as every twin patch). Until the EC2 twin exists every check here fails: that is the point.
// Shapes from boto3.aws.a's note 10 (work/boto3.aws.a 74b9d1f, bcba1ec): Query protocol "ec2", Version 2016-11-15,
// lowercase requestId on success, <Response><Errors>..<RequestID> on error. The twin's HTTP statuses for
// InvalidAction (400), DryRunOperation (412) and UnauthorizedOperation (403) are its own choice (design 01, 2b).
// Node 22, no network. Run: node docs/ec2/twin/ec2.test.mjs (from the repository root)
import { loadTwin } from "../../../test/twin/golden.mjs";

const START = "2026-11-24T09:00:00.000Z";
const CHANGE = "AWS4-HMAC-SHA256 Credential=ASIATWINCHANGE/20261124/REGION/ec2/aws4_request, SignedHeaders=host, Signature=twin";
const READ = "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/REGION/ec2/aws4_request, SignedHeaders=host, Signature=twin";
let passed = 0, failures = 0;
const ok = (c, m) => { if (c) passed++; else { failures++; console.error("FAIL", m); } };
const seen = []; // every answer body, for the "never key material" check

// One EC2 Query call. params: flat object of the wire's numbered names.
async function ec2(twin, region, params, { auth = CHANGE, host } = {}) {
  const url = "https://" + (host || "ec2." + region + ".amazonaws.com") + "/";
  const headers = { "content-type": "application/x-www-form-urlencoded; charset=utf-8" };
  if (auth) headers.authorization = auth.replace("REGION", region);
  const body = new URLSearchParams(Object.assign({ Version: "2016-11-15" }, params)).toString();
  const r = await twin.handle(url, { method: "POST", headers, body });
  const text = await r.text();
  seen.push(text);
  return { status: r.status, text, code: (/<Code>([^<]*)<\/Code>/.exec(text) || [])[1] || null };
}
const all = (x, t) => [...x.matchAll(new RegExp("<" + t + ">([^<]*)</" + t + ">", "g"))].map((m) => m[1]);
const one = (x, t) => all(x, t)[0];
const stateOf = async (twin, region, id) => {
  const r = await ec2(twin, region, { Action: "DescribeInstances", "InstanceId.1": id }, { auth: READ });
  const m = /<instanceState>\s*<code>\d+<\/code>\s*<name>([a-z-]+)<\/name>/.exec(r.text);
  return m ? m[1] : null;
};
const tags = (expires) => ({
  "TagSpecification.1.ResourceType": "instance",
  "TagSpecification.1.Tag.1.Key": "sws:managed", "TagSpecification.1.Tag.1.Value": "true",
  "TagSpecification.1.Tag.2.Key": "sws:owner", "TagSpecification.1.Tag.2.Value": "sws-ec2-test",
  "TagSpecification.1.Tag.3.Key": "sws:expires-at", "TagSpecification.1.Tag.3.Value": expires,
  "TagSpecification.2.ResourceType": "volume",
  "TagSpecification.2.Tag.1.Key": "sws:managed", "TagSpecification.2.Tag.1.Value": "true",
  "TagSpecification.2.Tag.2.Key": "sws:owner", "TagSpecification.2.Tag.2.Value": "sws-ec2-test",
  "TagSpecification.2.Tag.3.Key": "sws:expires-at", "TagSpecification.2.Tag.3.Value": expires
});
const inTwoHours = new Date(Date.parse(START) + 2 * 3600e3).toISOString();
function fresh() { const t = loadTwin("baseline"); t.clock.pause(); t.clock.at(START); return t; }
async function selfImage(twin) { return one((await ec2(twin, "eu-west-2", { Action: "DescribeImages", "Owner.1": "self" }, { auth: READ })).text, "imageId"); }
async function launchParams(twin, extra = {}) {
  return Object.assign({ Action: "RunInstances", ImageId: await selfImage(twin), InstanceType: "t4g.small", MinCount: "1", MaxCount: "1",
    "MetadataOptions.HttpTokens": "required", "CreditSpecification.CpuCredits": "standard" }, tags(inTwoHours), extra);
}
const len = (twin) => twin.journal().length;

// ---- 1. Signed calls only (2h.1); the global host answers too (2a). ----
{
  const t = fresh();
  const r = await ec2(t, "eu-west-2", { Action: "DescribeRegions" }, { auth: null });
  ok(r.status === 403 && r.code === "MissingAuthenticationToken", "1: an unsigned call is refused with MissingAuthenticationToken, 403");
  const g = await ec2(t, "us-east-1", { Action: "DescribeRegions" }, { auth: READ, host: "ec2.amazonaws.com" });
  ok(g.status === 200 && /<DescribeRegionsResponse/.test(g.text) && /<requestId>/.test(g.text), "1: the global host ec2.amazonaws.com answers, with a lowercase requestId");
  const x = await ec2(t, "eu-west-2", { Action: "DescribeInstanceAttribute", InstanceId: "i-0123456789abcdef0", Attribute: "userData" }, { auth: READ });
  ok(x.code === "InvalidAction" && /<Response><Errors>/.test(x.text) && /<RequestID>/.test(x.text), "1: an action outside 2b is InvalidAction, in the error envelope with RequestID");
}

// ---- 2. Seed (2g): regions, the instances in eu-west-2 only, a default VPC everywhere, no key pairs. ----
{
  const t = fresh();
  const regions = all((await ec2(t, "eu-west-2", { Action: "DescribeRegions" }, { auth: READ })).text, "regionName");
  ok(regions.includes("eu-west-2") && regions.includes("eu-west-1"), "2: DescribeRegions lists eu-west-2 and eu-west-1");
  const lon = (await ec2(t, "eu-west-2", { Action: "DescribeInstances" }, { auth: READ })).text;
  ok(/<value>demo-ec2-vault<\/value>/.test(lon) && /<name>stopped<\/name>/.test(lon), "2: demo-ec2-vault is in eu-west-2, stopped");
  ok(/<key>sws:expires-at<\/key>/.test(lon), "2: the seed instance carries an expiry (overdue, for the read page)");
  ok(/<value>demo-not-ours<\/value>/.test(lon), "2: an unmanaged instance demo-not-ours is in eu-west-2, so rule 6 and the read page's flag are testable");
  for (const rg of regions) {
    const r = (await ec2(t, rg, { Action: "DescribeInstances" }, { auth: READ })).text;
    if (rg !== "eu-west-2") ok(!/<instanceId>/.test(r), "2: no instances in " + rg);
    const sg = (await ec2(t, rg, { Action: "DescribeSecurityGroups" }, { auth: READ })).text;
    ok(/<groupName>default<\/groupName>/.test(sg), "2: a default security group in " + rg);
  }
  const kp = (await ec2(t, "eu-west-2", { Action: "DescribeKeyPairs" }, { auth: READ })).text;
  ok(!/<keyName>/.test(kp) && !/nextToken/.test(kp), "2: no key pairs, and no paging on DescribeKeyPairs");
}

// ---- 3. RunInstances: pending, then running on the clock; the journal's actors (2h.4, 2d). ----
let launched;
{
  const t = fresh();
  const n0 = len(t);
  const r = await ec2(t, "eu-west-2", await launchParams(t));
  launched = one(r.text, "instanceId");
  ok(r.status === 200 && /^i-[0-9a-f]{17}$/.test(launched || ""), "3: RunInstances returns an i- id of 17 hex digits");
  ok(/<name>pending<\/name>/.test(r.text) && /<code>0<\/code>/.test(r.text), "3: the new instance is pending (code 0)");
  const j = t.journal().slice(n0);
  ok(j.some((e) => e.op === "ec2.runInstance" && e.actor === "role:sws-aws-platform-change" && /:instance\/i-/.test(e.target)), "3: ec2.runInstance with the caller as actor and the instance ARN as target");
  ok(j.some((e) => e.op === "ec2.runInstance" && Array.isArray(e.schedule) && e.schedule.some((s) => s.op === "ec2.setState" && s.actor === "aws:ec2")), "3: the launch schedules its settle (clock schedule form)");
  const n1 = len(t);
  await ec2(t, "eu-west-2", { Action: "DescribeInstances" }, { auth: READ });
  ok(len(t) === n1, "3: a read with the clock paused writes nothing");
  t.clock.tick(60e3);
  ok(await stateOf(t, "eu-west-2", launched) === "running", "3: running after the clock passes the settle");
  ok(t.journal().some((e) => e.op === "ec2.setState" && e.actor === "aws:ec2" && e.why === "clock.settle" && e.source === "clock"), "3: the settle is the clock's, actor aws:ec2, why clock.settle");
  const v = (await ec2(t, "eu-west-2", { Action: "DescribeVolumes" }, { auth: READ })).text;
  ok(/<encrypted>true<\/encrypted>/.test(v), "3: the root volume is encrypted (DescribeVolumes, not the Instance shape)");
  const c = (await ec2(t, "eu-west-2", { Action: "DescribeInstanceCreditSpecifications", "InstanceId.1": launched }, { auth: READ })).text;
  ok(/<cpuCredits>standard<\/cpuCredits>/.test(c), "3: credit mode standard (DescribeInstanceCreditSpecifications)");
}

// ---- 4. Stop, start, terminate, forget (2h.5, 2d). ----
{
  const t = fresh();
  const id = one((await ec2(t, "eu-west-2", await launchParams(t))).text, "instanceId"); t.clock.tick(60e3);
  let r = await ec2(t, "eu-west-2", { Action: "StopInstances", "InstanceId.1": id });
  ok(/<stoppingInstancesSet>/.test(r.text) && /<currentState>\s*<code>64<\/code>\s*<name>stopping/.test(r.text) && /<previousState>\s*<code>16<\/code>\s*<name>running/.test(r.text), "4: StopInstances: stopping (64) from running (16)");
  t.clock.tick(60e3); ok(await stateOf(t, "eu-west-2", id) === "stopped", "4: stopped after the settle");
  r = await ec2(t, "eu-west-2", { Action: "StartInstances", "InstanceId.1": id });
  ok(/<startingInstancesSet>/.test(r.text) && /<name>pending<\/name>/.test(r.text), "4: StartInstances: pending");
  t.clock.tick(60e3); ok(await stateOf(t, "eu-west-2", id) === "running", "4: running again after the settle");
  r = await ec2(t, "eu-west-2", { Action: "TerminateInstances", "InstanceId.1": id });
  ok(/<terminatingInstancesSet>/.test(r.text) && /<name>shutting-down<\/name>/.test(r.text), "4: TerminateInstances: shutting-down");
  t.clock.tick(60e3); ok(await stateOf(t, "eu-west-2", id) === "terminated", "4: terminated after the settle");
  r = await ec2(t, "eu-west-2", { Action: "TerminateInstances", "InstanceId.1": id });
  ok(r.status === 200, "4: terminating a terminated instance succeeds (idempotent)");
  t.clock.tick(2 * 3600e3);
  r = await ec2(t, "eu-west-2", { Action: "DescribeInstances", "InstanceId.1": id }, { auth: READ });
  ok(r.code === "InvalidInstanceID.NotFound", "4: forgotten after about an hour (ec2.forget): InvalidInstanceID.NotFound");
  ok(t.journal().some((e) => e.op === "ec2.forget" && e.actor === "aws:ec2"), "4: the forget is an ec2.forget entry by aws:ec2");
}

// ---- 5. What the twin refuses (2f), each with nothing written to the journal (2h.6). ----
{
  const t = fresh();
  const refuse = async (label, region, params, code = "UnauthorizedOperation") => {
    const n = len(t); const r = await ec2(t, region, params);
    ok(r.code === code && len(t) === n, "5: " + label + " is refused (" + code + ") and writes nothing");
  };
  const base = await launchParams(t);
  const without = (k) => { const p = Object.assign({}, base); delete p[k]; return p; };
  await refuse("a launch without sws:expires-at on the instance", "eu-west-2", Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith("TagSpecification.1.Tag.3"))));
  await refuse("a launch in a region not allowed", "us-east-1", base);
  await refuse("an expiry past the maximum lifetime", "eu-west-2", Object.assign({}, base, tags(new Date(Date.parse(START) + 365 * 86400e3).toISOString())));
  await refuse("HttpTokens optional", "eu-west-2", Object.assign({}, base, { "MetadataOptions.HttpTokens": "optional" }));
  await refuse("HttpTokens omitted", "eu-west-2", without("MetadataOptions.HttpTokens"));
  await refuse("CpuCredits unlimited", "eu-west-2", Object.assign({}, base, { "CreditSpecification.CpuCredits": "unlimited" }));
  await refuse("CpuCredits omitted (the t4g default is unlimited)", "eu-west-2", without("CreditSpecification.CpuCredits"));
  await refuse("an instance type not on the list", "eu-west-2", Object.assign({}, base, { InstanceType: "m5.large" }));
  await refuse("an AMI not on the allow list", "eu-west-2", Object.assign({}, base, { ImageId: "ami-0123456789abcdef0" }));
  await refuse("a key pair", "eu-west-2", Object.assign({}, base, { KeyName: "anything" }));
  const id = one((await ec2(t, "eu-west-2", base)).text, "instanceId"); t.clock.tick(60e3);
  await refuse("pushing back sws:expires-at after launch", "eu-west-2", { Action: "CreateTags", "ResourceId.1": id, "Tag.1.Key": "sws:expires-at", "Tag.1.Value": "2027-01-01T00:00:00Z" });
  await refuse("removing sws:managed after launch", "eu-west-2", { Action: "DeleteTags", "ResourceId.1": id, "Tag.1.Key": "sws:managed" });
  const notOurs = /<instanceId>(i-[0-9a-f]+)<\/instanceId>[\s\S]*?<value>demo-not-ours<\/value>/.exec((await ec2(t, "eu-west-2", { Action: "DescribeInstances" }, { auth: READ })).text);
  if (notOurs) {
    await refuse("stopping an instance not tagged sws:managed", "eu-west-2", { Action: "StopInstances", "InstanceId.1": notOurs[1] });
    await refuse("terminating an instance not tagged sws:managed", "eu-west-2", { Action: "TerminateInstances", "InstanceId.1": notOurs[1] });
  } else ok(false, "5: demo-not-ours not found, rule 6 untested");
  const sg = one((await ec2(t, "eu-west-2", { Action: "CreateSecurityGroup", GroupName: "sws-ec2-test", GroupDescription: "test" })).text, "groupId");
  await refuse("SSH open to the internet", "eu-west-2", { Action: "AuthorizeSecurityGroupIngress", GroupId: sg, "IpPermissions.1.IpProtocol": "tcp", "IpPermissions.1.FromPort": "22", "IpPermissions.1.ToPort": "22", "IpPermissions.1.IpRanges.1.CidrIp": "0.0.0.0/0" });
  await refuse("CreateKeyPair (a twin refusal: no private key passes through the page)", "eu-west-2", { Action: "CreateKeyPair", KeyName: "anything" });
  await refuse("ModifyInstanceAttribute (user data)", "eu-west-2", { Action: "ModifyInstanceAttribute", InstanceId: id, "UserData.Value": "eA==" }, "InvalidAction");
}

// ---- 6. EC2 behaviours the twin mimics (2b, boto3.aws.a's section 10). ----
{
  const t = fresh();
  const base = await launchParams(t);
  let n = len(t), r = await ec2(t, "eu-west-2", Object.assign({}, base, { DryRun: "true" }));
  ok(r.code === "DryRunOperation" && len(t) === n, "6: DryRun on an allowed launch is DryRunOperation and writes nothing");
  r = await ec2(t, "eu-west-2", Object.assign({}, base, { DryRun: "true", InstanceType: "m5.large" }));
  ok(r.code === "UnauthorizedOperation" && len(t) === n, "6: DryRun on a refused launch is UnauthorizedOperation (a refusal outranks the dry run)");
  const a = one((await ec2(t, "eu-west-2", Object.assign({}, base, { ClientToken: "tok-1" }))).text, "instanceId");
  n = len(t);
  const b = one((await ec2(t, "eu-west-2", Object.assign({}, base, { ClientToken: "tok-1" }))).text, "instanceId");
  ok(a && a === b && len(t) === n, "6: the same ClientToken and parameters return the first instance and launch nothing");
  r = await ec2(t, "eu-west-2", Object.assign({}, base, { ClientToken: "tok-1", InstanceType: "t4g.nano" }));
  ok(r.code === "IdempotentParameterMismatch", "6: the same ClientToken with other parameters is IdempotentParameterMismatch");
  t.clock.tick(60e3);
  r = await ec2(t, "eu-west-2", { Action: "StartInstances", "InstanceId.1": a });
  ok(r.code === "IncorrectInstanceState", "6: starting a running instance is IncorrectInstanceState");
  n = len(t);
  r = await ec2(t, "eu-west-2", { Action: "StopInstances", "InstanceId.1": a, "InstanceId.2": "i-00000000000000000" });
  ok(r.code === "InvalidInstanceID.NotFound" && len(t) === n && await stateOf(t, "eu-west-2", a) === "running", "6: one unknown id fails the whole call; the good one is untouched");
  r = await ec2(t, "eu-west-2", { Action: "DescribeInstances", "InstanceId.1": "i-xyz" }, { auth: READ });
  ok(r.code === "InvalidInstanceID.Malformed", "6: a malformed id is InvalidInstanceID.Malformed");
  r = await ec2(t, "eu-west-2", { Action: "DescribeInstances", MaxResults: "5", "InstanceId.1": a }, { auth: READ });
  ok(r.code === "InvalidParameterCombination", "6: MaxResults with InstanceIds is InvalidParameterCombination");
  r = await ec2(t, "eu-west-2", Object.assign({}, base, { MinCount: "50", MaxCount: "50" }));
  ok(r.code === "VcpuLimitExceeded" || r.code === "InstanceLimitExceeded", "6: a launch above the pack's vCPU limit is refused");
}

// ---- 7. Paging: every instance exactly once, an empty page may carry a token, order not relied on (2b). ----
{
  const t = fresh();
  const whole = new Set(all((await ec2(t, "eu-west-2", { Action: "DescribeInstances" }, { auth: READ })).text, "instanceId"));
  const got = []; let token = null, pages = 0, emptyWithToken = false;
  do {
    const p = { Action: "DescribeInstances", MaxResults: "5" }; if (token) p.NextToken = token;
    const r = (await ec2(t, "eu-west-2", p, { auth: READ })).text;
    const ids = all(r, "instanceId"); got.push(...ids); token = one(r, "nextToken") || null; pages++;
    if (!ids.length && token) emptyWithToken = true;
  } while (token && pages < 50);
  ok(got.length === whole.size && got.every((i) => whole.has(i)), "7: paging returns every instance exactly once");
  const r = await ec2(t, "eu-west-2", { Action: "DescribeInstances", MaxResults: "5", NextToken: "not-a-token" }, { auth: READ });
  ok(r.code === "InvalidPaginationToken", "7: a bad token is InvalidPaginationToken");
  if (!emptyWithToken) console.log("note 7: no empty page with a token seen; the twin should return one once in its paging (design 01, 2b)");
}

// ---- 8. Same history however it is read (2h.9, architect.aws.a); same ids for the same run (2c). ----
{
  const run = async (reads) => {
    const t = fresh();
    const id = one((await ec2(t, "eu-west-2", await launchParams(t))).text, "instanceId");
    let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const advance = async (ms) => {
      if (!reads) { t.clock.tick(ms); return; }
      for (let done = 0; done < ms;) { const s = Math.min(ms - done, Math.floor(rnd() * 7000) + 1); t.clock.tick(s); done += s; if (rnd() < 0.5) await stateOf(t, "eu-west-2", id); }
    };
    await advance(60e3);
    await ec2(t, "eu-west-2", { Action: "StopInstances", "InstanceId.1": id }); await advance(60e3);
    await ec2(t, "eu-west-2", { Action: "StartInstances", "InstanceId.1": id }); await advance(60e3);
    return t.journal().map((e) => ({ op: e.op, t: e.t, actor: e.actor, target: e.target, why: e.why }));
  };
  const once = await run(false), many = await run(true);
  ok(JSON.stringify(once) === JSON.stringify(many), "8: one tick past every at and many ticks with reads between give the same journal");
  const settles = once.filter((e) => e.op === "ec2.setState" && e.why === "clock.settle");
  ok(settles.length >= 3 && settles.every((e, i, a) => i === 0 || e.t >= a[i - 1].t), "8: settles carry t = at, in at order");
  const again = await run(false);
  ok(JSON.stringify(once) === JSON.stringify(again), "8: the same run gives the same ids and targets (made once, at write)");
}

// ---- 9. Never key material, anywhere (2h.7). ----
ok(!seen.some((x) => /BEGIN [A-Z ]*PRIVATE KEY/.test(x) || /<keyMaterial>/.test(x)), "9: no answer contains a private key or keyMaterial");

console.log(passed + " passed, " + failures + " failed");
process.exitCode = failures ? 1 : 0;
