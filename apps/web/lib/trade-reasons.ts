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

/** Legacy correction notes are append-only and explicitly reference their predecessor.
 * This parser does not treat arbitrary user text as a correction unless it uses
 * the exact generated prefix. The original journal entry is never overwritten.
 */
const CORRECTION=/^정정 \(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\): /i;
export function correctionOf(note:JournalEntry):{parentId:string;content:string}|null {
  if(note.kind!=="TRADE_NOTE")return null;
  const match=CORRECTION.exec(note.content);
  return match?{parentId:match[1].toLowerCase(),content:note.content.slice(match[0].length)}:null;
}
export function latestObservedReasons(notes:readonly JournalEntry[]):{
  current:JournalEntry;history:readonly JournalEntry[];
}[]{
  const byId=new Map(notes.map(note=>[note.id.toLowerCase(),note]));
  const children=new Map<string,JournalEntry[]>();
  for(const note of notes){
    const correction=correctionOf(note);
    if(!correction||!byId.has(correction.parentId)||correction.parentId===note.id.toLowerCase())continue;
    const parent=byId.get(correction.parentId)!;
    if(parent.ticker!==note.ticker||parent.observationRef?.sourceRef!==note.observationRef?.sourceRef||
       parent.observationRef?.kind!==note.observationRef?.kind)continue;
    children.set(correction.parentId,[...(children.get(correction.parentId)??[]),note]);
  }
  const corrected=new Set([...children.keys()]);
  return notes.filter(note=>!corrected.has(note.id.toLowerCase())).map(note=>{
    const history:JournalEntry[]=[note];
    const seen=new Set([note.id.toLowerCase()]);
    let cursor=note;
    while(true){
      const parentId=correctionOf(cursor)?.parentId;
      const parent=parentId?byId.get(parentId):null;
      if(!parent||seen.has(parent.id.toLowerCase())||!children.get(parent.id.toLowerCase())?.includes(cursor))break;
      history.push(parent);
      seen.add(parent.id.toLowerCase());
      cursor=parent;
    }
    return {current:note,history};
  });
}
