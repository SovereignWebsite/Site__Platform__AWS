"""Checks on the Vault templates that cfn-lint does not make (security.aws.a's review of 0.1.0, point 7, and the
review's other rules). Run: python3 docs/cloudformation/vault/test_vault_template.py   (needs cfn-lint installed)"""
import re, sys
from pathlib import Path
from cfnlint.decode import decode

HERE = Path(__file__).parent
# AWS's managed cache policy "CachingDisabled". A cached token-gated answer would leak between callers.
# CHECK this id against AWS's managed cache policies page; the test pins it so a change is deliberate.
CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
fails = []
def check(ok, msg):
    if not ok: fails.append(msg)

def load(name):
    t, errs = decode(str(HERE / name))
    if errs: sys.exit(f"FAIL {name}: {errs}")
    return t

def walk(x):
    yield x
    if isinstance(x, dict):
        for v in x.values(): yield from walk(v)
    elif isinstance(x, list):
        for v in x: yield from walk(v)

v = load("vault.yaml")
R = v["Resources"]

# A cap on concurrency by default (security.aws.a condition c).
check(v["Parameters"]["ReservedConcurrency"].get("Default") not in (None, ""), "no default concurrency cap")

# security.aws.a's one-stack condition 2: no Transform, macro or custom resource.
check("Transform" not in v, "Transform present")
check(not any(r["Type"].startswith(("Custom::", "AWS::CloudFormation::CustomResource", "AWS::CloudFormation::Macro")) for r in R.values()), "custom resource or macro present")
check(v["Parameters"]["DeployMode"]["Default"] == "one-stack", "DeployMode default")

# Ids: fixed length, hex, no dash, so names never overlap between Vaults.
check(v["Parameters"]["VaultId"]["AllowedPattern"] == "^[0-9a-f]{12}$", "VaultId pattern")
# The image is pinned by digest.
check(v["Parameters"]["ImageUri"]["AllowedPattern"].endswith("@sha256:[0-9a-f]{64}$"), "ImageUri not pinned by digest")

# Caching: every behaviour uses CachingDisabled; no custom cache policy (which could key on the token header).
dc = R["VaultDistribution"]["Properties"]["DistributionConfig"]
for b in [dc["DefaultCacheBehavior"]] + dc.get("CacheBehaviors", []):
    check(b.get("CachePolicyId") == CACHING_DISABLED, f"cache policy on {b.get('PathPattern', 'default')}")
    check("ForwardedValues" not in b, "legacy ForwardedValues present")
check(not any(r["Type"] == "AWS::CloudFront::CachePolicy" for r in R.values()), "custom cache policy present")

# Data and audit trail are kept on delete.
for n, dp in (("VaultBucket", "RetainExceptOnCreate"), ("VaultBucketPolicy", "RetainExceptOnCreate"), ("VaultLogs", "RetainExceptOnCreate")):
    check(R[n].get("DeletionPolicy") == dp, f"{n} DeletionPolicy")
    check(R[n].get("UpdateReplacePolicy") == "Retain", f"{n} UpdateReplacePolicy")

# Names: every named resource is sws-vault-<id>-* (the deploy role's scope).
name_keys = {"BucketName", "Name", "RoleName", "FunctionName", "LogGroupName", "ManagedPolicyName"}
for n, r in R.items():
    if r["Type"] == "AWS::Route53::RecordSet":
        continue  # the customer's own domain
    for k, val in r.get("Properties", {}).items():
        if k in name_keys and not (isinstance(val, dict) and "Ref" in val):  # a Ref names another resource here
            s = val.get("Fn::Sub") if isinstance(val, dict) else val
            check(isinstance(s, str) and re.match(r"^(/aws/lambda/)?sws-vault-\$\{VaultId\}-", s), f"{n}.{k} not sws-vault-<id>-*: {s}")

# The role: a boundary from the -access stack, no wildcard actions or resources.
role = R["VaultFunctionRole"]["Properties"]
pb = role["PermissionsBoundary"]["Fn::If"]
check(pb[0] == "OneStack" and pb[1] == {"Ref": "VaultBoundary"} and "sws-vault-${VaultId}-boundary" in str(pb[2]), "role boundary in both modes")
check(R["VaultBoundary"].get("Condition") == "OneStack", "in-stack boundary only in one-stack mode")
check(R["VaultBoundary"]["Properties"]["ManagedPolicyName"] == {"Fn::Sub": "sws-vault-${VaultId}-boundary"}, "boundary name")
# DeployPageOrigin: run the pattern itself. fullmatch, as a whole-value match: Python's re.match with "$" would accept
# a trailing newline. (Which regex engine CloudFormation uses for AllowedPattern is not stated here; see note 04.)
origin = re.compile(v["Parameters"]["DeployPageOrigin"]["AllowedPattern"])
for o in ["https://deploy.example.com", "https://deploy.example.com:8443", "https://a.b.example.co.uk", "https://xn--bcher-kva.example"]:
    check(origin.fullmatch(o) is not None, f"DeployPageOrigin refuses good origin {o!r}")
for o in ["https://*.example.com", "https://example.com/x", "http://example.com", "https://example.com.", "https://localhost",
          "https://example.com:0", "https://example.com:099", "https://192.168.0.1", "https://10.0.0.1:443", "https://example.com\n",
          "https://Example.com", "https://example.com?x", "https://user@example.com", "", "https://"]:
    check(origin.fullmatch(o) is None, f"DeployPageOrigin accepts bad origin {o!r}")
for st in walk(role["Policies"]):
    if isinstance(st, dict) and "Effect" in st:
        acts = st["Action"] if isinstance(st["Action"], list) else [st["Action"]]
        check(all("*" not in a for a in acts), f"wildcard action {acts}")
        check(st.get("Resource") != "*", "Resource *")

for st in walk(R["VaultBoundary"]["Properties"]["PolicyDocument"]):
    if isinstance(st, dict) and "Effect" in st:
        check(all("*" not in a for a in st["Action"]), f"wildcard action in boundary {st['Action']}")

# No role trusts anything but lambda.amazonaws.com (no role back to us).
for n, r in R.items():
    if r["Type"] == "AWS::IAM::Role":
        for st in r["Properties"]["AssumeRolePolicyDocument"]["Statement"]:
            check(st["Principal"] == {"Service": "lambda.amazonaws.com"}, f"{n} trusts {st['Principal']}")

# Bucket: TLS only and this account only.
sids = {st["Sid"] for st in R["VaultBucketPolicy"]["Properties"]["PolicyDocument"]["Statement"]}
check({"TlsOnly", "ThisAccountOnly"} <= sids, f"bucket policy {sids}")

# DNS records reference the distribution, so CloudFormation deletes them first.
for n in ("VaultRecordA", "VaultRecordAAAA"):
    check(R[n]["Properties"]["AliasTarget"]["DNSName"] == {"Fn::GetAtt": ["VaultDistribution", "DomainName"]}, f"{n} target")

# /health: CORS for one origin, never "*".
code = R["HealthFunction"]["Properties"]["FunctionCode"]
code = code["Fn::Sub"] if isinstance(code, dict) else code
check('"access-control-allow-origin": { value: "${DeployPageOrigin}" }' in code, "health CORS origin")
check('value: "*"' not in code, "health CORS *")

# Public invoke only through the URL: InvokeFunctionUrl with auth NONE, InvokeFunction only via the URL.
for n, r in R.items():
    if r["Type"] == "AWS::Lambda::Permission" and r["Properties"].get("Principal") == "*":
        pr = r["Properties"]
        ok = (pr["Action"] == "lambda:InvokeFunctionUrl" and pr.get("FunctionUrlAuthType") == "NONE") or \
             (pr["Action"] == "lambda:InvokeFunction" and pr.get("InvokedViaFunctionUrl") is True)
        check(ok, f"{n}: public {pr['Action']} not limited to the Function URL")

# The token secret is always this stack's own (no bring-your-own ARN in v1, security.aws.a).
check("AccessTokenSecretArn" not in v["Parameters"], "bring-your-own token secret present")
check("Condition" not in R["AccessToken"], "AccessToken is conditional")

# The token is never an output.
check(all("SecretString" not in str(o) for o in v["Outputs"].values()), "token in outputs")

e = load("vault-edge.yaml")
check(e["Parameters"]["VaultId"]["AllowedPattern"] == "^[0-9a-f]{12}$", "edge VaultId pattern")
check("OnlyInUsEast1" in e["Rules"], "edge us-east-1 rule")
check(e["Parameters"]["EnableRateLimit"]["Default"] == "false", "rate limit on by default before Dinis decides")
check(e["Resources"]["VaultWebAcl"]["Properties"]["Scope"] == "CLOUDFRONT", "web ACL scope")
check(e["Resources"]["VaultWebAcl"]["Properties"]["Name"] == {"Fn::Sub": "sws-vault-${VaultId}-waf"}, "web ACL name")
check(v["Parameters"]["WebAclArn"].get("Default") == "", "WebAclArn not optional")

if fails:
    print("FAIL\n  " + "\n  ".join(fails)); sys.exit(1)
print("OK (vault templates: caching off, Retain, names, boundary, no wildcards, trust, bucket policy, DNS order, CORS, own token secret, public invoke via URL only, outputs)")
