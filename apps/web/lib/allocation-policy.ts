/** Account-only comparison against the user's recorded portfolio-allocation reference.
 * Never infer multi-account portfolio NAV from a single Tiger snapshot.
 * No provider calls, quotes, price-triggered notifications, or persisted state.
 */
import type {TigerPersonalAccount} from "./tiger-api";
import type {JournalPlan} from "./saas-trades-api";

type PolicyRow=Readonly<{
  ticker:string; observedAccountPct:string; personalPortfolioLimitPct:string|null;
  exceedsAccountReference:boolean|null;
}>;
export type AccountPolicyReference=
  |Readonly<{state:"READY";accountCurrency:string;asOf:string;denominator:"ACCOUNT_NAV";
    positions:readonly PolicyRow[];assessment:"ACCOUNT_COMPARISON_NOT_PORTFOLIO_COMPLIANCE"}>
  |Readonly<{state:"UNAVAILABLE";reason:string}>;

const DECIMAL=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const PCT=/^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$/;
const SCALE=BigInt(10)**BigInt(12);
const money=(value:string|null):bigint|null=>{
  if(value===null||!DECIMAL.test(value))return null;
  const [whole,frac=""]=value.split(".");
  return BigInt(whole)*SCALE+BigInt(frac.padEnd(12,"0"));
};
function percent(value:bigint,denominator:bigint):string{
  const bps=(value*BigInt(10000)+denominator/BigInt(2))/denominator;
  return String(bps/BigInt(100))+"."+String(bps%BigInt(100)).padStart(2,"0");
}
function limitUnits(raw:string|null|undefined):bigint|null{
  if(!raw||!PCT.test(raw))return null;
  const [whole,frac=""]=raw.split(".");
  const units=BigInt(whole)*BigInt(100)+BigInt(frac.padEnd(2,"0"));
  return units>BigInt(0)&&units<=BigInt(10000)?units:null;
}
export function assessAccountPolicyReference(
 account:Pick<TigerPersonalAccount,"asOf"|"assets"|"positions">,
 plans:readonly JournalPlan[]|null,now=new Date(),
):AccountPolicyReference{
 if(plans===null)return {state:"UNAVAILABLE",reason:"투자계획을 읽지 못해 한도 비교를 보류합니다."};
 if(plans.length>=200)return {state:"UNAVAILABLE",reason:"투자계획 조회 범위가 제한되어 최신 정책을 확신할 수 없습니다."};
 const at=account.asOf===null?NaN:Date.parse(account.asOf);
 const elapsed=now.getTime()-at;
 if(!Number.isFinite(at)||elapsed<0||elapsed>7*86400000)
   return {state:"UNAVAILABLE",reason:"계좌 스냅샷이 오래되었거나 기준 시각을 확인할 수 없습니다."};
 const currency=account.assets?.currency;
 const nav=money(account.assets?.netLiquidation??null);
 if(!currency||!/^[A-Z]{3}$/.test(currency)||nav===null||nav<=BigInt(0))
   return {state:"UNAVAILABLE",reason:"Tiger 계좌 순자산의 값 또는 표시 통화가 확인되지 않습니다."};
 const amounts=new Map<string,bigint>();
 let invested=BigInt(0);
 for(const p of account.positions){
   const quantity=money(p.quantity);
   if(quantity===null)
     return {state:"UNAVAILABLE",reason:"보유 수량에 검증할 수 없는 값이 있습니다."};
   if(quantity===BigInt(0))continue;
   if(p.currency!==currency)
     return {state:"UNAVAILABLE",reason:"종목 평가 통화와 계좌 순자산 통화가 일치하지 않습니다. FX 환산 없이 계산을 보류합니다."};
   const value=money(p.marketValue);
   if(value===null||value<=BigInt(0))
     return {state:"UNAVAILABLE",reason:"일부 보유 종목 평가액을 확인할 수 없습니다."};
   invested+=value;
   amounts.set(p.symbol,(amounts.get(p.symbol)??BigInt(0))+value);
 }
 if(!amounts.size)return {state:"UNAVAILABLE",reason:"계좌에서 평가할 보유 종목이 없습니다."};
 if(invested>nav)
   return {state:"UNAVAILABLE",reason:"종목 평가액 합계가 순자산을 초과하여 마진·통화·잔액 의미를 검증할 수 없습니다."};
 const latestPlans=new Map<string,JournalPlan>();
 for(const plan of [...plans].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
   if(!latestPlans.has(plan.ticker))latestPlans.set(plan.ticker,plan);
 }
 const positions=[...amounts].sort((a,b)=>a[1]===b[1]?a[0].localeCompare(b[0]):a[1]>b[1]?-1:1)
   .map(([ticker,value])=>{
     const limit=latestPlans.get(ticker)?.maxAllocationPct;
     const threshold=limitUnits(limit);
     return {ticker,observedAccountPct:percent(value,nav),
       personalPortfolioLimitPct:threshold===null?null:limit!,
       // A reference comparison, NEVER a finding that full portfolio policy is breached.
       exceedsAccountReference:threshold===null?null:value*BigInt(10000)>nav*threshold};
   });
 return {state:"READY",accountCurrency:currency,asOf:account.asOf!,
   denominator:"ACCOUNT_NAV",assessment:"ACCOUNT_COMPARISON_NOT_PORTFOLIO_COMPLIANCE",positions};
}
