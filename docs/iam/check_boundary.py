"""Check P-IAM-001's draft, statement by statement, for both platform roles.

1. Every Allow in a role's own inline policies is covered by a boundary Allow with the same Resource and the same
   Condition (or is cut on purpose), so the boundary breaks nothing the role does today.
2. Every boundary Allow is matched by a role Allow with the same Resource and Condition that grants each of its
   actions, so the boundary is never wider than today (security.aws.a B1, B2: a change set may widen the role's own
   policies up to the boundary, so a boundary on Resource "*" where today is scoped is a way out).
Managed policies attached to the read role (ViewOnlyAccess, SecurityAudit) are not checked: the boundary caps them.
Reads files only; no AWS. Run: python3 -I docs/iam/check_boundary.py  (needs cfn-lint installed for its YAML loader).
"""
import fnmatch, json, sys
from cfnlint.decode.cfn_yaml import load

DRAFT = "docs/iam/proposals/P-IAM-001-v2.4-draft.yaml"

def lst(x): return [x] if isinstance(x, (str, dict)) else list(x)
def key(v): return json.dumps(v, sort_keys=True, default=str)
def covers(pattern, action): return fnmatch.fnmatchcase(action.lower(), pattern.lower())

def stmts(doc): return [s for s in doc["Statement"]]

def check(role_name, boundary_name, res):
    role = res[role_name]["Properties"]; bound = stmts(res[boundary_name]["Properties"]["PolicyDocument"])
    own = [s for p in role.get("Policies", []) for s in stmts(p["PolicyDocument"]) if s["Effect"] == "Allow"]
    b_allow = [s for s in bound if s["Effect"] == "Allow"]
    b_deny = [s for s in bound if s["Effect"] == "Deny"]
    bad = 0
    print("==", role_name, "capped by", boundary_name)
    for s in own:
        for a in lst(s["Action"]):
            ok = [b for b in b_allow if key(b["Resource"]) == key(s["Resource"]) and key(b.get("Condition")) == key(s.get("Condition"))
                  and any(covers(p, a) for p in lst(b["Action"]))]
            denied = [d for d in b_deny if any(covers(p, a) or covers(a, p) for p in lst(d["Action"]))
                      and (d["Resource"] == "*" or key(d["Resource"]) == key(s["Resource"]))]
            if denied:
                print("  cut or narrowed on purpose:", a, "by", ", ".join(d.get("Sid", "?") for d in denied))
            elif not ok:
                print("  NOT COVERED (would break today's use):", a, key(s["Resource"])); bad += 1
    for b in b_allow:
        for a in lst(b["Action"]):
            if not any(key(s["Resource"]) == key(b["Resource"]) and key(s.get("Condition")) == key(b.get("Condition"))
                       and any(covers(p, a) for p in lst(s["Action"])) for s in own):
                print("  BOUNDARY WIDER THAN TODAY:", b.get("Sid"), a, key(b["Resource"])); bad += 1
    return bad

res = load(DRAFT)["Resources"]
bad = check("PlatformChange", "ChangeBoundary", res) + check("PlatformRead", "ReadBoundary", res)
print("problems:", bad)
sys.exit(1 if bad else 0)
