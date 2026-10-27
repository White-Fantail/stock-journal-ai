/** Illustration-only sizing for an unlevered LONG stock plan.
 * Pure fixed-point math; does NOT fetch quotes or create broker orders.
 * Does not protect against gaps, slippage, fees, FX, taxes, or existing exposure.
 */
const VALID=/^(?:0|[1-9][0-9]{0,20})(?:\.[0-9]{1,12})?$/;
const SCALE=BigInt(10)**BigInt(12);
function parse(value:string):bigint|null{
 if(!VALID.test(value))return null;
 const [whole,dec=""]=value.split(".");
 return BigInt(whole)*SCALE+BigInt(dec.padEnd(12,"0"));
}
function money(amount:bigint):string{
 const scale=BigInt(10)**BigInt(10);
 const rounded=(amount+scale/BigInt(2))/scale;
 return (rounded/BigInt(100)).toString()+"."+(rounded%BigInt(100)).toString().padStart(2,"0");
}
export type RiskBudgetResult=
 |{status:"OK";maximumLoss:string;maxShares:string;estimatedCapitalUsed:string;estimatedPlanLoss:string;limitedBy:"CAPITAL"|"RISK"}
 |{status:"INVALID";reason:string};
export function calculateLongRisk(input:{
 capital:string;entry:string;invalidation:string;riskPercent:string;
}):RiskBudgetResult{
 const capital=parse(input.capital),entry=parse(input.entry);
 const invalidation=parse(input.invalidation),pct=parse(input.riskPercent);
 if(capital===null||entry===null||invalidation===null||pct===null||
    capital<=BigInt(0)||entry<=BigInt(0)||pct<=BigInt(0)||pct>BigInt(100)*SCALE||
    invalidation>=entry)
   return {status:"INVALID",reason:"양수인 자산·진입가·위험 비율과 진입가보다 낮은 무효화 가격을 입력하세요. 위험 비율은 100%를 넘을 수 없습니다."};
 const maximumLoss=capital*pct/(BigInt(100)*SCALE);
 const perShareRisk=entry-invalidation;
 const byRisk=maximumLoss/perShareRisk;
 const byCapital=capital/entry;
 const maxShares=byRisk<byCapital?byRisk:byCapital;
 return {status:"OK",maximumLoss:money(maximumLoss),
   maxShares:maxShares.toString(),
   estimatedCapitalUsed:money(maxShares*entry),
   estimatedPlanLoss:money(maxShares*perShareRisk),
   limitedBy:byRisk<=byCapital?"RISK":"CAPITAL"};
}


/** Long-only, whole-share pre-buy scenario. Existing holdings are never silently
 * treated as zero: callers must provide an explicit, currency-matched holding set.
 * A share's pre-existing loss-at-stop uses its known average acquisition cost.
 * Price gaps, missing accounts and broker execution are outside this estimate.
 */
export type RiskHolding = Readonly<{quantity:string;averageCost:string|null}>;
export type PreBuyRiskResult =
 | {status:"OK";maximumLoss:string;heldPlanLoss:string;remainingLossBudget:string;
    maxShares:string;estimatedCapitalUsed:string;estimatedPlanLoss:string;
    estimatedTotalPlanLoss:string;limitedBy:"CAPITAL"|"RISK"|"EXISTING"}
 | {status:"INVALID";reason:string};
export function calculatePreBuyRisk(input:{
 capital:string;availableCash:string;entry:string;invalidation:string;
 riskPercent:string;holdings:readonly RiskHolding[];
}):PreBuyRiskResult {
 const capital=parse(input.capital),cash=parse(input.availableCash);
 const entry=parse(input.entry),stop=parse(input.invalidation),pct=parse(input.riskPercent);
 if(capital===null||cash===null||entry===null||stop===null||pct===null||
   capital<=BigInt(0)||cash<=BigInt(0)||entry<=BigInt(0)||stop>=entry||
   pct<=BigInt(0)||pct>BigInt(100)*SCALE)
   return {status:"INVALID",reason:"위험 기준 자금·매수 가용 현금·매수가·손실 비율을 확인하고, 손절 기준 가격은 매수가보다 낮게 입력하세요."};
 if(!Array.isArray(input.holdings)||input.holdings.length>100)
   return {status:"INVALID",reason:"기존 보유 자료를 확인할 수 없습니다."};
 let heldPlanLoss=BigInt(0);
 for(const holding of input.holdings){
   const quantity=parse(holding.quantity);
   if(quantity===null) return {status:"INVALID",reason:"기존 보유 수량을 확인해 주세요."};
   if(quantity===BigInt(0))continue;
   const cost=holding.averageCost===null?null:parse(holding.averageCost);
   if(cost===null||cost<=BigInt(0))
     return {status:"INVALID",reason:"기존 보유 주식의 평균 매수가가 필요합니다. 알 수 없다면 계산을 보류하세요."};
   if(cost>stop)heldPlanLoss+=(quantity*(cost-stop)+SCALE-BigInt(1))/SCALE;
 }
 const maximumLoss=capital*pct/(BigInt(100)*SCALE);
 const remaining=maximumLoss>heldPlanLoss?maximumLoss-heldPlanLoss:BigInt(0);
 const perShareRisk=entry-stop;
 const byRisk=remaining/perShareRisk;
 const byCapital=cash/entry;
 const shares=byRisk<byCapital?byRisk:byCapital;
 const limitedBy=heldPlanLoss>=maximumLoss?"EXISTING":
   byRisk<=byCapital?"RISK":"CAPITAL";
 const newLoss=shares*perShareRisk;
 return {status:"OK",maximumLoss:money(maximumLoss),heldPlanLoss:money(heldPlanLoss),
   remainingLossBudget:money(remaining),maxShares:shares.toString(),
   estimatedCapitalUsed:money(shares*entry),estimatedPlanLoss:money(newLoss),
   estimatedTotalPlanLoss:money(heldPlanLoss+newLoss),limitedBy};
}
