import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");

test("private navigation keeps all destinations accessible on a narrow phone",()=>{
  const layout=read("../app/private/layout.tsx");
  const css=read("../app/globals.css");
  for(const route of ["/private","/private/portfolio","/private/journal","/private/review","/private/principles",
    "/private/trades","/private/journal/new?mode=plan","/private/analysis","/private/analysis?mode=COACHING",
    "/private/alerts","/private/reports/weekly","/private/reports/monthly","/private/performance",
    "/private/brokers","/private/settings"]){
    assert.ok(layout.includes('href="'+route+'"'),route);
  }
  assert.ok(layout.includes('aria-label="모바일 주 메뉴"'));
  assert.ok(layout.includes('<details className="app-mobile-more">'));
  assert.ok(layout.includes('<details className="app-desktop-more">'));
  assert.ok(css.includes(".app-mobile-nav{display:grid"));
  assert.ok(css.includes(".app-nav{display:none}"));
  assert.ok(css.includes("min-height:45px"));
});
test("actual broker orders and holdings are cards on phones, tables on desktop",()=>{
  const jsx=read("../app/private/tiger/personal-preview.tsx");
  const css=read("../app/globals.css");
  assert.ok(jsx.includes('aria-label="Tiger 주문 모바일 목록"'));
  assert.ok(jsx.includes('aria-label="보유 종목 모바일 목록"'));
  assert.ok(jsx.includes('aria-label="미연결 개별 체결 모바일 목록"'));
  assert.ok(jsx.includes("groupTigerOrderObservations(rows"));
  assert.ok(jsx.includes("<PartialFillDetails fills={o.fills}"));
  assert.ok(jsx.includes("부분체결 {fills.length}건 보기"));
  assert.ok(jsx.includes("수집·수수료 검증 진단 보기"));
  assert.ok(jsx.includes('className="responsive-table desktop-data-table"'));
  assert.ok(jsx.includes("feeLabel(o.feeView.currency,o.feeView.basis===\"STATEMENT_MATCH\")"));;
  assert.ok(jsx.includes('record-pagination-top'));
  assert.ok(css.includes(".app-shell .desktop-data-table{display:none}"));
  assert.ok(css.includes(".app-shell .mobile-data-cards{display:grid"));
});
test("verified and manual trades retain accessible mobile detail and action links",()=>{
  const portfolio=read("../app/private/portfolio/page.tsx");
  const manual=read("../app/private/trades/manual/page.tsx");
  assert.ok(portfolio.includes('aria-label="검증된 포트폴리오 모바일 목록"'));
  assert.ok(portfolio.includes('portfolio-verified-scroll desktop-data-table'));
  assert.ok(manual.includes('aria-label="직접 입력한 거래 목록"'));
  assert.ok(manual.includes('className="responsive-table desktop-data-table"'));
  assert.ok(manual.includes('href={"/private/trades/"+e.id}'));
});
test("long-horizon mobile workflows and tablet navigation remain reachable",()=>{
  const css=read("../app/globals.css");
  const layout=read("../app/private/layout.tsx");
  const review=read("../app/private/journal/review/new/page.tsx");
  const perf=read("../app/private/performance/page.tsx");
  const coach=read("../app/private/analysis/analysis-panel.tsx");
  assert.ok(css.includes("@media(max-width:1100px){"));
  assert.ok(css.includes("max-height:min(72dvh,510px)"));
  assert.ok(css.includes(".app-mobile-nav :is(a,summary):focus-visible"));
  assert.ok(css.includes("font-size:16px"));
  assert.ok(layout.includes('href="/private/performance"'));
  assert.ok(layout.includes('href="/private/analysis?mode=COACHING"'));
  assert.ok(review.includes('name="selfAssessment"'));
  assert.ok(review.includes('name="expectedPlanRevisionId"'));
  assert.ok(perf.includes('className="performance-period-links"'));
  assert.ok(coach.includes('mode==="COACHING"'));
  assert.ok(coach.includes("setConsented(false)"));
});

test("forms, stock selection and detail screens collapse without desktop widths",()=>{
  const css=read("../app/globals.css");
  for(const name of [".journal-form-two",".journal-form-three",".journal-current-actions",
    ".journal-symbol-list",".account-summary-values",".sync-metrics",".portfolio-unknown-grid"]){
    assert.ok(css.includes(name),name);
  }
  assert.ok(css.includes("font-size:16px"));
  assert.ok(css.includes("overscroll-behavior-x:contain"));
  assert.ok(css.includes("grid-template-columns:repeat(2,minmax(0,1fr))"));
});
