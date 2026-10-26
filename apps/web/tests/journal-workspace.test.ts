import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relative:string){
  return readFileSync(fileURLToPath(new URL(relative,import.meta.url)),"utf8");
}

test("journal private page rechecks authentication and uses server actions without runtime feature flag",()=>{
  const page=source("../app/private/journal/page.tsx");
  assert.ok(page.includes("currentWorkspace()"));
  assert.ok(page.includes("auth()"));
  assert.ok(!page.includes("manualTradeEnabled"));
  assert.ok(!page.includes(["SAAS","S2","ENABLED"].join("_")));
  assert.ok(source("../app/private/journal/new/page.tsx").includes("submitJournalPlan"));
  assert.ok(page.includes("Promise.allSettled"));
  assert.ok(!page.includes("localStorage"));
  assert.ok(!page.includes("Math.random"));
});

test("journal UX groups only the authenticated user's recorded symbols",()=>{
  const app=source("../app/private/journal/journal-workspace.tsx");
  assert.ok(app.includes("entries"));
  assert.ok(app.includes("plans"));
  assert.ok(app.includes("trades"));
  assert.ok(app.includes("setSelected"));
  assert.ok(app.includes("selected"));
  assert.ok(source("../app/private/journal/new/page.tsx").includes("tradeEventId"));
  assert.ok(app.includes("isBrokerOrder")===false);
  assert.ok(app.includes("사용자 직접 작성"));
  assert.ok(app.includes("목표가"));
  assert.ok(app.includes("손절가"));
  assert.ok(!app.includes("mockPortfolio"));
});

test("trade and journal entry points never depend on retired S2 env flag",()=>{
  const paths=[
    "../lib/saas-trades-api.ts",
    "../app/private/journal/page.tsx",
    "../app/private/page.tsx",
    "../app/private/trades/page.tsx",
    "../app/private/trades/[id]/page.tsx",
    "../app/private/settings/page.tsx",
    "../app/api/private/journal/export/route.ts",
  ];
  for(const path of paths) {
    const code=source(path);
    assert.ok(!code.includes(["SAAS","S2","ENABLED"].join("_")),path);
    assert.ok(!code.includes("manualTradeEnabled"),path);
  }
  const client=source("../lib/saas-trades-api.ts");
  assert.ok(client.includes("saasAuthConfigured("));
  assert.ok(client.includes('X-Saas-Signature'));
  const page=source("../app/private/journal/page.tsx");
  assert.ok(page.includes("currentWorkspace()"));
  const exportRoute=source("../app/api/private/journal/export/route.ts");
  assert.ok(exportRoute.includes("currentWorkspace()"));
  assert.ok(exportRoute.includes("auth()"));
});
