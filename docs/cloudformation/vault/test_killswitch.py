"""Runs the kill switch's inline code (vault-alarm.yaml, KillSwitchFunction) against fake AWS clients (security.aws.a's
review of 0.2.0): it ignores anything but its two alarms in ALARM; disables the distribution first, then throttles, each
on its own, and raises at the end if either failed; retries a raced config (PreconditionFailed) up to 3 times; tags
both on every ALARM run; writes no lever twice; calls Lambda in the Vault's region; never deletes or restores.
Run: python3 -I docs/cloudformation/vault/test_killswitch.py (needs cfn-lint)"""
import os, sys, types
from pathlib import Path
from cfnlint.decode import decode

t, errs = decode(str(Path(__file__).parent / "vault-alarm.yaml"))
if errs: sys.exit(f"FAIL {errs}")
code = t["Resources"]["KillSwitchFunction"]["Properties"]["Code"]["ZipFile"]
calls, state = [], {}
class ClientError(Exception):
    def __init__(self, c): super().__init__(c); self.response = {"Error": {"Code": c}}
class Fake:
    def __init__(self, svc, region=None): self.svc, self.region = svc, region
    def __getattr__(self, op):
        def f(**k):
            calls.append((self.svc, op, k, self.region))
            fail = state["fail"].get((self.svc, op))
            if fail:
                state["fail"][(self.svc, op)] = fail[1:] or None
                raise ClientError(fail[0])
            if op == "get_function_concurrency": return {"ReservedConcurrentExecutions": state["conc"]}
            if op == "put_function_concurrency": state["conc"] = k["ReservedConcurrentExecutions"]
            if op == "get_distribution_config": return {"DistributionConfig": {"Enabled": state["enabled"], "CallerReference": "x"}, "ETag": "E%d" % len(calls)}
            if op == "update_distribution": state["enabled"] = k["DistributionConfig"]["Enabled"]
            if op == "tag_resource": state["tags"].add((self.svc, k["Resource"]))
            return {}
        return f
sys.modules["boto3"] = types.SimpleNamespace(client=lambda svc, region_name=None: Fake(svc, region_name))
os.environ.update(DISTRIBUTION_ID="EDEMOTWIN00001", DISTRIBUTION_ARN="arn:aws-test:cloudfront::111122223333:distribution/EDEMOTWIN00001",
                  FUNCTION_ARN="arn:aws:lambda:eu-west-2:111122223333:function:sws-vault-0123456789ab-api",
                  ALARM_NAMES="sws-vault-0123456789ab-requests,sws-vault-0123456789ab-requests-slow")
ns = {}; exec(compile(code, "index.py", "exec"), ns)
H = ns["handler"]
fails = []
def check(ok, m):
    if not ok: fails.append(m)
def reset(**k):
    calls.clear(); state.clear(); state.update(conc=10, enabled=True, tags=set(), fail={}); state.update(k)
ev = lambda name, st="ALARM": {"time": "2026-11-23T20:00:00Z", "alarmData": {"alarmName": name, "state": {"value": st}}}
FAST, SLOW = "sws-vault-0123456789ab-requests", "sws-vault-0123456789ab-requests-slow"
writes = lambda: [o for _, o, _, _ in calls if o in ("put_function_concurrency", "update_distribution")]

reset()
for e in [ev("other-alarm"), ev(FAST, "OK"), ev(FAST + "er"), ev("sws-vault-0123456789ab"), {}, None]:
    H(e, None)
check(not calls, "acted on a foreign or non-ALARM event")

for name in (FAST, SLOW):
    reset(); H(ev(name), None)
    check(state["conc"] == 0 and state["enabled"] is False, f"{name} did not pause")
    check(len(state["tags"]) == 2, f"{name}: not both tagged")
ops = [o for _, o, _, _ in calls]
check(ops.index("update_distribution") < ops.index("put_function_concurrency"), "distribution not disabled first")
upd = [k for _, o, k, _ in calls if o == "update_distribution"][0]
check(upd["DistributionConfig"]["CallerReference"] == "x" and upd["IfMatch"], "update without IfMatch or full config")
check(all(r == "eu-west-2" for s, _, _, r in calls if s == "lambda"), "Lambda not called in the Vault's region")
check(any(s == "cloudfront" and o == "tag_resource" and k["Resource"].startswith("arn:aws-test:") for s, o, k, _ in calls), "distribution ARN not from the environment")

n = len(writes()); state["tags"].clear(); H(ev(FAST), None)
check(len(writes()) == n, "second trigger wrote a lever again")
check(len(state["tags"]) == 2, "second trigger did not re-tag (S3)")

# A throttle that raises (wrong region, say): the distribution is still disabled, and the handler raises.
reset(fail={("lambda", "put_function_concurrency"): ["AccessDeniedException"]})
try:
    H(ev(FAST), None); check(False, "throttle failure not raised")
except Exception:
    pass
check(state["enabled"] is False, "throttle failure stopped the distribution lever (S1)")

# A disable that raises: the throttle still happens, and the handler raises.
reset(fail={("cloudfront", "get_distribution_config"): ["Throttling"]})
try:
    H(ev(FAST), None); check(False, "disable failure not raised")
except Exception:
    pass
check(state["conc"] == 0, "distribution failure stopped the throttle")

# PreconditionFailed once: re-read and retry.
reset(fail={("cloudfront", "update_distribution"): ["PreconditionFailed"]})
H(ev(FAST), None)
check(state["enabled"] is False and [o for _, o, _, _ in calls].count("get_distribution_config") == 2, "no retry on PreconditionFailed (S4)")
# PreconditionFailed three times: gives up and raises.
reset(fail={("cloudfront", "update_distribution"): ["PreconditionFailed"] * 3})
try:
    H(ev(FAST), None); check(False, "three PreconditionFailed not raised")
except Exception:
    pass

# A tag failing after the write: the next run tags.
reset(fail={("lambda", "tag_resource"): ["ThrottlingException"]})
try: H(ev(FAST), None)
except Exception: pass
H(ev(FAST), None)
check(("lambda", "arn:aws:lambda:eu-west-2:111122223333:function:sws-vault-0123456789ab-api") in state["tags"], "tag not written on the retry (S3)")

check(not any("delete" in o.lower() for _, o, _, _ in calls), "deleted something")

if fails:
    print("FAIL\n  " + "\n  ".join(fails)); sys.exit(1)
print("OK (kill switch: two alarms; distribution first; each lever on its own and raised; PreconditionFailed retried; tags every run; region; no double write; never deletes)")
