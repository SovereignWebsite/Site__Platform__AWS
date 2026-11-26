// A test helper: make a Vault's -edge stack in us-east-1 (vault-edge.yaml) in the twin's customer account and return
// its CertificateArn, as a Vault stack with a DomainName needs (vault.yaml's rule DomainNeedsCertificate). The clock is
// moved on until the certificate is issued (zone in the account) and the stack is CREATE_COMPLETE.
const CUST = { authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINCUSTOMER/20261124/us-east-1/cloudformation/aws4_request, SignedHeaders=host, Signature=twin" };
export async function edgeCertificate(twin, id, domain, zone = "Z0000000000EXAMPLE") {
  const p = { VaultId: id, DomainName: domain, HostedZoneId: zone }, b = { Action: "CreateStack", StackName: "sws-vault-" + id + "-edge", TemplateURL: "https://example.invalid/vault-edge.yaml" };
  Object.entries(p).forEach(([k, v], i) => { b["Parameters.member." + (i + 1) + ".ParameterKey"] = k; b["Parameters.member." + (i + 1) + ".ParameterValue"] = v; });
  const call = async (body) => (await twin.handle("https://cloudformation.us-east-1.amazonaws.com/", { method: "POST", headers: CUST, body: new URLSearchParams(body).toString() })).text();
  await call(b);
  twin.clock.tick(5 * 60 * 1000);
  const d = await call({ Action: "DescribeStacks", StackName: "sws-vault-" + id + "-edge" });
  const m = /<OutputKey>CertificateArn<\/OutputKey><OutputValue>([^<]+)<\/OutputValue>/.exec(d);
  if (!/<StackStatus>CREATE_COMPLETE</.test(d) || !m) throw new Error("edgeCertificate: the -edge stack did not complete");
  return m[1];
}
