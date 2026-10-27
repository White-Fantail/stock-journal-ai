/** Strict one-account Tiger statement fee-currency attestation.
 *
 * No statement HTML, raw account number, order IDs or trade facts are shipped
 * in the public repository. A private server-side configuration may contain
 * the ten manually reviewed statement rows. Only exact independent order
 * observations with matching account alias, USD base/trade currency, side,
 * filled quantity, price, fee AND US/Eastern execution time receive the
 * statement's fee currency. This is an annotation, NOT ledger certification.
 */
import type {TigerPersonalOrder} from "./tiger-api";

export type StatementFeeRow=Readonly<{
  symbol:string;side:"BUY"|"SELL";quantity:string;price:string;
  fee:string;tradeTimeEastern:string;currency:"USD"
}>;
export type StatementFeeEvidence=Readonly<{
  accountAlias:string;baseCurrency:"USD";periodStart:"2026-08-01";
  periodEnd:"2026-10-25";source:"OWNER_PROVIDED_TIGER_STATEMENT";
  rows:readonly StatementFeeRow[];
}>;
export type FeeCurrencyDisplay=Readonly<{
 currency:string|null;basis:"TIGER_API"|"STATEMENT_MATCH"|"UNKNOWN"|"CONFLICT";
}>;

const MONEY=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const SYM=/^[A-Z0-9.:-]{1,32}$/;
const TIME=/^2026-(?:08|09|10)-[0-3][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9]$/;
const REF=/^[a-f0-9]{64}$/;
function amount(raw:string|null):bigint|null{
 if(raw===null||!MONEY.test(raw))return null;
 const [whole,fraction=""]=raw.split(".");
 return BigInt(whole)*1000000000000n+BigInt(fraction.padEnd(12,"0"));
}
function easternOrderTime(raw:string|null):string|null{
 if(!raw||!/^\d{13}$/.test(raw))return null;
 const date=new Date(Number(raw));
 if(!Number.isFinite(date.valueOf()))return null;
 const pieces=new Intl.DateTimeFormat("en-GB",{
   timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",
   hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",
 }).formatToParts(date);
 const get=(type:string)=>pieces.find(x=>x.type===type)?.value??"";
 return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
export function parseStatementFeeEvidence(raw:string|undefined):StatementFeeEvidence|null{
 if(!raw||raw.length>8000)return null;
 try{
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const o=value as Record<string,unknown>;
  if(Object.keys(o).sort().join(",")!==
    "accountAlias,baseCurrency,periodEnd,periodStart,rows,source"||
     typeof o.accountAlias!=="string"||
     !/^Tiger pilot ••••[0-9]{4}$/.test(o.accountAlias)||
     o.baseCurrency!=="USD"||o.periodStart!=="2026-08-01"||
     o.periodEnd!=="2026-10-25"||
     o.source!=="OWNER_PROVIDED_TIGER_STATEMENT"||
     !Array.isArray(o.rows)||o.rows.length!==10)return null;
  const unique=new Set<string>();
  for(const item of o.rows){
    if(!item||typeof item!=="object"||Array.isArray(item))return null;
    const row=item as Record<string,unknown>;
    if(Object.keys(row).sort().join(",")!==
       "currency,fee,price,quantity,side,symbol,tradeTimeEastern"||
       typeof row.symbol!=="string"||!SYM.test(row.symbol)||
       (row.side!=="BUY"&&row.side!=="SELL")||
       typeof row.quantity!=="string"||amount(row.quantity)===null||
       amount(row.quantity)===0n||
       typeof row.price!=="string"||amount(row.price)===null||
       typeof row.fee!=="string"||amount(row.fee)===null||
       typeof row.tradeTimeEastern!=="string"||!TIME.test(row.tradeTimeEastern)||
       row.tradeTimeEastern.slice(0,10)<"2026-08-01"||
       row.tradeTimeEastern.slice(0,10)>"2026-10-25"||
       row.currency!=="USD")return null;
    const key=`${row.symbol}|${row.side}|${row.tradeTimeEastern}|${amount(row.quantity)}|${amount(row.price)}|${amount(row.fee)}`;
    if(unique.has(key))return null;
    unique.add(key);
  }
  return o as unknown as StatementFeeEvidence;
 }catch{return null;}
}
function attested(order:TigerPersonalOrder,accountAlias:string,
 baseCurrency:string|null,evidence:StatementFeeEvidence|null):boolean{
 if(!evidence||accountAlias!==evidence.accountAlias||
   baseCurrency!=="USD"||order.currency!=="USD"||
   order.status!=="FILLED"||!REF.test(order.sourceRef)||
   order.fee===null||order.filled===null||order.price===null)return false;
 const when=easternOrderTime(order.at);
 if(!when)return false;
 return evidence.rows.some(r=>
   r.symbol===order.symbol&&r.side===order.side&&
   r.tradeTimeEastern===when&&
   amount(r.quantity)===amount(order.filled)&&
   amount(r.price)===amount(order.price)&&
   amount(r.fee)===amount(order.fee));
}
export function statementMatchesOrder(order:TigerPersonalOrder,accountAlias:string,
 baseCurrency:string|null,evidence:StatementFeeEvidence|null):boolean{
 return attested(order,accountAlias,baseCurrency,evidence);
}
export function resolvedFeeCurrency(order:TigerPersonalOrder,accountAlias:string,
 baseCurrency:string|null,evidence:StatementFeeEvidence|null):FeeCurrencyDisplay{
 const matching=attested(order,accountAlias,baseCurrency,evidence);
 if(order.feeCurrency!==null){
  if(matching&&order.feeCurrency!=="USD")
   return {currency:null,basis:"CONFLICT"};
  return {currency:order.feeCurrency,basis:"TIGER_API"};
 }
 if(matching)return {currency:"USD",basis:"STATEMENT_MATCH"};
 return {currency:null,basis:"UNKNOWN"};
}
