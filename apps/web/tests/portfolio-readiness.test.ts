import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(path:string):string {
  return readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
}
test("portfolio loads verified session and server-side private scoped broker metadata",()=>{
  const page=source("../app/private/portfolio/page.tsx");
  assert.ok(page.includes("currentWorkspace()"));
  assert.ok(page.includes("tigerStatus()"));
  assert.ok(page.includes("tigerSyncStatus()"));
  assert.ok(page.includes("tigerReviewStatus()"));
  assert.ok(page.includes("review.issues"));
  assert.ok(page.includes("review.sourceEvidenceCount"));
  assert.ok(page.includes("Promise.allSettled"));
  assert.ok(!page.includes("localStorage"));
  assert.ok(!page.includes("Math.random"));
});
test("portfolio does not represent unverified history as financial values",()=>{
  const page=source("../app/private/portfolio/page.tsx");
  assert.ok(page.includes("보유 자산 평가액"));
  assert.ok(page.includes("미확인"));
  assert.ok(page.includes("전체 거래이력"));
  assert.ok(page.includes("브로커 보유수량 대조"));
  assert.ok(!page.includes("historyVerified===true"));
  assert.ok(!page.includes("marketValue.toFixed"));
});
test("navigation includes the private portfolio readiness page",()=>{
  assert.ok(source("../app/private/layout.tsx").includes('href="/private/portfolio"'));
  assert.ok(source("../app/private/page.tsx").includes('href="/private/portfolio"'));
});
