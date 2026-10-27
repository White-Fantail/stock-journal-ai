/** On-demand monthly decision-process report. All inputs are already tenant scoped.
 * No quotes, P&L inference, performance claims, cron, new tables or AI request.
 */
import type {JournalEntry,JournalPlan,ManualTradeEvent} from "./saas-trades-api";
import {dueInvestmentReviews} from "./review-schedule";

export type MonthWindow=Readonly<{month:string;start:number;end:number}>;
type SymbolActivity=Readonly<{ticker:string;notes:number;reviews:number;plans:number;manualRecords:number}>;
export type MonthlyProcessReport=Readonly<{
  month:string;timezone:"Pacific/Auckland";start:string;end:string;
  noteCount:number;reviewCount:number;planRevisionCount:number;
  userTradeRecordCount:number;voidCount:number;
  uniqueSymbols:number;symbols:readonly SymbolActivity[];
  plannedSymbols:number;completeStrategySymbols:number;
  dueAsOfCutoff:number;checkedAsOf:string;
  selfReviewCount:number;
  selfReviewBreakdown:Readonly<{FOLLOWED:number;PARTIAL:number;DEVIATED:number;UNCERTAIN:number}>;
  adherenceBasis?:"USER_SELF_ASSESSED_NOT_BROKER_VERIFIED";
  source:"USER_AUTHORED_PROCESS_ONLY";
}>;
const MONTH=/^(20[2-9][0-9])-(0[1-9]|1[0-2])$/;
const ZONE="Pacific/Auckland" as const;
function nzOffsetMinutes(at:number):number{
  const value=new Intl.DateTimeFormat("en-US",{timeZone:ZONE,timeZoneName:"shortOffset"})
    .formatToParts(new Date(at)).find(p=>p.type==="timeZoneName")?.value??"";
  const m=/^GMT([+-])([0-9]{1,2})(?::([0-9]{2}))?$/.exec(value);
  if(!m)throw new Error("NZ_TIMEZONE_OFFSET_UNAVAILABLE");
  const mins=Number(m[2])*60+Number(m[3]??0);
  return m[1]==="-"?-mins:mins;
}
function nzMonthStart(year:number,month:number):number{
  const midnight=Date.UTC(year,month-1,1);
  // First-Sunday-in-April NZ DST may change later in the same day.
  // Resolve the offset at local midnight, not at midday or UTC midnight.
  let utc=midnight-nzOffsetMinutes(midnight)*60000;
  for(let i=0;i<3;i++){
    const corrected=midnight-nzOffsetMinutes(utc)*60000;
    if(corrected===utc)return utc;
    utc=corrected;
  }
  return utc;
}
export function currentNzMonth(now=new Date()):string{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:ZONE,year:"numeric",month:"2-digit"})
    .formatToParts(now);
  const year=parts.find(p=>p.type==="year")?.value;
  const month=parts.find(p=>p.type==="month")?.value;
  if(!year||!month)throw new Error("MONTH_UNKNOWN");
  return year+"-"+month;
}
export function monthWindow(value:string):MonthWindow|null{
  const m=MONTH.exec(value);
  if(!m)return null;
  const year=Number(m[1]),month=Number(m[2]);
  const nextYear=month===12?year+1:year;
  const nextMonth=month===12?1:month+1;
  return {month:value,start:nzMonthStart(year,month),end:nzMonthStart(nextYear,nextMonth)};
}
export function stepMonth(value:string,step:number):string|null{
 const m=monthWindow(value);
 if(!m||!Number.isInteger(step)||Math.abs(step)>12)return null;
 const [year,month]=value.split("-").map(Number);
 const d=new Date(Date.UTC(year,month-1+step,1));
 return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");
}
/** Legacy bounded-list helper kept for isolated tests; the private report uses DB aggregates. */
export function buildMonthlyProcessReport(
 value:string,notes:readonly JournalEntry[],plans:readonly JournalPlan[],
 trades:readonly ManualTradeEvent[],now=new Date(),
):Omit<MonthlyProcessReport,"selfReviewCount"|"selfReviewBreakdown">|null{
 const window=monthWindow(value);
 if(!window||!Number.isFinite(now.getTime())||
    window.start>now.getTime())return null;
 // Historical paging is bounded. Never label a truncated sample as complete.
 // API limits: journal notes 200, plan revisions 200, manual trade events 50.
 if(notes.length>=200||plans.length>=200||trades.length>=50)return null;
 const inWindow=(at:string|null|undefined)=>{
   const n=at?Date.parse(at):NaN;
   return Number.isFinite(n)&&n>=window.start&&n<Math.min(window.end,now.getTime()+1);
 };
 const ended=Math.min(window.end,now.getTime()+1);
 const journal=notes.filter(x=>inWindow(x.createdAt));
 const revisions=plans.filter(x=>inWindow(x.createdAt));
 const manual=trades.filter(x=>inWindow(x.createdAt));
 const symbols=new Map<string,{ticker:string;notes:number;reviews:number;plans:number;manualRecords:number}>();
 const touch=(ticker:string)=>{
   if(!symbols.has(ticker))symbols.set(ticker,{ticker,notes:0,reviews:0,plans:0,manualRecords:0});
   return symbols.get(ticker)!;
 };
 for(const note of journal){
   const bucket=touch(note.ticker);
   bucket.notes++;
   if(note.kind==="REVIEW")bucket.reviews++;
 }
 for(const plan of revisions)touch(plan.ticker).plans++;
 for(const trade of manual)if(trade.ticker)touch(trade.ticker).manualRecords++;
 const latest=new Map<string,JournalPlan>();
 for(const plan of [...plans].filter(p=>{
   const n=Date.parse(p.createdAt);return Number.isFinite(n)&&n<ended;
 }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
   if(!latest.has(plan.ticker))latest.set(plan.ticker,plan);
 }
 const complete=[...latest.values()].filter(p=>p.strategyType&&p.investmentHorizon&&
   p.invalidationCondition&&p.reviewCadence&&p.maxAllocationPct);
 const due=dueInvestmentReviews([...latest.values()],
   notes.filter(n=>Date.parse(n.createdAt)<ended),new Date(ended-1));
 return {month:value,timezone:ZONE,
   start:new Date(window.start).toISOString(),end:new Date(window.end).toISOString(),
   noteCount:journal.length,reviewCount:journal.filter(n=>n.kind==="REVIEW").length,
   planRevisionCount:revisions.length,
   userTradeRecordCount:manual.filter(t=>t.kind==="EXECUTION").length,
   voidCount:manual.filter(t=>t.kind==="VOID").length,
   uniqueSymbols:symbols.size,
   symbols:[...symbols.values()].sort((a,b)=>b.notes+b.plans+b.manualRecords-
     (a.notes+a.plans+a.manualRecords)||a.ticker.localeCompare(b.ticker)).slice(0,30),
   plannedSymbols:latest.size,completeStrategySymbols:complete.length,
   dueAsOfCutoff:due.filter(t=>t.state==="DUE").length,
   checkedAsOf:new Date(ended-1).toISOString(),
   source:"USER_AUTHORED_PROCESS_ONLY"};
}
