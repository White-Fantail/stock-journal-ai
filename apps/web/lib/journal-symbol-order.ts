/** Sort the journal sidebar by the newest *user-authored investment record*.
 * Broker order syncs, manual executions and trade-linked reasons belong to
 * transaction details, and must not reorder the investment journal.
 */
import type {JournalEntry,JournalPlan} from "./saas-trades-api";
import {tradeLinked} from "./trade-reasons";

const validTime=(value:string):number=>{
  const time=Date.parse(value);
  return Number.isFinite(time)?time:Number.NEGATIVE_INFINITY;
};

export function journalLastRecordedAt(
 ticker:string,entries:readonly JournalEntry[],plans:readonly JournalPlan[],
):number|null{
 let recent=Number.NEGATIVE_INFINITY;
 for(const e of entries){
   if(e.ticker===ticker && !tradeLinked(e))
     recent=Math.max(recent,validTime(e.createdAt));
 }
 for(const p of plans){
   if(p.ticker===ticker)recent=Math.max(recent,validTime(p.createdAt));
 }
 return Number.isFinite(recent)?recent:null;
}

/** Recorded stocks first (newest first). Unrecorded holdings next, then other
 * observed stocks; alphabetical ties prevent flicker with identical times. */
export function orderJournalSymbols(
 symbols:readonly string[],entries:readonly JournalEntry[],
 plans:readonly JournalPlan[],heldSymbols:readonly string[],
):string[]{
 const latest=new Map<string,number>();
 for(const e of entries){
   if(tradeLinked(e))continue;
   const time=validTime(e.createdAt);
   if(Number.isFinite(time))latest.set(e.ticker,Math.max(latest.get(e.ticker)??Number.NEGATIVE_INFINITY,time));
 }
 for(const p of plans){
   const time=validTime(p.createdAt);
   if(Number.isFinite(time))latest.set(p.ticker,Math.max(latest.get(p.ticker)??Number.NEGATIVE_INFINITY,time));
 }
 const held=new Set(heldSymbols);
 return [...new Set(symbols)].sort((a,b)=>{
   const aTime=latest.get(a),bTime=latest.get(b);
   if(aTime!==undefined||bTime!==undefined){
     if(aTime===undefined)return 1;
     if(bTime===undefined)return -1;
     if(aTime!==bTime)return bTime-aTime;
   }
   return Number(held.has(b))-Number(held.has(a))||a.localeCompare(b);
 });
}
