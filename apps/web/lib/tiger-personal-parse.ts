/** Defensive, loss-aware reader for signed owner-only Tiger observations.
 * A malformed quote or individual observation must not hide the user's valid
 * stored account and historical orders. Only individually validated source
 * rows are returned, and every dropped field is visibly marked incomplete.
 */
import type {
  TigerPersonalRead,TigerPersonalAccount,TigerPersonalPosition,TigerPersonalOrder,
  TigerPersonalFill,TigerPersonalFee,TigerMarketObservation,
} from "./tiger-api";

type Obj=Record<string,unknown>;
const object=(x:unknown):x is Obj=>!!x && typeof x==="object" && !Array.isArray(x);
const decimal=(x:unknown):x is string=>typeof x==="string" &&
  /^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/.test(x);
const nullableDecimal=(x:unknown):x is string|null=>x===null || decimal(x);
const moneyCurrency=(x:unknown):x is string=>typeof x==="string" && /^[A-Z]{3}$/.test(x);
const symbol=(x:unknown):x is string=>typeof x==="string" && /^[A-Z0-9.:-]{1,32}$/.test(x);
const hash=(x:unknown):x is string=>typeof x==="string" && /^[a-f0-9]{64}$/.test(x);
const integer=(x:unknown):x is number=>typeof x==="number" && Number.isSafeInteger(x) && x>=0;
const time=(x:unknown):x is string=>typeof x==="string" && x.length<=64 && Number.isFinite(Date.parse(x));
const epoch=(x:unknown):x is string=>typeof x==="string" && /^[0-9]{13}$/.test(x);
const side=(x:unknown):x is "BUY"|"SELL"=>x==="BUY" || x==="SELL";

function position(x:unknown):x is TigerPersonalPosition {
  return object(x) && symbol(x.symbol) && moneyCurrency(x.currency) && decimal(x.quantity) &&
    nullableDecimal(x.averageCost) && nullableDecimal(x.marketValue) && nullableDecimal(x.unrealizedPnl);
}
function order(x:unknown):x is TigerPersonalOrder {
  return object(x) && hash(x.sourceRef) && symbol(x.symbol) && moneyCurrency(x.currency) &&
    side(x.side) && typeof x.status==="string" && /^[A-Z_]{3,32}$/.test(x.status) &&
    nullableDecimal(x.filled) && nullableDecimal(x.price) && nullableDecimal(x.fee) &&
    (x.feeCurrency===null || moneyCurrency(x.feeCurrency)) &&
    (x.at===null || epoch(x.at));
}
function fill(x:unknown):x is TigerPersonalFill {
  return object(x) && hash(x.sourceRef) && symbol(x.symbol) &&
    moneyCurrency(x.currency) && side(x.side) && decimal(x.quantity) && decimal(x.price) &&
    (x.timeRaw===null || (typeof x.timeRaw==="string" &&
      /^(?:[0-9]{13}|[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2})$/.test(x.timeRaw)));
}
function fee(x:unknown):x is TigerPersonalFee {
  return object(x) && hash(x.sourceRef) && symbol(x.symbol) &&
    (x.status==="MATCHED" || x.status==="CURRENCY_UNKNOWN") &&
    decimal(x.total) && (x.currency===null || moneyCurrency(x.currency)) &&
    (x.status==="MATCHED") === (x.currency!==null) &&
    Array.isArray(x.details) && x.details.length>0 && x.details.length<=32 &&
    x.details.every(d=>object(d) && (d.category==="TIGER" || d.category==="THIRD_PARTY") &&
      typeof d.type==="string" && /^[A-Z_]{2,40}$/.test(d.type) && decimal(d.amount));
}
function quote(x:unknown):x is TigerMarketObservation {
  return object(x) && typeof x.symbol==="string" && /^[A-Z][A-Z0-9.]{0,13}$/.test(x.symbol) &&
    x.currency==="USD" && decimal(x.price) && x.price!=="0" && epoch(x.quoteAt) &&
    (x.mode==="US_DELAYED_15M" || x.mode==="REALTIME_PERMISSIONED") &&
    typeof x.stale==="boolean" && nullableDecimal(x.estimatedValue) &&
    nullableDecimal(x.estimatedUnrealized) && nullableDecimal(x.estimatedReturnPct);
}
function list<T>(value:unknown,max:number,validate:(x:unknown)=>x is T,
                 code:string,warnings:Set<string>):T[]{
  if(!Array.isArray(value)){
    warnings.add(code);
    return [];
  }
  if(value.length>max) warnings.add(code);
  const result:T[]=[];
  for(const item of value.slice(0,max)){
    if(validate(item)) result.push(item);
    else warnings.add(code);
  }
  return result;
}

export type PersonalReadParseResult={
  value:TigerPersonalRead|null;
  warnings:readonly string[];
};

/** Failure labels contain *no* account, symbol, money, id or source payload. */
export function parsePersonalRead(raw:unknown):PersonalReadParseResult {
  const warnings=new Set<string>();
  if(!object(raw) || raw.coverage!=="SNAPSHOT_ONLY" || raw.verified!==false ||
    !Array.isArray(raw.accounts) || raw.accounts.length>5)
    return {value:null,warnings:["ENVELOPE_INVALID"]};
  const accounts:TigerPersonalAccount[]=[];
  for(const unknown of raw.accounts){
    if(!object(unknown) || typeof unknown.alias!=="string" ||
      unknown.alias.length>100 || !Array.isArray(unknown.positions) ||
      !Array.isArray(unknown.orders)){
      return {value:null,warnings:["ACCOUNT_STRUCTURE_INVALID"]};
    }
    const a=unknown;
    const asOf=a.asOf===null || time(a.asOf) ? a.asOf as string|null : null;
    if(asOf===null && a.asOf!==null) warnings.add("ACCOUNT_TIME_INVALID");
    let assets:TigerPersonalAccount["assets"]=null;
    if(a.assets!==null){
      if(object(a.assets) && nullableDecimal(a.assets.netLiquidation) &&
          nullableDecimal(a.assets.cashBalance) &&
          (a.assets.currency===null || moneyCurrency(a.assets.currency))){
        assets={netLiquidation:a.assets.netLiquidation,
          cashBalance:a.assets.cashBalance,currency:a.assets.currency};
      }else warnings.add("ASSETS_INVALID");
    }
    const positions=list(a.positions,100,position,"POSITIONS_INVALID",warnings);
    const orders=list(a.orders,120,order,"ORDERS_INVALID",warnings);
    const marketObservations=list(a.marketObservations,40,quote,"QUOTES_INVALID",warnings);
    const fillObservations=list(a.fillObservations,60,fill,"FILLS_INVALID",warnings);
    const feeObservations=list(a.feeObservations,30,fee,"FEES_INVALID",warnings);
    const positive=(key:string):number=>{
      if(integer(a[key])) return a[key] as number;
      warnings.add("COUNTS_INVALID");
      return 0;
    };
    const partial=typeof a.partial==="boolean"?a.partial:true;
    const truncated=typeof a.truncated==="boolean"?a.truncated:true;
    const hasMore=typeof a.hasMore==="boolean"?a.hasMore:false;
    if(typeof a.partial!=="boolean" || typeof a.truncated!=="boolean" ||
       typeof a.hasMore!=="boolean") warnings.add("PAGINATION_INVALID");
    accounts.push({
      alias:a.alias as string,asOf,assets,positions,orders,marketObservations,
      fillObservations,feeObservations,
      fillProbeCount:positive("fillProbeCount"),fillProbeUnavailable:positive("fillProbeUnavailable"),
      fillProbeDifference:positive("fillProbeDifference"),fillProbePartial:positive("fillProbePartial"),
      fillProbeTruncated:typeof a.fillProbeTruncated==="boolean"?a.fillProbeTruncated:true,
      feeProbeMatched:positive("feeProbeMatched"),feeProbeCurrencyUnknown:positive("feeProbeCurrencyUnknown"),
      feeProbeDifference:positive("feeProbeDifference"),feeProbeUnavailable:positive("feeProbeUnavailable"),
      windowCount:positive("windowCount"),totalOrders:positive("totalOrders"),
      hasMore,partial,truncated,
    });
    if(typeof a.fillProbeTruncated!=="boolean") warnings.add("PAGINATION_INVALID");
  }
  const safeAccounts=warnings.size?accounts.map(a=>({...a,partial:true})):accounts;
  const output:TigerPersonalRead={
    coverage:"SNAPSHOT_ONLY",verified:false,accounts:safeAccounts,
    ...(warnings.size ? {readWarnings:[...warnings].sort()} : {}),
  };
  return {value:output,warnings:[...warnings].sort()};
}
