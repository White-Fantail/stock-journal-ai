/** Structured, consent-scoped, longitudinal user-process coaching evidence.
 * Completed monthly summaries are full-window tenant DB aggregates. The
 * current NZ month is clearly marked partial and NEVER scored against full
 * months as if the observation windows were comparable.
 * No market prices, broker fills, sizes, FX, P&L or investment advice.
 */
import type {MonthlyProcessReport} from "./monthly-process";
import {currentNzMonth,monthWindow,stepMonth} from "./monthly-process";
import type {PlanCheckinContext} from "./saas-trades-api";
import {sanitizedExcerpt,type AnalysisEnvelope} from "./ai-analysis";

export type CoachMonth=Readonly<{
  month:string; partial:boolean;report:MonthlyProcessReport;
}>;

const SYMBOL=/^[A-Z0-9.:-]{1,32}$/;
const ASSESS=new Set(["FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"]);
const SAFE_NUMBER=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const MIN_DATE="2000-01";

export function monthlyCoachingScope(now=new Date()):readonly {month:string;partial:boolean}[]{
  const current=currentNzMonth(now);
  const months:[{month:string;partial:boolean},...{month:string;partial:boolean}[]]=[
    {month:current,partial:true},
  ];
  let last=current;
  for(let i=0;i<3;i++){
    const prev=stepMonth(last,-1);
    if(!prev||prev<MIN_DATE)throw new Error("COACHING_PERIOD_INVALID");
    months.push({month:prev,partial:false});
    last=prev;
  }
  return months;
}

export function buildCoachingEvidence(
  ticker:string,months:readonly CoachMonth[],context:PlanCheckinContext,
  now=new Date(),
):AnalysisEnvelope{
  if(!SYMBOL.test(ticker)||context.ticker!==ticker||
      context.source!=="USER_SELF_ASSESSED_ONLY"||
      context.recentLimit!==10||context.recent.length>10)
    throw new Error("COACHING_SCOPE_INVALID");
  const expected=monthlyCoachingScope(now);
  if(months.length!==4)throw new Error("COACHING_COVERAGE_INCOMPLETE");
  for(let i=0;i<4;i++){
    const observed=months[i],schedule=expected[i],r=observed.report;
    const window=monthWindow(schedule.month);
    const currentCutoff=Date.parse(r.checkedAsOf);
    if(!window ||
       r.start!==new Date(window.start).toISOString() ||
       r.end!==new Date(window.end).toISOString() ||
       !(currentCutoff>=window.start && currentCutoff<window.end) ||
       (schedule.partial && currentCutoff>now.getTime()) ||
       r.reviewCount>r.noteCount || r.selfReviewCount>r.reviewCount ||
       r.uniqueSymbols<r.symbols.length ||
       observed.month!==schedule.month||observed.partial!==schedule.partial||
      r.month!==schedule.month||r.timezone!=="Pacific/Auckland"||
      r.source!=="USER_AUTHORED_PROCESS_ONLY"||
      (r as MonthlyProcessReport&{coverage?:string;complete?:boolean}).coverage!=="MONTH_WINDOW_DB_AGGREGATED"||
      (r as MonthlyProcessReport&{coverage?:string;complete?:boolean}).complete!==true||
      !SAFE_NUMBER(r.noteCount)||!SAFE_NUMBER(r.reviewCount)||
      !SAFE_NUMBER(r.selfReviewCount)||!SAFE_NUMBER(r.planRevisionCount)||
      !SAFE_NUMBER(r.plannedSymbols)||!SAFE_NUMBER(r.dueAsOfCutoff)||
      !SAFE_NUMBER(r.userTradeRecordCount)||!SAFE_NUMBER(r.uniqueSymbols)||
      !r.selfReviewBreakdown||
      !Object.values(r.selfReviewBreakdown).every(SAFE_NUMBER)||
      r.selfReviewCount!==Object.values(r.selfReviewBreakdown).reduce((s,v)=>s+v,0)||
      !Array.isArray(r.symbols)||r.symbols.length>100||
      !Number.isFinite(Date.parse(r.start))||!Number.isFinite(Date.parse(r.end))||
      !Number.isFinite(Date.parse(r.checkedAsOf)))
      throw new Error("COACHING_AGGREGATES_INVALID");
  }
  const evidence:AnalysisEnvelope["evidence"]=[];
  for(let i=0;i<4;i++){
    const item=months[i],r=item.report;
    const symbol=r.symbols.find(s=>s.ticker===ticker);
    if(r.symbols.some(s=>s.ticker===ticker&&![
      s.notes,s.reviews,s.plans,s.manualRecords,
    ].every(SAFE_NUMBER)))throw new Error("COACHING_SYMBOL_INVALID");
    evidence.push({
      ref:"C"+(i+1),kind:"MONTHLY_PROCESS",ticker,on:item.month,
      source:"USER_AUTHORED_DB_AGGREGATE_NOT_RETURNS",
      detail:`${item.month} ${item.partial?"당월 진행 중 · 지난달과 동일 기간 아님":"완료된 월"}:
선택 종목 일지 ${symbol?.notes??0}건 · 복기 ${symbol?.reviews??0}건 · 계획 수정 ${symbol?.plans??0}건;
전체 워크스페이스 일지 ${r.noteCount}건 · 일반 복기 ${r.reviewCount}건 ·
계획 수정 ${r.planRevisionCount}건 · 직접 주장한 거래 ${r.userTradeRecordCount}건;
전체 자기평가 ${r.selfReviewCount}건(지켰음 ${r.selfReviewBreakdown.FOLLOWED},
일부 ${r.selfReviewBreakdown.PARTIAL}, 벗어남 ${r.selfReviewBreakdown.DEVIATED},
판단 유보 ${r.selfReviewBreakdown.UNCERTAIN}); 점검 시점 도래 종목 ${r.dueAsOfCutoff}개.`
        .replace(/\s+/g," ").trim(),
    });
  }
  const sorted=[...context.recent].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,4);
  for(let i=0;i<sorted.length;i++){
    const c=sorted[i];
    if(!ASSESS.has(c.selfAssessment)||!Number.isFinite(Date.parse(c.createdAt)))
      throw new Error("COACHING_CHECKIN_INVALID");
    evidence.push({
      ref:"R"+(i+1),kind:"SELF_REVIEW",ticker,
      on:new Date(c.createdAt).toISOString().slice(0,10),
      source:"USER_SELF_ASSESSED_NOT_BROKER_VERIFIED",
      detail:sanitizedExcerpt(`사용자 평가 ${c.selfAssessment}; 당시 복기:
${c.content}; 본인이 정한 다음 점검 행동: ${c.nextAction}`,560),
    });
  }
  const activity=months.some(x=>x.report.noteCount+x.report.planRevisionCount+
    x.report.selfReviewCount>0)||sorted.length>0;
  if(!activity)throw new Error("COACHING_NO_AUTHORED_ACTIVITY");
  const envelope:AnalysisEnvelope={mode:"COACHING",symbol:ticker,
    asOf:now.toISOString().slice(0,10),evidence,limits:[
      "Three complete prior NZ calendar months plus the *partial* current month; never claim equal-length comparisons.",
      "Monthly summary is complete author process aggregate: selected-ticker entries distinguished from workspace-wide self assessments.",
      "Self checkins are the user's claimed adherence; later checkins do not prove that an earlier next action was completed.",
      "Evaluate whether prior recorded next actions were discussed again; if not evidenced, ask to follow up rather than assume success.",
      "No broker execution accuracy, P&L, NAV, cashflows, personal trading profitability or pricing can be inferred.",
      "Do not recommend buy/sell, create price-trigger signals or persist AI results; consent is per request.",
    ]};
  if(JSON.stringify(envelope).length>13000)throw new Error("COACHING_EVIDENCE_LIMIT");
  return envelope;
}
