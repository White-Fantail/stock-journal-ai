/** Owner-scoped, read-only Tiger snapshot risk: NO market-data fetch or conversion.
 * A cross-account comparison is shown only when every provided account has
 * a fresh, synchronized, same-currency NAV/cash/long-position observation.
 * Broker account aliases are the only distinct identifier in personal-read;
 * collisions fail closed. This is NOT independently audited portfolio NAV.
 */
import type {TigerPersonalRead} from "./tiger-api";
import type {JournalPlan} from "./saas-trades-api";

const DECIMAL=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const LIMIT=/^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$/;
const SCALE=BigInt(10)**BigInt(12);
const CENT=BigInt(10)**BigInt(10);
const MAX_AGE=7*24*60*60*1000;
const MAX_SKEW=60*60*1000;

/** Personal-read order pagination and optional quote/fill diagnostics are not
 * evidence of missing holdings. Only source problems affecting the actual
 * assets/positions/as-of snapshot can disqualify a holdings-based ratio.
 * Unknown warning codes still fail closed.
 */
const NON_HOLDING_READ_WARNINGS=new Set([
 "ORDERS_INVALID","ORDERS_LEGACY_FEE_CURRENCY","QUOTES_INVALID",
 "FILLS_INVALID","FEES_INVALID","COUNTS_INVALID","PAGINATION_INVALID",
]);
export function hasHoldingsReadWarnings(warnings:readonly string[]|undefined):boolean{
 return !!warnings?.some(code=>!NON_HOLDING_READ_WARNINGS.has(code));
}

const money=(s:string|null|undefined):bigint|null=>{
 if(s===null||s===undefined||!DECIMAL.test(s))return null;
 const [whole,frac=""]=s.split(".");
 return BigInt(whole)*SCALE+BigInt(frac.padEnd(12,"0"));
};
const percentage=(amount:bigint,total:bigint):string=>{
 const bps=(amount*BigInt(10000)+total/BigInt(2))/total;
 return (bps/BigInt(100)).toString()+"."+(bps%BigInt(100)).toString().padStart(2,"0");
};
const limitBps=(raw:string|null|undefined):bigint|null=>{
 if(!raw||!LIMIT.test(raw))return null;
 const [whole,frac=""]=raw.split(".");
 const value=BigInt(whole)*BigInt(100)+BigInt(frac.padEnd(2,"0"));
 return value>BigInt(0)&&value<=BigInt(10000)?value:null;
};
const pretty=(units:bigint):string=>{
 const whole=units/SCALE, frac=units%SCALE;
 return whole.toString()+(frac===BigInt(0)?"":"."+frac.toString().padStart(12,"0").replace(/0+$/,""));
};

export type AggregateTickerExposure=Readonly<{
 ticker:string;marketValue:string;observedTigerPct:string;
 personalMaxAllocationPct:string|null;
 aboveObservedTigerReference:boolean|null;
 accounts:number;
}>;
export type PortfolioOverviewRisk=
 |Readonly<{
   state:"READY";currency:string;asOf:string;accountCount:number;
   nav:string;cash:string;invested:string;
   cashPct:string;investedPct:string;largestTickerPct:string;topTwoTickerPct:string;
   residual:string;positions:readonly AggregateTickerExposure[];
   basis:"SYNCHRONIZED_TIGER_ACCOUNT_NAV_ONLY";
   completePortfolioVerified:false;accountingVerified:false;
  }>
 |Readonly<{state:"UNAVAILABLE";reason:string;completePortfolioVerified:false}>;

const fail=(reason:string):PortfolioOverviewRisk=>({
 state:"UNAVAILABLE",reason,completePortfolioVerified:false
});

export function assessPortfolioOverviewRisk(
 personal:TigerPersonalRead|null,
 plans:readonly JournalPlan[]|null,
 now=new Date(),
):PortfolioOverviewRisk{
 if(!personal||personal.coverage!=="SNAPSHOT_ONLY"||personal.verified!==false||
    hasHoldingsReadWarnings(personal.readWarnings))
   return fail("Tiger 보유자산 스냅샷이 없거나 일부 자산·수량·기준 시각이 제외되어 합산을 보류합니다.");
 if(!personal.accounts.length||personal.accounts.length>5)
   return fail("합산할 계좌가 없거나 계좌 조회 상한을 초과했습니다.");
 if(plans===null||plans.length>=200)
   return fail("투자계획 조회가 불완전하여 개인 비중 기준과 비교하지 않습니다.");
 const aliases=new Set<string>();
 let currency:string|null=null;
 let minTime=Infinity,maxTime=-Infinity;
 let nav=BigInt(0),cash=BigInt(0),invested=BigInt(0);
 const byTicker=new Map<string,{amount:bigint;accounts:Set<string>}>();
 for(const account of personal.accounts){
   // partial/truncated/hasMore describe historical ORDER coverage and paging,
   // not the separate current account asset/position snapshot.
   const alias=account.alias;
   if(!alias||aliases.has(alias))
     return fail("계좌 식별명이 중복되거나 없어 서로 다른 계좌임을 보장할 수 없습니다.");
   aliases.add(alias);
   if(account.positions.length>=100)
     return fail("보유 종목 수가 응답 상한에 도달해 추가 종목 누락 여부를 확인할 수 없습니다.");
   const asOf=account.asOf===null?NaN:Date.parse(account.asOf);
   const age=now.getTime()-asOf;
   if(!Number.isFinite(asOf)||!Number.isFinite(age)||age<0||age>MAX_AGE)
     return fail("하나 이상의 계좌 평가 기준 시각이 없거나 7일 이상 오래됐습니다.");
   minTime=Math.min(minTime,asOf);
   maxTime=Math.max(maxTime,asOf);
   const assets=account.assets;
   if(!assets||!assets.currency||!/^[A-Z]{3}$/.test(assets.currency))
     return fail("모든 계좌의 순자산 기준 통화가 확인되지 않았습니다.");
   if(currency!==null&&currency!==assets.currency)
     return fail("계좌별 순자산 통화가 다릅니다. 검증된 시점별 환율 없이는 전체 포트폴리오로 합산하지 않습니다.");
   currency=assets.currency;
   const accountNav=money(assets.netLiquidation);
   const accountCash=money(assets.cashBalance);
   if(accountNav===null||accountNav<=BigInt(0)||accountCash===null)
     return fail("계좌 중 순자산 또는 현금 잔액이 누락되거나 신뢰할 수 없습니다.");
   if(accountCash>accountNav)
     return fail("현금 잔액이 순자산보다 높아 차입·평가 의미 확인이 필요합니다.");
   let holdings=BigInt(0);
   for(const position of account.positions){
     const q=money(position.quantity);
     if(q===null)
       return fail("보유수량에 음수 또는 잘못된 숫자가 있어 전체 비중을 계산하지 않습니다.");
     if(q===BigInt(0)){
       if(position.marketValue!==null&&money(position.marketValue)!==BigInt(0))
         return fail("보유수량 0인 종목에 평가액이 남아 있어 확인이 필요합니다.");
       continue;
     }
     if(!/^[A-Z0-9.:-]{1,32}$/.test(position.symbol)||position.currency!==currency)
       return fail("종목 평가통화가 계좌 순자산 통화와 달라 검증되지 않은 FX 환산을 생략합니다.");
     const amount=money(position.marketValue);
     if(amount===null||amount<=BigInt(0))
       return fail("보유 종목 평가액이 누락되어 통합 위험을 계산하지 않습니다.");
     holdings+=amount;
     const entry=byTicker.get(position.symbol)??{amount:BigInt(0),accounts:new Set<string>()};
     entry.amount+=amount;entry.accounts.add(alias);byTicker.set(position.symbol,entry);
   }
   // A near-zero residual allows only per-account cent rounding, NOT unexplained
   // assets, unknown derivatives, other-currency cash, margin or missing positions.
   const residual=accountNav-accountCash-holdings;
   if(residual< -CENT || residual>CENT)
     return fail("순자산과 현금·보유 평가액이 일치하지 않아 누락 자산·부채 또는 환율 확인이 필요합니다.");
   nav+=accountNav;cash+=accountCash;invested+=holdings;
 }
 if(maxTime-minTime>MAX_SKEW)
   return fail("계좌 평가 시점 차이가 1시간을 초과해 동일 시점의 합산으로 볼 수 없습니다.");
 if(!currency||nav<=BigInt(0))
   return fail("비중 계산에 필요한 순자산 또는 기준 통화를 확인할 수 없습니다.");
 const latest=new Map<string,JournalPlan>();
 // Compare only the latest authored revision per ticker, never a superseded cap.
 for(const p of [...plans].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))){
   if(!latest.has(p.ticker))latest.set(p.ticker,p);
 }
 const items=[...byTicker.entries()].sort((a,b)=>
   a[1].amount===b[1].amount?a[0].localeCompare(b[0]):a[1].amount>b[1].amount?-1:1);
 const exposures=items.map(([ticker,entry])=>{
   const personal=latest.get(ticker)?.maxAllocationPct??null;
   const bps=limitBps(personal);
   return {ticker,marketValue:pretty(entry.amount),observedTigerPct:percentage(entry.amount,nav),
     personalMaxAllocationPct:bps===null?null:personal,
     aboveObservedTigerReference:bps===null?null:entry.amount*BigInt(10000)>nav*bps,
     accounts:entry.accounts.size};
 });
 const topTwo=items.slice(0,2).reduce((sum,[,v])=>sum+v.amount,BigInt(0));
 return {state:"READY",currency,accountCount:personal.accounts.length,
   asOf:new Date(minTime).toISOString(),nav:pretty(nav),cash:pretty(cash),
   invested:pretty(invested),residual:pretty(nav-cash-invested),
   cashPct:percentage(cash,nav),investedPct:percentage(invested,nav),
   largestTickerPct:items.length?percentage(items[0][1].amount,nav):"0.00",
   topTwoTickerPct:percentage(topTwo,nav),positions:exposures,
   basis:"SYNCHRONIZED_TIGER_ACCOUNT_NAV_ONLY",
   completePortfolioVerified:false,accountingVerified:false};
}
