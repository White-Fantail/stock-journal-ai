/** Explicit user-assigned overlapping risk factors on a vetted Tiger-only NAV.
 * Factor totals overlap; never sum buckets to infer a complete allocation.
 * This is a taxonomy, NOT a data-vendor industry attribution or correlation.
 */
import type {PortfolioOverviewRisk} from "./portfolio-overview-risk";
import type {RiskFactorRevision,UserRiskFactor} from "./saas-trades-api";
import {RISK_FACTOR_LABELS} from "./risk-factor-labels";

const DEC=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const SCALE=BigInt(10)**BigInt(12);
const parse=(x:string):bigint=>{
 if(!DEC.test(x))throw new Error("FACTOR_AMOUNT_INVALID");
 const [a,b=""]=x.split(".");
 return BigInt(a)*SCALE+BigInt(b.padEnd(12,"0"));
};
const pct=(x:bigint,total:bigint):string=>{
 const units=(x*BigInt(10000)+total/BigInt(2))/total;
 return String(units/BigInt(100))+"."+String(units%BigInt(100)).padStart(2,"0");
};
export type FactorGroup=Readonly<{factor:UserRiskFactor;label:string;
  observedNavPct:string;tickerCount:number;tickers:readonly string[]}>;
export type FactorExposure=
 |Readonly<{state:"READY";groups:readonly FactorGroup[];
   unclassifiedTickers:readonly string[];unclassifiedNavPct:string;
   source:"USER_CLASSIFIED_TIGER_SNAPSHOT_ONLY";groupsOverlap:true}>
 |Readonly<{state:"UNAVAILABLE";reason:string}>;

export function assessRiskFactors(risk:PortfolioOverviewRisk,
 revisions:readonly RiskFactorRevision[]|null):FactorExposure{
 if(risk.state!=="READY")return {state:"UNAVAILABLE",reason:"계좌 위험 참고치가 미검증이므로 위험군 노출을 계산하지 않습니다."};
 if(revisions===null||revisions.length>100)return {state:"UNAVAILABLE",reason:"사용자 위험군 분류 기록을 완전하게 확인할 수 없습니다."};
 const unique=new Set(revisions.map(x=>x.ticker));
 if(unique.size!==revisions.length)return {state:"UNAVAILABLE",reason:"분류 변경 이력의 최신 상태가 중복되어 있습니다."};
 const nav=parse(risk.nav);
 if(nav<=BigInt(0))return {state:"UNAVAILABLE",reason:"순자산 미확인"};
 const map=new Map<string,RiskFactorRevision>(revisions.map(r=>[r.ticker,r]));
 const exposure=new Map<UserRiskFactor,{money:bigint;tickers:string[]}>();
 const unclassified:string[]=[];
 let unclassifiedValue=BigInt(0);
 for(const p of risk.positions){
   const factors=map.get(p.ticker)?.factors??[];
   const amount=parse(p.marketValue);
   if(!factors.length){unclassified.push(p.ticker);unclassifiedValue+=amount;continue;}
   if(factors.length>3||new Set(factors).size!==factors.length||
     factors.some(f=>!(f in RISK_FACTOR_LABELS)))
     return {state:"UNAVAILABLE",reason:"분류 근거에 지원되지 않는 위험 요인이 있습니다."};
   for(const factor of factors){
     const entry=exposure.get(factor)??{money:BigInt(0),tickers:[]};
     entry.money+=amount;entry.tickers.push(p.ticker);exposure.set(factor,entry);
   }
 }
 const groups=[...exposure].sort((a,b)=>a[1].money===b[1].money?
     a[0].localeCompare(b[0]):a[1].money>b[1].money?-1:1)
   .map(([factor,entry])=>({factor,label:RISK_FACTOR_LABELS[factor],
      observedNavPct:pct(entry.money,nav),tickerCount:entry.tickers.length,
      tickers:entry.tickers.sort()}));
 return {state:"READY",groups,unclassifiedTickers:unclassified.sort(),
   unclassifiedNavPct:pct(unclassifiedValue,nav),
   source:"USER_CLASSIFIED_TIGER_SNAPSHOT_ONLY",groupsOverlap:true};
}
