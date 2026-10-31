/** Owner-local investment review signals. No price monitoring, alerts, trades, or external sends.
 * All suggestions are derived only at page read time from tenant-scoped records.
 * Lack of a plan is NOT a prediction or an instruction to trade.
 */
import type {TigerPersonalRead,TigerPersonalHealth} from "./tiger-api";
import type {JournalPlan} from "./saas-trades-api";
import {portfolioReviewQueue} from "./portfolio-review-actions";

export type SyncSignal={id:string;
  kind:"SYNC_FAILED"|"SYNC_DELAYED"|"SYNC_UNREPORTED"|"HISTORY_PARTIAL"|"PLAN_MISSING"|"PLAN_INCOMPLETE";
  severity:"warning"|"info";title:string;detail:string;observedAt:string|null};
const MONEY=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;

/** Exact decimal comparison retained for non-triggering financial UI calculations. */
export function compareAmounts(a:string,b:string):number{
  if(!MONEY.test(a)||!MONEY.test(b))throw new Error("INVALID_DECIMAL");
  const exact=(v:string)=>{
    const [units,decimals=""]=v.split(".");
    return BigInt(units)*BigInt(10)**BigInt(12)+BigInt(decimals.padEnd(12,"0"));
  };
  const x=exact(a),y=exact(b);
  return x<y?-1:x>y?1:0;
}
const ageMs=(v:string|null,nowMs:number):number=>{
  const t=v===null?NaN:Date.parse(v);
  return Number.isFinite(t)?nowMs-t:Infinity;
};

export function derivePersonalAlerts(
 personal:TigerPersonalRead|null,health:TigerPersonalHealth|null,
 plans:readonly JournalPlan[]|null,now=new Date(),
):SyncSignal[]{
 const nowMs=now.getTime();
 const signals:SyncSignal[]=[];
 if(health===null){
   signals.push({id:"health-unavailable",kind:"SYNC_UNREPORTED",severity:"info",
     title:"Tiger 동기화 상태 확인 불가",
     detail:"현재 수집기 실행 상태를 읽지 못했습니다. 증권사 연결 또는 서버 상태를 다시 확인하세요.",
     observedAt:null});
 }else for(const account of health.accounts){
   if(!account.latest){
     signals.push({id:account.alias+":unreported",kind:"SYNC_UNREPORTED",
       severity:"info",title:account.alias+" · 수집기 상태 보고 대기",
       detail:"계좌 스냅샷과 별개로 수집 실행 결과 보고가 아직 없습니다.",
       observedAt:account.lastAssetsAt});
   }else if(account.latest.assets!=="OK" || account.latest.orders!=="OK" ||
            account.latest.fills!=="OK"){
     signals.push({id:account.alias+":failure",kind:"SYNC_FAILED",severity:"warning",
       title:account.alias+" · 일부 수집 실패 또는 미확인",
       detail:"자산 "+account.latest.assets+" · 주문 "+account.latest.orders+
         " · 개별 체결 "+account.latest.fills+
         ". 부분 수집은 정확한 거래 원장이나 손익을 증명하지 않습니다.",
       observedAt:account.latest.latestRunAt});
   }
   if(ageMs(account.lastAssetsAt,nowMs)>36*3600000){
     signals.push({id:account.alias+":delayed",kind:"SYNC_DELAYED",severity:"warning",
       title:account.alias+" · 자산 동기화 지연",
       detail:"마지막 성공적인 Tiger 자산 조회가 36시간 이상 지났거나 성공 시각이 없습니다. Railway 수집기 실행을 확인하세요.",
       observedAt:account.lastAssetsAt});
   }
 }
 if(personal===null)return signals.slice(0,30);
 // The portfolio and the check centre must use the same account-scope,
 // staleness and capped-plan rules before claiming a missing plan.
 const reviewQueue=portfolioReviewQueue({personal,plans,factors:null});
 for(const account of personal.accounts){
   if(account.partial||account.truncated||account.hasMore){
     signals.push({id:account.alias+":history-partial",kind:"HISTORY_PARTIAL",
       severity:"info",title:account.alias+" · 거래 이력 일부만 확인됨",
       detail:"주문·체결 조회 구간이 불완전할 수 있습니다. 이 기록으로 전체 거래내역이나 확정 손익을 계산하지 마세요.",
       observedAt:account.asOf});
   }
 }
 if(reviewQueue.holdingCount===null){
   signals.push({id:"holdings-check",kind:"SYNC_UNREPORTED",severity:"info",
     title:"보유종목 관측 범위 확인 필요",
     detail:"계좌 관측 시각·범위·식별자를 먼저 확인하세요. 불완전한 자료로 투자계획 누락을 판단하지 않습니다.",
     observedAt:null});
 }else{
   for(const action of reviewQueue.actions){
     if(action.id.startsWith("plan:")){
       signals.push({id:action.id,kind:"PLAN_MISSING",severity:"info",
         title:action.ticker+" · 투자 계획 미작성",detail:action.description,
         observedAt:reviewQueue.asOf});
     }else if(action.id.startsWith("condition:")){
       signals.push({id:"plan-incomplete:"+action.ticker,kind:"PLAN_INCOMPLETE",severity:"info",
         title:action.ticker+" · 투자 판단 재검토 조건 확인",detail:action.description,
         observedAt:reviewQueue.asOf});
     }
   }
 }
 return signals.slice(0,30);
}
