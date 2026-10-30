/** One authored reason is saved once. Transaction-linked notes belong in trade
 * details; the investment journal may reference them, never copy their body.
 */
import type {JournalEntry} from "./saas-trades-api";

export function tradeLinked(entry:JournalEntry):boolean {
  return entry.kind==="TRADE_NOTE" &&
    Boolean(entry.observationRef || entry.brokerRef || entry.tradeEventId);
}
export function notesForObserved(
  entries:readonly JournalEntry[],
  ref:string,kind:"ORDER"|"FILL",accountId?:string,
):JournalEntry[]{
  return entries.filter(e=>e.kind==="TRADE_NOTE" &&
    e.observationRef?.kind===kind && e.observationRef.sourceRef===ref &&
    (accountId===undefined || e.observationRef.accountId===accountId))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export function reasonPreview(notes:readonly JournalEntry[],limit=95):string|null {
  if(notes.length===0)return null;
  const raw=notes[0].content.trim().replace(/\s+/g," ");
  return raw.length>limit?raw.slice(0,limit).trimEnd()+"…":raw;
}
export function tigerTradeHref(ref:string,page=0,kind:"ORDER"|"FILL"="ORDER"):string {
  if(!/^[a-f0-9]{64}$/.test(ref) || !Number.isInteger(page) || page<0||page>20)
    throw new Error("Invalid order reference");
  return "/private/trades/tiger/"+ref+"?page="+page+"&kind="+kind;
}
