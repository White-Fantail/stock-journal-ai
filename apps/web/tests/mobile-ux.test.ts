import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");

test("private navigation keeps all destinations accessible on a narrow phone",()=>{
  const layout=read("../app/private/layout.tsx");
  const css=read("../app/globals.css");
  for(const route of ["/private","/private/portfolio","/private/trades","/private/journal",
    "/private/analysis","/private/analysis?mode=COACHING","/private/alerts","/private/reports/monthly","/private/brokers","/private/settings"]){
    assert.ok(layout.includes('href="'+route+'"'),route);
  }
  assert.ok(layout.includes('aria-label="모바일 주 메뉴"'));
  assert.ok(layout.includes('<details className="app-mobile-more">'));
  assert.ok(css.includes(".app-mobile-nav{display:grid"));
  assert.ok(css.includes(".app-nav{display:none}"));
  assert.ok(css.includes("min-height:45px"));
});
test("actual broker orders and holdings are cards on phones, tables on desktop",()=>{
  const jsx=read("../app/private/tiger/personal-preview.tsx");
  const css=read("../app/globals.css");
  assert.ok(jsx.includes('aria-label="Tiger 주문 모바일 목록"'));
  assert.ok(jsx.includes('aria-label="보유 종목 모바일 목록"'));
  assert.ok(jsx.includes('aria-label="개별 체결 관측 모바일 목록"'));
  assert.ok(jsx.includes('aria-label="주문 수수료 검증 목록"'));
  assert.ok(jsx.includes('className="responsive-table desktop-data-table"'));
  assert.ok(jsx.includes("o.feeCurrency??\"통화 미확인\""));
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
