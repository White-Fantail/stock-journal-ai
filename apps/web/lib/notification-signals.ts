/** Pure owner-local alert suggestions. NO notification send, trade or alarm.
 * Price rules require exactly the same USD instrument, fresh observed quote,
 * recent Tiger holdings, latest authored plan, and explicit target/stop.
 */
import type {TigerPersonalRead,TigerPersonalHealth} from "./tiger-api";
import type {JournalPlan} from "./saas-trades-api";

export type SyncSignal={id:string;kind:"SYNC_FAILED"|"SYNC_DELAYED"|"SYNC_UNREPORTED"|"PRICE_TARGET"|"PRICE_STOP";
  severity:"warning"|"info";title:string;detail:string;observedAt:string|null};
const MONEY=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;

export function compareAmounts(a:string,b:string):number{
  if(!MONEY.test(a)||!MONEY.test(b))throw new Error("INVALID_DECIMAL");
  const exact=(v:string)=>{
    const [units,decimals=""]=v.split(".");
    return BigInt(units)*10n**12n+BigInt(decimals.padEnd(12,"0"));
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
 plans:readonly JournalPlan[],now=new Date(),
):SyncSignal[]{
 const nowMs=now.getTime();
 const signals:SyncSignal[]=[];
 if(health===null){
   return [{id:"health-unavailable",kind:"SYNC_UNREPORTED",severity:"info",
     title:"Tiger 동기화 상태 확인 불가",
     detail:"현재 수집기 실행 상태를 읽지 못했습니다. 증권사 연결 또는 서버 상태를 다시 확인하세요.",
     observedAt:null}];
 }
 for(const account of health.accounts){
   if(!account.latest){
     signals.push({id:account.alias+":unreported",kind:"SYNC_UNREPORTED",
       severity:"info",title:account.alias+" · 수집기 상태 보고 대기",
       detail:"계좌 스냅샷과는 별개로, 수집 실행 결과 보고가 아직 없습니다.",
       observedAt:account.lastAssetsAt});
   }else if(account.latest.assets!=="OK" || account.latest.orders!=="OK" ||
            account.latest.fills==="UNAVAILABLE"){
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
 if(!personal)return signals.slice(0,30);
 const latestPlans=new Map<string,JournalPlan>();
 for(const plan of [...plans].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
   if(!latestPlans.has(plan.ticker))latestPlans.set(plan.ticker,plan);
 }
 for(const account of personal.accounts){
   if(ageMs(account.asOf,nowMs)>36*3600000)continue;
   const holdings=new Map(account.positions.filter(p=>p.currency==="USD" &&
       MONEY.test(p.quantity)&&compareAmounts(p.quantity,"0")>0)
       .map(p=>[p.symbol,p]));
   for(const quote of account.marketObservations){
     if(!holdings.has(quote.symbol) || quote.stale || quote.currency!=="USD" ||
        !MONEY.test(quote.price))continue;
     const at=Number(quote.quoteAt);
     const elapsed=nowMs-at;
     if(!Number.isSafeInteger(at)||elapsed<0||elapsed>45*60000)continue;
     const plan=latestPlans.get(quote.symbol);
     if(!plan || plan.priceCurrency!=="USD")continue;
     const targets=[
       {kind:"PRICE_TARGET" as const,price:plan.targetPrice,name:"목표가",dir:1},
       {kind:"PRICE_STOP" as const,price:plan.stopPrice,name:"손절가",dir:-1},
     ];
     for(const target of targets){
       if(target.price===null||!MONEY.test(target.price))continue;
       const comparison=compareAmounts(quote.price,target.price);
       if((target.dir===1 && comparison<0)||(target.dir===-1 && comparison>0))continue;
       signals.push({id:account.alias+":"+quote.symbol+":"+target.kind+":"+quote.quoteAt,
         kind:target.kind,severity:"info",
         title:quote.symbol+" · "+target.name+" 조건 관측",
         detail:"Tiger "+(quote.mode==="US_DELAYED_15M"?"15분 지연":"권한 시세")+
           " "+quote.price+" USD · 계획 "+target.price+
           " USD. 이는 관측 시점의 참고 알림으로, 실시간 감시나 증권사 주문은 아닙니다.",
         observedAt:new Date(at).toISOString()});
     }
   }
 }
 return signals.slice(0,30);
}
