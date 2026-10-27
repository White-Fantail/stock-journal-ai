/** Safe NZ-calendar reporting windows. Completed intervals only; no snapshot
 * or unsourced broker cashflow is promoted to period return evidence.
 */
import {currentNzMonth,monthWindow,stepMonth} from "./monthly-process";

export type PerformanceInterval=Readonly<{
 key:string;label:string;kind:"MONTH"|"QUARTER"|"YEAR";
 start:string;end:string;currency:"UNSPECIFIED";status:"EVIDENCE_INCOMPLETE";
}>;
const fmt=(y:number,m:number)=>y+"-"+String(m).padStart(2,"0");
const make=(key:string,label:string,kind:PerformanceInterval["kind"],
 startMonth:string,endMonth:string):PerformanceInterval|null=>{
 const a=monthWindow(startMonth),b=monthWindow(endMonth);
 if(!a||!b||a.start>=b.start)return null;
 return {key,label,kind,start:new Date(a.start).toISOString(),
   end:new Date(b.start).toISOString(),currency:"UNSPECIFIED",
   status:"EVIDENCE_INCOMPLETE"};
};
export function completedPerformanceIntervals(now=new Date()):readonly PerformanceInterval[]{
 const current=currentNzMonth(now);
 const [year,month]=current.split("-").map(Number);
 const result:PerformanceInterval[]=[];
 let cursor=stepMonth(current,-1);
 for(let i=0;i<12&&cursor;i++){
   const next=stepMonth(cursor,1);
   if(!next)break;
   const item=make("M:"+cursor,cursor,"MONTH",cursor,next);
   if(item)result.push(item);
   cursor=stepMonth(cursor,-1);
 }
 // Current quarter is not complete, even if the current month has started.
 const currentQuarterStart=Math.floor((month-1)/3)*3+1;
 let qYear=year,qMonth=currentQuarterStart;
 for(let i=0;i<4;i++){
   qMonth-=3;
   if(qMonth<1){qMonth+=12;qYear--;}
   const endMonth=qMonth+3>12?fmt(qYear+1,qMonth-9):fmt(qYear,qMonth+3);
   const item=make("Q:"+qYear+"-"+Math.floor((qMonth-1)/3+1),
     qYear+"년 "+Math.floor((qMonth-1)/3+1)+"분기","QUARTER",
     fmt(qYear,qMonth),endMonth);
   if(item)result.push(item);
 }
 for(let offset=1;offset<=3;offset++){
   const y=year-offset;
   const item=make("Y:"+y,y+"년","YEAR",fmt(y,1),fmt(y+1,1));
   if(item)result.push(item);
 }
 return result;
}
export function selectPerformanceInterval(
 intervals:readonly PerformanceInterval[],key:unknown,
):PerformanceInterval|null{
 return intervals.find(interval=>interval.key===key)??intervals[0]??null;
}
