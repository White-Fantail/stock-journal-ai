/** User-authored periodic investment review schedule; computed on page view only.
 * No market data, push jobs, persisted timers, orders, or invented reviews.
 */
import type {JournalEntry,JournalPlan,ReviewCadence} from "./saas-trades-api";

export type ReviewTask=Readonly<{
  ticker:string;cadence:Exclude<ReviewCadence,"EVENT_DRIVEN">;
  lastActivityAt:string;nextDueAt:string;state:"DUE"|"UPCOMING";
}>;
const MILLIS_PER_WEEK=7*24*60*60*1000;
function nextDate(start:Date,cadence:ReviewTask["cadence"]):Date{
  if(cadence==="WEEKLY")return new Date(start.getTime()+MILLIS_PER_WEEK);
  const months=({MONTHLY:1,QUARTERLY:3,SEMIANNUAL:6,ANNUAL:12} as const)[cadence];
  const year=start.getUTCFullYear(),month=start.getUTCMonth()+months;
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return new Date(Date.UTC(year,month,Math.min(start.getUTCDate(),last),
    start.getUTCHours(),start.getUTCMinutes(),start.getUTCSeconds()));
}
export function dueInvestmentReviews(
  plans:readonly JournalPlan[],entries:readonly JournalEntry[],
  now=new Date(),
):ReviewTask[]{
  const nowMs=now.getTime();
  if(!Number.isFinite(nowMs))return [];
  const latest=new Map<string,JournalPlan>();
  for(const item of [...plans].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
    if(!latest.has(item.ticker))latest.set(item.ticker,item);
  }
  const reviews=new Map<string,number>();
  for(const item of entries){
    if(item.kind!=="REVIEW")continue;
    const at=Date.parse(item.createdAt);
    if(!Number.isFinite(at)||at>nowMs)continue;
    reviews.set(item.ticker,Math.max(reviews.get(item.ticker)??0,at));
  }
  const tasks:ReviewTask[]=[];
  for(const plan of latest.values()){
    const cadence=plan.reviewCadence;
    if(!cadence||cadence==="EVENT_DRIVEN")continue;
    const createdAt=Date.parse(plan.createdAt);
    if(!Number.isFinite(createdAt)||createdAt>nowMs)continue;
    const lastAt=Math.max(createdAt,reviews.get(plan.ticker)??0);
    const next=nextDate(new Date(lastAt),cadence);
    tasks.push({ticker:plan.ticker,cadence,lastActivityAt:new Date(lastAt).toISOString(),
      nextDueAt:next.toISOString(),state:next.getTime()<=nowMs?"DUE":"UPCOMING"});
  }
  return tasks.sort((a,b)=>(a.state==="DUE"?0:1)-(b.state==="DUE"?0:1)||
    a.nextDueAt.localeCompare(b.nextDueAt)||a.ticker.localeCompare(b.ticker)).slice(0,25);
}
