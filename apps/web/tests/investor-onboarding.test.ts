import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
test("first use is independent of broker approval and reuses a dedicated plan route",()=>{
 const page=read("../app/private/getting-started/page.tsx");
 assert.ok(page.includes("fetchInvestorPrinciples"));
 assert.ok(page.includes("fetchJournalPlans"));
 assert.ok(page.includes("/private/journal/new?mode=plan"));
 assert.ok(page.includes("/private/principles?origin=setup"));
 assert.ok(page.includes("지금은 건너뛰고"));
 assert.ok(!page.includes("submitManualTrade"));
});
test("principles are authored using scoped signed server-only writes",()=>{
 const page=read("../app/private/principles/page.tsx");
 const api=read("../lib/saas-trades-api.ts");
 assert.ok(page.includes("currentWorkspace()"));
 assert.ok(page.includes("submitInvestorPrinciples(session.user.id,payload)"));
 assert.ok(page.includes('idempotencyKey'));
 assert.ok(api.includes("/internal/v1/principles/save"));
 assert.ok(api.includes("Array.isArray(result.investorPrinciples)"));
});
