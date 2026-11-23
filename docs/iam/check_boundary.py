"""Check P-IAM-001's draft: every action the change role's own policies grant is either allowed by its
boundary or denied on purpose, and nothing outside today's grants is allowed. Reads files only; no AWS.
Run: python3 -I docs/iam/check_boundary.py  (needs cfn-lint for its CloudFormation YAML loader)."""
import fnmatch, sys
from cfnlint.decode.cfn_yaml import load

DRAFT = "docs/iam/proposals/P-IAM-001-v2.2-draft.yaml"
ON_PURPOSE = {"iam:UpdateRole": "sets MaxSessionDuration (roles.md I-2)",
              "s3:GetObject*": "the change role never reads objects (usage.md)"}

def actions(stmt):
    a = stmt["Action"]
    return [a] if isinstance(a, str) else list(a)

def matches(action, patterns):
    return any(fnmatch.fnmatchcase(action.lower(), p.lower()) or fnmatch.fnmatchcase(p.lower(), action.lower()) for p in patterns)

t = load(DRAFT)["Resources"]
granted = [a for p in t["PlatformChange"]["Properties"]["Policies"] for s in p["PolicyDocument"]["Statement"] if s["Effect"] == "Allow" for a in actions(s)]
bound = t["ChangeBoundary"]["Properties"]["PolicyDocument"]["Statement"]
allow = [a for s in bound if s["Effect"] == "Allow" for a in actions(s)]
deny_all = [a for s in bound if s["Effect"] == "Deny" and s["Resource"] == "*" for a in actions(s)]

bad = 0
for a in granted:
    why = next((v for k, v in ON_PURPOSE.items() if matches(a, [k])), None)
    if why and a.lower() == next(k for k in ON_PURPOSE if matches(a, [k])).lower():
        print("cut on purpose: %s (%s)" % (a, why))
    elif not matches(a, allow):
        print("NOT IN BOUNDARY:", a); bad += 1
    elif why:
        print("narrowed on purpose: %s, except what %s denies (%s)" % (a, next(k for k in ON_PURPOSE if matches(a, [k])), why))
    elif matches(a, deny_all):
        print("DENIED, NOT ON PURPOSE:", a); bad += 1
for a in allow:
    if not matches(a, granted):
        print("BOUNDARY WIDER THAN TODAY:", a); bad += 1
print("granted %d, boundary allows %d, problems %d" % (len(granted), len(allow), bad))
sys.exit(1 if bad else 0)
