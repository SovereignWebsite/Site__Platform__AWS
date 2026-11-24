// The twin's Cost Explorer answers refuse unsigned calls (security.aws.a, R-025 (a)), as every other twin service does;
// a signed call gets the synthetic total. Node 22, no network. Run: node test/twin/costs.test.mjs
import assert from "node:assert/strict";
import { loadTwin } from "./golden.mjs";

const twin = loadTwin("baseline"), CE = "https://ce.us-east-1.amazonaws.com/";
const body = JSON.stringify({ TimePeriod: { Start: "2026-11-01", End: "2026-11-24" }, Granularity: "MONTHLY", Metrics: ["UnblendedCost"] });
const call = async (headers) => { const r = await twin.handle(CE, { method: "POST", headers: Object.assign({ "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSInsightsIndexService.GetCostAndUsage" }, headers), body }); return { status: r.status, json: await r.json() }; };
let checks = 0;
let r = await call({});
assert.equal(r.status, 403, "unsigned: refused"); assert.equal(r.json.__type, "AccessDeniedException"); assert.ok(!("ResultsByTime" in r.json), "no figures without a signature");
r = await call({ authorization: "AWS4-HMAC-SHA256 Credential=AKIAREAL/20261124/us-east-1/ce/aws4_request, SignedHeaders=host, Signature=x" });
assert.equal(r.status, 403, "a credential that is not the twin's: refused");
checks += 4;
r = await call({ authorization: "AWS4-HMAC-SHA256 Credential=ASIATWINREAD/20261124/us-east-1/ce/aws4_request, SignedHeaders=host, Signature=twin" });
assert.equal(r.status, 200); assert.equal(r.json.ResultsByTime[0].Total.UnblendedCost.Unit, "USD", "signed: the synthetic total");
checks += 2;
console.log("OK (twin Cost Explorer: " + checks + " checks; unsigned and foreign credentials refused, signed answered)");
