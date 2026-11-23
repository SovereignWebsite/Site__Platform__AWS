"""Runs the kill switch's inline code (vault-alarm.yaml, KillSwitchFunction) against fake AWS clients: it ignores
anything but its own alarm in ALARM, pauses once (throttle to 0, disable, tag both), changes nothing on a second
trigger, and never deletes or restores. Run: python3 -I docs/cloudformation/vault/test_killswitch.py (needs cfn-lint)"""
import os, sys, types
from pathlib import Path
from cfnlint.decode import decode

t, errs = decode(str(Path(__file__).parent / "vault-alarm.yaml"))
if errs: sys.exit(f"FAIL {errs}")
code = t["Resources"]["KillSwitchFunction"]["Properties"]["Code"]["ZipFile"]
calls = []
class Fake:
    def __init__(self, svc, region=None): self.svc, self.region = svc, region
    def __getattr__(self, op):
        def f(**k):
            calls.append((self.svc, op, k))
            if op == "get_function_concurrency": return {"ReservedConcurrentExecutions": state["conc"]} if state["conc"] is not None else {}
            if op == "put_function_concurrency": state["conc"] = k["ReservedConcurrentExecutions"]
            if op == "get_distribution_config": return {"DistributionConfig": {"Enabled": state["enabled"], "CallerReference": "x"}, "ETag": "E1"}
            if op == "update_distribution": state["enabled"] = k["DistributionConfig"]["Enabled"]
            return {}
        return f
sys.modules["boto3"] = types.SimpleNamespace(client=lambda svc, region_name=None: Fake(svc, region_name))
os.environ.update(DISTRIBUTION_ID="EDEMOTWIN00001", FUNCTION_ARN="arn:aws:lambda:eu-west-2:111122223333:function:sws-vault-0123456789ab-api",
                  ALARM_NAMES="sws-vault-0123456789ab-requests,sws-vault-0123456789ab-requests-slow")
ns = {}; exec(compile(code, "index.py", "exec"), ns)
fails = []
def check(ok, m):
    if not ok: fails.append(m)
ev = lambda name, st: {"time": "2026-11-23T20:00:00Z", "alarmData": {"alarmName": name, "state": {"value": st}}}

state = {"conc": 10, "enabled": True}
for e in [ev("other-alarm", "ALARM"), ev("sws-vault-0123456789ab-requests", "OK"), ev("sws-vault-0123456789ab-requests-slower", "ALARM"), ev("sws-vault-0123456789ab", "ALARM"), {}, None]:
    ns["handler"](e, None)
check(not calls, f"acted on a foreign or non-ALARM event: {calls}")

ns["handler"](ev("sws-vault-0123456789ab-requests", "ALARM"), None)
check(state == {"conc": 0, "enabled": False}, f"not paused: {state}")
ops = [(s, o) for s, o, _ in calls]
check(("lambda", "tag_resource") in ops and ("cloudfront", "tag_resource") in ops, "not tagged sws-vault-paused")
upd = [k for s, o, k in calls if o == "update_distribution"][0]
check(upd["IfMatch"] == "E1" and upd["DistributionConfig"]["CallerReference"] == "x", "update without IfMatch or full config")
lam_region = [c for c in calls if c[0] == "lambda"]
n_writes = len([c for c in calls if c[1] in ("put_function_concurrency", "update_distribution", "tag_resource")])

ns["handler"](ev("sws-vault-0123456789ab-requests", "ALARM"), None)
n2 = len([c for c in calls if c[1] in ("put_function_concurrency", "update_distribution", "tag_resource")])
check(n2 == n_writes, "second trigger wrote again")
check(not any("delete" in o.lower() for _, o, _ in calls), "deleted something")
check(state["enabled"] is False and state["conc"] == 0, "restored")

# The slow alarm pauses too, on a fresh Vault.
state.update(conc=10, enabled=True); calls.clear()
ns["handler"](ev("sws-vault-0123456789ab-requests-slow", "ALARM"), None)
check(state == {"conc": 0, "enabled": False}, f"slow alarm did not pause: {state}")

if fails:
    print("FAIL\n  " + "\n  ".join(fails)); sys.exit(1)
print("OK (kill switch: both alarms pause, ignores others, pauses once with IfMatch and tags, no second write, never deletes or restores)")
