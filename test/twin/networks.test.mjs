// Design 03's network split (architect.aws.a, 23 Nov): visitors in 198.51.100.0/24 and 192.0.2.0/24, never in
// 198.51.100.240/28 (EC2 public addresses) nor on 192.0.2.7 (the operator); the attacker in 203.0.113.0/24; the
// operator's calls in CloudTrail from 192.0.2.7. Read from the logs the twin serves, for every pack.
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";
import { packsFromDisk } from "./packs.mjs";

const inNet = (ip, cidr) => {
  const [base, bits] = cidr.split("/"), n = (a) => a.split(".").reduce((x, o) => x * 256 + +o, 0), m = 2 ** (32 - +bits);
  return Math.floor(n(ip) / m) === Math.floor(n(base) / m);
};
let checks = 0;
for (const pack of Object.keys(packsFromDisk())) {
  const twin = loadTwin(pack), N = twin.networks;
  const j = twin.journal();
  const logs = j.filter((e) => e.op === "s3.putObject" && /^cloudfront\//.test(e.data.key));
  const lines = logs.flatMap((e) => e.data.body.gzipText.split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  assert.ok(lines.length > 100, pack + ": log lines");
  const probe = (twin.packs[pack].generate.find((g) => g.gen === "cloudfront.traffic").probe || {}).ip;
  for (const l of lines) {
    if (l.c_ip === probe) { assert.ok(inNet(l.c_ip, N.attacker), pack + ": the attacker is in " + N.attacker); continue; }
    assert.ok(N.visitors.some((c) => inNet(l.c_ip, c)), pack + ": visitor " + l.c_ip + " in a visitor network");
    assert.ok(!N.reserved.some((c) => inNet(l.c_ip, c)), pack + ": visitor " + l.c_ip + " not in a reserved range");
    assert.ok(!inNet(l.c_ip, N.attacker), pack + ": no visitor in the attacker's network");
  }
  checks += lines.length;
  // Visitors spread over both networks, so a /24 filter on the attacker finds only the attacker.
  const nets = new Set(lines.filter((l) => l.c_ip !== probe).map((l) => l.c_ip.split(".").slice(0, 3).join(".")));
  assert.deepEqual([...nets].sort(), ["192.0.2", "198.51.100"], pack + ": visitors in both networks");
  if (probe) assert.equal(lines.filter((l) => inNet(l.c_ip, N.attacker)).every((l) => l.c_ip === probe), true, pack + ": the attacker's /24 holds only the attacker");
  // The operator's calls in CloudTrail come from 192.0.2.7, which no visitor uses.
  const trail = j.filter((e) => e.op === "s3.putObject" && /CloudTrail/.test(e.data.key)).flatMap((e) => JSON.parse(e.data.body.gzipText).Records);
  assert.ok(trail.length && trail.every((r) => r.sourceIPAddress === N.operator), pack + ": CloudTrail calls from the operator");
  assert.ok(!lines.some((l) => l.c_ip === N.operator), pack + ": no visitor on the operator's address");
  checks += 4;
}
console.log("OK (twin networks: " + checks + " checks; visitors in 198.51.100.0/24 and 192.0.2.0/24 outside the reserved ranges, the attacker alone in 203.0.113.0/24, the operator 192.0.2.7)");
