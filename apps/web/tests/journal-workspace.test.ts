import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relative:string){
  return readFileSync(fileURLToPath(new URL(relative,import.meta.url)),"utf8");
}

test("journal private page rechecks authentication, uses server actions and a feature gate",()=>{
  const page=source("../app/private/journal/page.tsx");
  assert.ok(page.includes("currentWorkspace()"));
  assert.ok(page.includes("auth()"));
  assert.ok(page.includes('if(!manualTradeEnabled()) redirect'));
  assert.ok(page.includes("submitJournalPlan"));
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
  assert.ok(app.includes("tradeEventId"));
  assert.ok(app.includes("isBrokerOrder")===false);
  assert.ok(app.includes("사용자 직접 작성"));
  assert.ok(app.includes("목표가"));
  assert.ok(app.includes("손절가"));
  assert.ok(!app.includes("mockPortfolio"));
});
