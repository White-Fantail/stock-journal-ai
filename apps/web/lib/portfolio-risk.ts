/** Read-only concentration of a SINGLE Tiger account snapshot, never live pricing.
 * Unknown, stale, mixed-currency or incomplete POSITION observations fail closed.
 * Percentages describe the observed invested stock market values only (not cash
 * or account equity). No order, price alert, quote fetch, or persistence.
 */
import type {TigerPersonalAccount} from "./tiger-api";

type Position=Readonly<{symbol:string;percent:string}>;
export type ConcentrationResult=
  |Readonly<{status:"READY";currency:string;asOf:string;positions:Position[];
      largestPercent:string;topTwoPercent:string;basis:"INVESTED_STOCK_MARKET_VALUE"}>
  |Readonly<{status:"UNAVAILABLE";reason:string}>;

const AMOUNT=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const SCALE=10n**12n;
function units(value:string):bigint|null{
  if(!AMOUNT.test(value))return null;
  const [whole,fraction=""]=value.split(".");
  return BigInt(whole)*SCALE+BigInt(fraction.padEnd(12,"0"));
}
function percent(value:bigint,total:bigint):string{
  const hundredths=(value*10000n+total/2n)/total;
  return (hundredths/100n).toString()+"."+(hundredths%100n).toString().padStart(2,"0");
}

export function assessConcentration(
  account:Pick<TigerPersonalAccount,"asOf"|"positions">,
  now=new Date(),
):ConcentrationResult{
  const when=account.asOf===null?NaN:Date.parse(account.asOf);
  const age=now.getTime()-when;
  if(!Number.isFinite(when)||age<0||age>7*86400000)
    return {status:"UNAVAILABLE",reason:"계좌 스냅샷이 없거나 7일 이상 오래되어 비중을 표시하지 않습니다."};
  const holdings=new Map<string,bigint>();
  let currency:string|null=null;
  for(const position of account.positions){
    const q=units(position.quantity);
    if(q===null) return {status:"UNAVAILABLE",reason:"보유 수량에 검증할 수 없는 값이 있습니다."};
    if(q===0n)continue;
    if(!/^[A-Z]{3}$/.test(position.currency))
      return {status:"UNAVAILABLE",reason:"보유 종목의 표시 통화를 확인할 수 없습니다."};
    if(currency!==null&&currency!==position.currency)
      return {status:"UNAVAILABLE",reason:"서로 다른 통화가 섞여 있어 환산하지 않고 계산을 보류합니다."};
    currency=position.currency;
    const amount=position.marketValue===null?null:units(position.marketValue);
    if(amount===null||amount===0n)
      return {status:"UNAVAILABLE",reason:"일부 보유 종목의 Tiger 평가액이 확인되지 않았습니다."};
    holdings.set(position.symbol,(holdings.get(position.symbol)??0n)+amount);
  }
  if(currency===null||holdings.size===0)
    return {status:"UNAVAILABLE",reason:"비중을 계산할 보유 종목이 없습니다."};
  const items=[...holdings].sort((a,b)=>a[1]===b[1]?a[0].localeCompare(b[0]):a[1]>b[1]?-1:1);
  const total=items.reduce((acc,[,amount])=>acc+amount,0n);
  if(total===0n)return {status:"UNAVAILABLE",reason:"관측 평가액 합계를 확인할 수 없습니다."};
  return {status:"READY",currency,asOf:account.asOf!,basis:"INVESTED_STOCK_MARKET_VALUE",
    positions:items.map(([symbol,amount])=>({symbol,percent:percent(amount,total)})),
    largestPercent:percent(items[0][1],total),
    topTwoPercent:percent(items.slice(0,2).reduce((sum,[,amount])=>sum+amount,0n),total)};
}
