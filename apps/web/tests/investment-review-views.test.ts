import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");

test("private account-reference view never claims multi-account policy compliance",()=>{
  const ui=read("../app/private/portfolio/page.tsx");
  const risk=read("../lib/allocation-policy.ts");
  assert.ok(ui.includes("assessAccountPolicyReference("));
  assert.ok(ui.includes("전체 포트폴리오 정책 준수 여부는 미확인"));
  assert.ok(ui.includes("계좌 기준 참고 비중"));
  assert.ok(ui.includes("data.readWarnings?.length"));
  assert.ok(risk.includes("ACCOUNT_COMPARISON_NOT_PORTFOLIO_COMPLIANCE"));
  for(const marker of ["quoteAt","marketObservations","fetch(","PRICE_TARGET","PRICE_STOP","placeOrder"])
    assert.ok(!risk.includes(marker),marker);
});

test("monthly report only uses per-session journal and never treats observed orders as executions",()=>{
  const ui=read("../app/private/reports/monthly/page.tsx");
  const model=read("../lib/monthly-process.ts");
  assert.ok(ui.includes("currentWorkspace()"));
  assert.ok(ui.includes("auth()"));
  assert.ok(ui.includes("fetchMonthlyProcessReport(session.user.id,month)"));
  assert.ok(!ui.includes("fetchManualTrades("));
  assert.ok(!ui.includes("fetchJournalPlans("));
  assert.ok(!ui.includes("fetchJournal("));
  assert.ok(ui.includes("Pacific/Auckland")||model.includes("Pacific/Auckland"));
  assert.ok(ui.includes("월간 투자 복기"));
  assert.ok(model.includes("USER_AUTHORED_PROCESS_ONLY"));
  const api=read("../lib/saas-trades-api.ts");
  assert.ok(api.includes("/internal/v1/journal/monthly-process"));
  assert.ok(api.includes("MONTH_WINDOW_DB_AGGREGATED"));
  assert.ok(ui.includes("assessPerformanceReadiness("));
  assert.ok(ui.includes("report.selfReviewCount"));
  assert.ok(ui.includes("report.selfReviewBreakdown.FOLLOWED"));
  assert.ok(ui.includes("검증된 투자 성과 계산 준비 상태"));
  assert.ok(ui.includes("readiness.gates.map("));
  assert.ok(ui.includes("월간 장기 투자 수익률")||ui.includes("readiness.label"));
  for(const forbidden of ["tigerPersonalRead","marketObservations","PLACE_ORDER","sendNotification","fetch("])
    assert.ok(!ui.includes(forbidden)&&!model.includes(forbidden),forbidden);
});

test("private structured plan review is distinct from unverified trade observations",()=>{
 const editor=read("../app/private/journal/review/new/page.tsx");
 const api=read("../lib/saas-trades-api.ts");
 const journal=read("../app/private/journal/journal-workspace.tsx");
 assert.ok(editor.includes("currentWorkspace()"));
 assert.ok(editor.includes("auth()"));
 assert.ok(editor.includes('name="expectedPlanRevisionId"'));
 assert.ok(editor.includes('name="selfAssessment"'));
 assert.ok(editor.includes("submitPlanCheckin(session.user.id"));
 assert.ok(api.includes("/internal/v1/journal/checkin/context"));
 assert.ok(api.includes("/internal/v1/journal/checkin/create"));
 assert.ok(journal.includes("/private/journal/review/new?ticker="));
 assert.ok(!editor.includes("tigerPersonalRead("));
 assert.ok(!editor.includes("placeOrder("));
});

test("new investor reports are reachable from mobile and check center",()=>{
  const layout=read("../app/private/layout.tsx");
  const alerts=read("../app/private/alerts/page.tsx");
  const home=read("../app/private/page.tsx");
  for(const file of [layout,alerts,home])assert.ok(file.includes('href="/private/reports/monthly"'));
  assert.ok(layout.includes('className="app-mobile-more-panel"'));
  assert.ok(alerts.includes("plans.value.length<200"));
  assert.ok(alerts.includes("notes.value.length<200"));
});
