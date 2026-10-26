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
  assert.ok(!ui.includes("&sourceRef="));
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
