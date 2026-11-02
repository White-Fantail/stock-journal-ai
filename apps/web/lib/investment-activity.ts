/** Presentation-only projection: preserves source identity and does not reconcile ledgers. */
import type {JournalEntry, JournalPlan, ManualTradeEvent} from "./saas-trades-api";
import type {TigerPersonalOrder,TigerPersonalFill,VerifiedBrokerExecution} from "./tiger-api";
import {groupTigerOrderObservations,type GroupedTigerOrder} from "./tiger-order-groups";
import {tradeLinked} from "./trade-reasons";

type Base={id:string;at:number|null};
export type InvestmentActivity=
  | (Base&{category:"PLAN";value:JournalPlan})
  | (Base&{category:"NOTE";value:JournalEntry})
  | (Base&{category:"MANUAL";value:ManualTradeEvent})
  | (Base&{category:"OBSERVED_ORDER";value:GroupedTigerOrder})
  | (Base&{category:"UNLINKED_FILL";value:TigerPersonalFill})
  | (Base&{category:"VERIFIED";value:VerifiedBrokerExecution});

export type ActivitySources={
  ticker:string;
  entries:readonly JournalEntry[];
  plans:readonly JournalPlan[];
  trades:readonly ManualTradeEvent[];
  orders:readonly TigerPersonalOrder[];
  fills:readonly TigerPersonalFill[];
  verified:readonly VerifiedBrokerExecution[];
};

function isoTime(value:string|null|undefined):number|null{
  if(!value) return null;
  const n=Date.parse(value);
  return Number.isFinite(n)?n:null;
}
function orderTime(value:string|null):number|null{
  // Tiger's personal observation 'at' is milliseconds, not an ISO execution time.
  if(!value||!/^\d{12,15}$/.test(value))return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&Number.isFinite(new Date(n).valueOf())?n:null;
}
export function activityForTicker(s:ActivitySources):InvestmentActivity[]{
  const output:InvestmentActivity[]=[];
  const voided=new Set(s.trades.filter(t=>t.kind==="VOID").map(t=>t.voidsEventId));
  for(const p of s.plans)if(p.ticker===s.ticker)
    output.push({id:"plan:"+p.id,category:"PLAN",at:isoTime(p.createdAt),value:p});
  for(const e of s.entries)if(e.ticker===s.ticker&&!tradeLinked(e))
    output.push({id:"note:"+e.id,category:"NOTE",at:isoTime(e.createdAt),value:e});
  for(const t of s.trades)if(t.kind==="EXECUTION"&&t.ticker===s.ticker&&!voided.has(t.id))
    output.push({id:"manual:"+t.id,category:"MANUAL",at:isoTime(t.executedAt),value:t});
  const observed=groupTigerOrderObservations(
    s.orders.filter(o=>o.symbol===s.ticker),s.fills.filter(f=>f.symbol===s.ticker));
  for(const group of observed.orders)
    output.push({id:"order:"+group.order.sourceRef,category:"OBSERVED_ORDER",
      at:orderTime(group.order.at),value:group});
  for(const f of observed.unlinked)
    output.push({id:"fill:"+f.sourceRef,category:"UNLINKED_FILL",at:null,value:f});
  for(const f of s.verified)if(f.symbol===s.ticker)
    output.push({id:"verified:"+f.accountId+":"+f.sourceRef+":"+f.reviewVersion,
      category:"VERIFIED",at:isoTime(f.executedAt),value:f});
  // Unknown source times sort last; an unparseable fill timestamp must not
  // fabricate chronology or be treated as a verified execution.
  return output.sort((a,b)=>
    (b.at??-Infinity)-(a.at??-Infinity)||a.id.localeCompare(b.id));
}

/** Context only, never proof that a transaction followed the preceding plan. */
export function planBeforeTrade(
  activity:InvestmentActivity,plans:readonly JournalPlan[],
):JournalPlan|null{
  if(!["MANUAL","OBSERVED_ORDER","VERIFIED"].includes(activity.category)||activity.at===null)
    return null;
  const ticker=activity.category==="MANUAL"?activity.value.ticker:
    activity.category==="OBSERVED_ORDER"?activity.value.order.symbol:
    activity.category==="VERIFIED"?activity.value.symbol:null;
  return plans.filter(p=>p.ticker===ticker&&isoTime(p.createdAt)!==null&&
      isoTime(p.createdAt)!<=activity.at!)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0]??null;
}
