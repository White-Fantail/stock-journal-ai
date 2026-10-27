import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),"utf8");

test("journal starts with selected holdings and journal records, not all Tiger orders",()=>{
  const page=read("../app/private/journal/page.tsx");
  const ui=read("../app/private/journal/journal-workspace.tsx");
  assert.ok(!page.includes("PersonalOrderHistory"));
  assert.ok(page.includes("personalPositions="));
  assert.ok(ui.includes("personalPositions"));
  assert.ok(ui.includes("journal-current"));
  assert.ok(!ui.includes('className="journal-compose"'));
});
test("trade and journal editing use independent pages, no forms in list workspace",()=>{
  const ui=read("../app/private/journal/journal-workspace.tsx");
  const create=read("../app/private/journal/new/page.tsx");
  assert.ok(!ui.includes("<form"));
  assert.ok(create.includes("<form"));
  assert.ok(create.includes("currentWorkspace()"));
  assert.ok(create.includes("tigerLedgerRead()"));
  assert.ok(!ui.includes("&accountId="));
  // Opaque observed broker sourceRef is permitted only for a dedicated
  // authenticated note form; source must be revalidated server-side.
  assert.ok(ui.includes("&sourceRef="));
  assert.ok(create.includes("submitTigerObservationNote("));
  assert.ok(create.includes("tigerPersonalRead("));
  assert.ok(!ui.includes("brokerGrant="));
});
test("account currency comes from Tiger summary rather than stock currencies",()=>{
  const home=read("../app/private/page.tsx");
  const portfolio=read("../app/private/tiger/personal-preview.tsx");
  const client=read("../lib/tiger-api.ts");
  assert.ok(home.includes("a.assets?.currency"));
  assert.ok(portfolio.includes("account.assets?.currency"));
  assert.ok(client.includes("currency:string|null"));
  assert.ok(!home.includes('??"USD"'));
});
test("home and portfolio use real scoped records instead of onboarding cards",()=>{
  const home=read("../app/private/page.tsx");
  const portfolio=read("../app/private/portfolio/page.tsx");
  assert.ok(home.includes("tigerPersonalRead()"));
  assert.ok(home.includes("fetchJournal("));
  assert.ok(home.includes("formatDecimal"));
  assert.ok(!home.includes("dashboard-hero"));
  assert.ok(!home.includes("이렇게 시작해 보세요"));
  assert.ok(portfolio.includes("PersonalPortfolioBlock"));
  assert.ok(!portfolio.includes("PersonalOrderHistory"));
  assert.ok(!portfolio.includes("포트폴리오 검증 절차"));
});

test("a selected stock displays actionable target and stop controls",()=>{
  const ui=read("../app/private/journal/journal-workspace.tsx");
  const create=read("../app/private/journal/new/page.tsx");
  const pricing=read("../app/private/journal/new/plan-risk-check.tsx");
  assert.ok(ui.includes("투자 전략·계획 관리"));
  assert.ok(ui.includes("목표가 {active.plan?"));
  assert.ok(ui.includes("손절가 {active.plan?"));
  assert.ok(ui.includes("/private/journal/new?mode=plan&ticker="));
  assert.ok(create.includes("action={addPlan}"));
  assert.ok(create.includes("<PlanRiskCheck"));
  assert.ok(pricing.includes('name="targetPrice"'));
  assert.ok(pricing.includes('name="stopPrice"'));
  assert.ok(create.includes('name="rationale"'));
  assert.ok(pricing.includes('name="strategyType"'));
  assert.ok(create.includes('name="invalidationCondition"'));
  assert.ok(pricing.includes('name="maxAllocationPct"'));
  assert.ok(create.includes('name="reviewCadence"'));
  assert.ok(create.includes('name="investmentHorizon"'));
  assert.ok(ui.includes("e.value.invalidationCondition"));
  assert.ok(!ui.includes("<form"));
});

test("journal shows investment notes and target-stop plan revisions in one chronological timeline",()=>{
  const ui=read("../app/private/journal/journal-workspace.tsx");
  assert.ok(ui.includes('type View="activity"|"trades"|"observed"|"broker"'));
  assert.ok(ui.includes("투자 판단 · 계획"));
  assert.ok(!ui.includes('setView("plans")'));
  assert.ok(!ui.includes('view==="plans"'));
  assert.ok(ui.includes("history.map(e=>"));
  assert.ok(ui.includes('type:"note" as const'));
  assert.ok(ui.includes('type:"plan" as const'));
  assert.ok(ui.includes("b.timestamp.localeCompare(a.timestamp)"));
  assert.ok(ui.includes("e.type===\"plan\"?\"투자 전략·계획 변경\""));
  assert.ok(ui.includes("e.value.rationale"));
  assert.ok(ui.includes('href={"/private/journal/new?mode=plan&ticker="'));
  assert.ok(!ui.includes("<form"));
});


test("B3 investor-centered portfolio links to source-aware risks without suppressing original holdings",()=>{
 const page=read("../app/private/portfolio/page.tsx");
 const focus=read("../app/private/portfolio/portfolio-attention.tsx");
 const actions=read("../lib/portfolio-review-actions.ts");
 assert.ok(page.includes("<PortfolioAttention personal={personal}"));
 assert.ok(page.includes("<PersonalPortfolioBlock data={personal}/>"));
 assert.ok(page.includes("portfolio-technical-details"));
 assert.ok(focus.includes("확정 투자 원장 아님"));
 assert.ok(focus.includes('risk.state==="READY"'));
 assert.ok(actions.includes("personal.readWarnings?.length"));
 assert.ok(actions.includes("plans.length>=200"));
 assert.ok(actions.includes("factors.length>100"));
});

test("B4 plan editing retains all existing strategy fields as a new full immutable revision",()=>{
 const page=read("../app/private/journal/new/page.tsx");
 const pricing=read("../app/private/journal/new/plan-risk-check.tsx");
 const client=read("../app/private/journal/journal-workspace.tsx");
 const api=read("../lib/saas-trades-api.ts");
 for(const field of ["rationale","invalidationCondition","reviewCadence","strategyType",
   "investmentHorizon","maxAllocationPct","targetPrice","stopPrice","priceCurrency"]){
  const markup=["targetPrice","stopPrice","priceCurrency","strategyType","maxAllocationPct"].includes(field)?pricing:page;
  assert.equal(markup.split('name="'+field+'"').length-1,1,field);
 }
 assert.ok(page.includes("initialTarget={existingPlan?.targetPrice??"));
 assert.ok(page.includes("initialStop={existingPlan?.stopPrice??"));
 assert.ok(pricing.includes("onChange={e=>setStop(e.target.value)}"));
 assert.ok(page.includes("initialStrategy={existingPlan?.strategyType??"));
 assert.ok(pricing.includes('name="strategyType"'));
 assert.ok(page.includes('riskDecisionNote:field(form,"riskDecisionNote")||null'));
 assert.ok(pricing.includes('name="riskDecisionNote"'));
 assert.ok(pricing.includes("checked={includeReview}"));
 assert.ok(page.includes("defaultValue={existingPlan?.reviewCadence??"));
 assert.ok(page.includes("action={addPlan}"));
 assert.ok(page.includes("submitJournalPlan(subject"));
 assert.ok(client.includes("journal-guided-workflow"));
 assert.ok(client.includes("journal-investment-details"));
 assert.ok(client.includes("useEffect(()=>{if(initialTicker"));
 assert.ok(client.includes("history.map(e=>"));
 assert.ok(api.includes("export type JournalPlan"));
});
