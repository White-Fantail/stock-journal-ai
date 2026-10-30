/** Conservative, LOCAL-ONLY plan-versus-note wording checks.
 * Only explicit reversal phrases after the latest authored plan are candidates.
 * This does not determine intent, compliance, causality or trade execution.
 * Never place these candidates or raw texts in an external AI envelope.
 */
import type {JournalEntry,JournalPlan} from "./saas-trades-api";

export type PlanDecisionDifference=Readonly<{
 ticker:string;kind:"HORIZON"|"STOP_POLICY"|"TARGET_POLICY"|"THESIS";
 planDescription:string;mentionedDescription:string;notedAt:string;
 source:"USER_AUTHORED_EXPLICIT_WORDING_REVIEW_ONLY";
}>;

type Pattern=Readonly<{kind:PlanDecisionDifference["kind"];pattern:RegExp;
 planDescription:string;mentionedDescription:string}>;

export function planDecisionDifferences(
 ticker:string,notes:readonly JournalEntry[],plans:readonly JournalPlan[],
):PlanDecisionDifference[]{
 const current=plans.filter(p=>p.ticker===ticker)
   .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
 if(!current||!Number.isFinite(Date.parse(current.createdAt)))return [];
 const rules:Pattern[]=[];
 if(current.strategyType==="LONG_TERM" ||
    current.investmentHorizon==="OVER_THREE_YEARS" ||
    current.investmentHorizon==="OPEN_ENDED"){
   rules.push({kind:"HORIZON",
     pattern:/(?:장기\s*(?:보유|투자)(?:를|는)?\s*(?:중단|종료|포기)|장기\s*(?:대신|에서)\s*단기|단기\s*(?:매매|투자|트레이딩)(?:로|으로)\s*(?:전환|변경))/i,
     planDescription:"장기 보유·투자 전략",
     mentionedDescription:"최근 기록에 장기 보유 중단 또는 단기 전략 전환 표현"});
 }
 if(current.strategyType==="TECHNICAL" ||
    current.investmentHorizon==="UNDER_3_MONTHS"){
   rules.push({kind:"HORIZON",
     pattern:/(?:단기\s*(?:매매|투자)(?:를|는)?\s*(?:중단|포기)|장기\s*(?:보유|투자)(?:로|으로)\s*(?:전환|변경))/i,
     planDescription:"기존 단기·기술적 전략",
     mentionedDescription:"최근 기록에 단기 전략 중단 또는 장기 보유 전환 표현"});
 }
 if(current.stopPrice){
   rules.push({kind:"STOP_POLICY",
     pattern:/(?:손절(?:가|선|기준)?(?:을|를|은|는)?\s*(?:폐기|삭제|없애|적용하지\s*않|사용하지\s*않)|손절\s*없이\s*(?:계속|장기)\s*보유)/i,
     planDescription:"손절 기준이 있는 현재 계획",
     mentionedDescription:"최근 기록에 손절 기준 폐기·미적용 표현"});
 }
 if(current.targetPrice){
   rules.push({kind:"TARGET_POLICY",
     pattern:/(?:목표가|목표\s*가격)(?:를|은|는|을)?\s*(?:폐기|삭제|없애|사용하지\s*않|적용하지\s*않)/i,
     planDescription:"목표가가 있는 현재 계획",
     mentionedDescription:"최근 기록에 목표가 폐기·미적용 표현"});
 }
 if(current.invalidationCondition?.trim()){
   rules.push({kind:"THESIS",
     pattern:/(?:기존\s*)?(?:투자\s*)?(?:논리|가설|근거)(?:가|는|를|를\s*더는)?\s*(?:무효|붕괴|철회|폐기|성립하지\s*않)/i,
     planDescription:"투자 논리 무효화 조건을 가진 현재 계획",
     mentionedDescription:"최근 기록에 투자 논리 무효·철회 표현"});
 }
 const result:PlanDecisionDifference[]=[];
 const seen=new Set<PlanDecisionDifference["kind"]>();
 const newer=notes.filter(n=>n.ticker===ticker&&Number.isFinite(Date.parse(n.createdAt))&&
   Date.parse(n.createdAt)>Date.parse(current.createdAt))
   .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,24);
 for(const n of newer){
   if(result.length>=4)break;
   for(const rule of rules){
     if(seen.has(rule.kind)||!rule.pattern.test(n.content.slice(0,6000)))continue;
     seen.add(rule.kind);
     result.push({ticker,kind:rule.kind,planDescription:rule.planDescription,
       mentionedDescription:rule.mentionedDescription,notedAt:n.createdAt,
       source:"USER_AUTHORED_EXPLICIT_WORDING_REVIEW_ONLY"});
   }
 }
 return result;
}
