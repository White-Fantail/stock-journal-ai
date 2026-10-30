/** Price-bearing plan/note comparison runs locally. The resulting values must
 * NEVER be added to the OpenRouter evidence envelope or provider requests.
 * These are review candidates, NOT verified plan changes, trading signals,
 * or judgments about user intent.
 */
import type {JournalEntry,JournalPlan} from "./saas-trades-api";

export type PlanNoteDifference=Readonly<{
 ticker:string;kind:"TARGET"|"STOP"|"EXIT_CONDITION";
 planned:string;mentioned:string;currency:string|null;notedAt:string;
 source:"USER_AUTHORED_NOTE_REVIEW_CANDIDATE";
}>;
const amount=(value:string|null|undefined):number|null=>{
 if(!value||! /^\d{1,8}(?:\.\d{1,4})?$/.test(value))return null;
 const n=Number(value);
 return Number.isFinite(n)&&n>0?n:null;
};
const same=(a:number,b:number)=>Math.abs(a-b)<0.00001;
const phrase=/(목표가|목표\s*가격|손절가|손절\s*기준|target\s*price|stop\s*loss)\s*(?:을|를|은|는|:|=)?\s*(USD|NZD|AUD|KRW|EUR|US\$|NZ\$|\$)?\s*(\d{1,8}(?:\.\d{1,4})?)/gi;
const exit=/(\d{1,8}(?:\.\d{1,4})?)\s*(?:달러|불|USD)?\s*(?:가|이)?\s*(?:깨지|이탈|하회)\s*(?:면|시)?[^.!?\n]{0,30}?(?:전량\s*)?(?:매도|청산)/g;
const ccy=(raw:string)=>{
 const v=raw.toUpperCase();
 return v==="US$"||v==="$"?"USD":v==="NZ$"?"NZD":v;
};
export function planNoteDifferences(
  ticker:string,notes:readonly JournalEntry[],plans:readonly JournalPlan[],
):PlanNoteDifference[]{
 const plan=plans.filter(p=>p.ticker===ticker)
   .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
 if(!plan)return [];
 const currentTarget=amount(plan.targetPrice),currentStop=amount(plan.stopPrice);
 const start=Date.parse(plan.createdAt);
 if(!Number.isFinite(start))return [];
 const candidates:PlanNoteDifference[]=[];
 const seen=new Set<string>();
 const append=(kind:PlanNoteDifference["kind"],planned:number|null,mentioned:string,on:string)=>{
   const parsed=amount(mentioned);
   if(planned===null||parsed===null||same(planned,parsed))return;
   const key=kind+":"+mentioned;
   if(seen.has(key)||candidates.length>=4)return;
   seen.add(key);
   candidates.push({ticker,kind,planned:String(planned),mentioned:String(parsed),
     currency:plan.priceCurrency,notedAt:on,
     source:"USER_AUTHORED_NOTE_REVIEW_CANDIDATE"});
 };
 for(const note of notes.filter(n=>n.ticker===ticker&&Date.parse(n.createdAt)>start)
   .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,24)){
   if(candidates.length>=4)break;
   const text=note.content.slice(0,6000);
   for(const match of text.matchAll(new RegExp(phrase.source,"gi"))){
     const label=match[1].replace(/\s+/g,"").toLowerCase();
     const currency=match[2];
     if(currency&&plan.priceCurrency&&ccy(currency)!==plan.priceCurrency.toUpperCase())
       continue;
     const kind=label.includes("목표")||label.startsWith("target")?"TARGET":"STOP";
     append(kind,kind==="TARGET"?currentTarget:currentStop,match[3],note.createdAt);
   }
   for(const match of text.matchAll(new RegExp(exit.source,"g")))
     append("EXIT_CONDITION",currentStop,match[1],note.createdAt);
 }
 return candidates;
}
