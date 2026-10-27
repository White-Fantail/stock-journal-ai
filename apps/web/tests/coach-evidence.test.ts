import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {buildCoachingEvidence,monthlyCoachingScope} from "../lib/coach-evidence";
import {aiRequestBody,parseAiResult} from "../lib/ai-analysis";
import {monthWindow,type MonthlyProcessReport} from "../lib/monthly-process";
import type {PlanCheckinContext} from "../lib/saas-trades-api";

const now=new Date("2026-10-27T06:00:00Z");
const report=(month:string):MonthlyProcessReport=>{
 const self={FOLLOWED:1,PARTIAL:1,DEVIATED:0,UNCERTAIN:0};
 const bounds=monthWindow(month)!;
 const cutoff=month==="2026-10"?new Date("2026-10-25T00:00:00Z"):
   new Date(bounds.end-1);
 return {month,timezone:"Pacific/Auckland",start:new Date(bounds.start).toISOString(),
 end:new Date(bounds.end).toISOString(),checkedAsOf:cutoff.toISOString(),
 noteCount:12,reviewCount:4,planRevisionCount:3,userTradeRecordCount:1,
 voidCount:0,uniqueSymbols:1,plannedSymbols:1,completeStrategySymbols:1,
 dueAsOfCutoff:0,selfReviewCount:2,selfReviewBreakdown:self,
 source:"USER_AUTHORED_PROCESS_ONLY",
 coverage:"MONTH_WINDOW_DB_AGGREGATED",complete:true,
 symbols:[{ticker:"TSLA",notes:4,reviews:2,plans:1,manualRecords:0}],
 } as MonthlyProcessReport;
};
const months=()=>monthlyCoachingScope(now).map(p=>({
 ...p,report:report(p.month),
}));
const context:PlanCheckinContext={
 ticker:"TSLA",currentPlan:null,recentLimit:10,source:"USER_SELF_ASSESSED_ONLY",
 recent:[
  {id:"sensitive-record-id",planRevisionId:"sensitive-plan-id",selfAssessment:"PARTIAL",
    createdAt:"2026-10-12T00:00:00Z",content:"Followed half my rules, time was short",
    nextAction:"Check the investment thesis before next review"},
  {id:"sensitive-earlier-id",planRevisionId:"sensitive-plan-id",selfAssessment:"UNCERTAIN",
    createdAt:"2026-09-10T00:00:00Z",
    content:"No independent checks",nextAction:"Review business model"},
 ],
};

test("four months: current partial and three previous complete, NZ boundaries",()=>{
 assert.deepEqual(monthlyCoachingScope(now).map(m=>[m.month,m.partial]),[
 ["2026-10",true],["2026-09",false],["2026-08",false],["2026-07",false]]);
 const result=buildCoachingEvidence("TSLA",months(),context,now);
 assert.equal(result.mode,"COACHING");
 assert.equal(result.symbol,"TSLA");
 assert.equal(result.evidence.length,6);
 assert.equal(result.evidence[0].ref,"C1");
 assert.equal(result.evidence[0].on,"2026-10");
 assert.equal(result.evidence[0].kind,"MONTHLY_PROCESS");
 assert.ok(result.evidence[0].detail.includes("당월 진행 중"));
 assert.ok(result.evidence[1].detail.includes("완료된 월"));
 assert.ok(result.evidence[0].detail.includes("전체 워크스페이스"));
 assert.ok(result.evidence[4].detail.includes("본인이 정한 다음 점검 행동"));
 assert.ok(result.limits.some(s=>s.includes("partial")));
 const data=JSON.stringify(result);
 for(const secret of ["sensitive-record-id","sensitive-plan-id",
   "accountId","sourceRef","netLiquidation","estimatedValue",
   '"price":', "marketObservations"]){
   assert.ok(!data.includes(secret),secret);
 }
});

test("missing, stale, fraudulent or incomplete month evidence never goes to the model",()=>{
 const cases=[
  months().slice(0,3),
  months().map((m,i)=>i===2?{...m,month:"2026-09"}:m),
  months().map((m,i)=>i===1?{...m,report:{...m.report,complete:false}}:m),
  months().map((m,i)=>i===2?{...m,report:{...m.report,noteCount:-1}}:m),
  months().map((m,i)=>i===0?{...m,report:{...m.report,source:"FAKE"} as unknown as MonthlyProcessReport}:m),
  months().map((m,i)=>i===1?{...m,report:{...m.report,selfReviewCount:100}}:m),
 ];
 for(const data of cases)assert.throws(()=>buildCoachingEvidence("TSLA",data,context,now));
 assert.throws(()=>buildCoachingEvidence("TSLA",months(),{...context,ticker:"RKLB"},now));
 assert.throws(()=>buildCoachingEvidence("../../",months(),context,now));
 assert.throws(()=>buildCoachingEvidence("TSLA",months(),{...context,source:"FAKE"} as unknown as PlanCheckinContext,now));
 const empty=months().map(x=>({...x,report:{...x.report,
  noteCount:0,planRevisionCount:0,selfReviewCount:0,
  selfReviewBreakdown:{FOLLOWED:0,PARTIAL:0,DEVIATED:0,UNCERTAIN:0}}}));
 assert.throws(()=>buildCoachingEvidence("TSLA",empty,{...context,recent:[]},now));
});

test("coaching model remains per-request ZDR and citations required",()=>{
 const envelope=buildCoachingEvidence("TSLA",months(),context,now);
 const request=aiRequestBody("test/model",envelope);
 assert.equal(request.provider.zdr,true);
 assert.equal(request.provider.data_collection,"deny");
 assert.ok(request.messages[0].content.includes("monthly investment decision-process coach"));
 assert.ok(request.messages[0].content.includes("UNCONFIRMED"));
 const reply={summary:"지난달의 기록과 다음 행동을 점검했습니다.",
  findings:[{type:"pattern",title:"다음 행동 후속 기록 필요",
   explanation:"다음 행동 기록만으로 이행을 증명할 수 없습니다.",
   evidenceRefs:["R2","R1","C1"],nextStep:"이번 달 복기에서 실행 여부를 직접 기록하세요."}],
  questions:["과거의 다음 행동이 실제로 진행됐다는 메모가 있나요?"],
  limitations:["자기평가로 실제 거래 준수 여부를 단정할 수 없습니다."]};
 assert.deepEqual(parseAiResult(JSON.stringify(reply),envelope),reply);
 assert.throws(()=>parseAiResult(JSON.stringify({...reply,
  findings:[{...reply.findings[0],evidenceRefs:["nonexistent"]}]}),envelope));
});

test("coaching actions cannot silently import broker price or position observations",()=>{
 const actions=readFileSync(fileURLToPath(new URL(
  "../app/private/analysis/actions.ts",import.meta.url)),"utf8");
 assert.ok(actions.includes('mode==="COACHING"'));
 assert.ok(actions.includes("buildCoachingEvidence("));
 assert.ok(actions.includes("fetchMonthlyProcessReport("));
 assert.ok(actions.includes("fetchPlanCheckinContext("));
 assert.ok(actions.includes('form.get("consent")!=="SEND_SELECTED_JOURNAL_TO_OPENROUTER"'));
 assert.ok(actions.includes("claimAiAnalysis(subject,mode"));
 const model=readFileSync(fileURLToPath(new URL("../lib/coach-evidence.ts",import.meta.url)),"utf8");
 for(const forbidden of ["tigerPersonalRead(","tigerLedgerRead(","fetch(","get_fund_details","placeOrder("]){
   assert.ok(!model.includes(forbidden),forbidden);
 }
});
