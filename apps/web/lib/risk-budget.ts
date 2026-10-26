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
