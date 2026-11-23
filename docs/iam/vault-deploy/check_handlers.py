"""For each resource type in the Vault's templates, compare the permissions its CloudFormation handlers list (the
resource schemas cfn-lint ships, a snapshot of the registry) with the deploy role in vault-access.yaml.
A schema lists every permission a handler MAY need, for any property, so "missing" here means "check whether this
template's properties need it", not "certainly broken". Reads files only; no AWS.
Run: python3 -I docs/iam/vault-deploy/check_handlers.py <vault.yaml> [<vault-edge.yaml> ...]"""
import fnmatch, json, os, sys
import cfnlint
from cfnlint.decode.cfn_yaml import load

DATA = os.path.join(os.path.dirname(cfnlint.__file__), "data", "schemas")
ACCESS = "docs/iam/vault-deploy/vault-access.yaml"

def lst(x): return [x] if isinstance(x, str) else list(x)

def role_actions():
    res = load(ACCESS)["Resources"]
    allow, deny = [], []
    for p in res["DeployRole"]["Properties"]["Policies"]:
        for s in p["PolicyDocument"]["Statement"]:
            if isinstance(s, dict) and "Fn::If" in s:
                s = s["Fn::If"][1]
            if not isinstance(s, dict) or "Effect" not in s:
                continue
            (allow if s["Effect"] == "Allow" else deny).append((lst(s["Action"]), s.get("Condition")))
    return allow, deny

def schema(type_name):
    providers = json.load(open(os.path.join(DATA, "providers", "us-east-1.json")))
    f = providers.get(type_name)
    return json.load(open(os.path.join(DATA, "resources", f + ".json"))) if f else None

def matches(a, pats): return any(fnmatch.fnmatchcase(a.lower(), p.lower()) for p in pats)

allow, deny = role_actions()
allow_pats = [a for acts, _ in allow for a in acts]
deny_plain = [a for acts, cond in deny if cond is None for a in acts if a != "*"]
types = sorted({r["Type"] for f in sys.argv[1:] for r in load(f)["Resources"].values()})
print("deploy role allows %d action patterns; templates use %d resource types" % (len(allow_pats), len(types)))
for t in types:
    sc = schema(t)
    if not sc or "handlers" not in sc:
        print("\n%s: no handler permissions in the schema" % t); continue
    print("\n" + t)
    for h in ("create", "update", "delete"):
        perms = sc["handlers"].get(h, {}).get("permissions", [])
        miss = [p for p in perms if not matches(p, allow_pats)]
        denied = [p for p in perms if matches(p, deny_plain)]
        print("  %-6s %2d listed, %2d not allowed%s" % (h, len(perms), len(miss), (": " + ", ".join(miss)) if miss else ""))
        if denied:
            print("         denied on purpose: " + ", ".join(denied))
