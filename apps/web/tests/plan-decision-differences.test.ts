import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {planDecisionDifferences} from "../lib/plan-decision-differences";
import type {JournalEntry,JournalPlan} from "../lib/saas-trades-api";
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),"utf8");
const plan={id:"p",ticker:"RKLB",createdAt:"2026-10-10T00:00:00Z",targetPrice:"60",stopPrice:"50",
  strategyType:"LONG_TERM",investmentHorizon:"OVER_THREE_YEARS",
  invalidationCondition:"사업 가설이 무너지면",rationale:"long hold"} as JournalPlan;
const note=(content:string,createdAt="2026-10-20T00:00:00Z",ticker="RKLB")=>
  ({ticker,content,createdAt,kind:"REVIEW",id:"n"} as JournalEntry);

test("explicit strategy and policy reversals are labeled review-only, not automatic changes",()=>{
 const result=planDecisionDifferences("RKLB",[
  note("장기 보유를 중단하고 단기 매매로 전환하기로 했다. 손절가를 폐기한다."),
  note("투자 논리가 무효라고 판단했다. 목표가를 폐기한다.","2026-10-19T00:00:00Z"),
 ],[plan]);
 assert.deepEqual(new Set(result.map(x=>x.kind)),new Set(["HORIZON","STOP_POLICY","THESIS","TARGET_POLICY"]));
 assert.ok(result.every(x=>x.source==="USER_AUTHORED_EXPLICIT_WORDING_REVIEW_ONLY"));
 assert.ok(!JSON.stringify(result).includes("50"));
});
test("same-price notes, earlier notes and unrelated symbols are not interpreted as reversals",()=>{
 assert.deepEqual(planDecisionDifferences("RKLB",[
   note("장기 보유를 중단","2026-10-01T00:00:00Z"),
   note("손절가 56.5에 관심","2026-10-21T00:00:00Z","TSLA"),
   note("장기 보유 유지 및 손절가 유지"),
 ],[plan]),[]);
});
test("decision candidates remain entirely outside external AI evidence and have no write path",()=>{
 const action=read("../app/private/analysis/actions.ts");
 const view=read("../app/private/analysis/analysis-panel.tsx");
 assert.ok(action.includes("decisionSignals=planDecisionDifferences("));
 assert.ok(action.includes("aiRequestBody(process.env.OPENROUTER_MODEL!,envelope)"));
 assert.ok(!action.includes("aiRequestBody(process.env.OPENROUTER_MODEL!,decisionSignals)"));
 assert.ok(!action.includes("submitJournalPlan("));
 assert.ok(view.includes("문맥이나 실제 의사결정은 검증하지 않았으므로"));
});
