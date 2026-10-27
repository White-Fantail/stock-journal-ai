/** NZ Monday-based ISO weeks; never infer a completed current week. */
const NZ="Pacific/Auckland";
const parts=(now:Date)=>{
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:NZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const get=(key:string)=>Number(p.find(x=>x.type===key)?.value);
  return {year:get("year"),month:get("month"),day:get("day")};
};
const isoKey=(date:Date)=>{
 const thursday=new Date(date.getTime());
 thursday.setUTCDate(thursday.getUTCDate()+4-(thursday.getUTCDay()||7));
 const y=thursday.getUTCFullYear();
 const jan=new Date(Date.UTC(y,0,1));
 const week=Math.ceil(((thursday.getTime()-jan.getTime())/86400000+1)/7);
 return y+"-W"+String(week).padStart(2,"0");
};
export function nzRecentWeeks(now=new Date(),count=12):readonly string[]{
 if(!Number.isFinite(now.getTime())||count<1||count>16)throw new Error("WEEK_RANGE_INVALID");
 const p=parts(now);
 const local=new Date(Date.UTC(p.year,p.month-1,p.day,12));
 return Array.from({length:count},(_,i)=>{
   const d=new Date(local.getTime());d.setUTCDate(d.getUTCDate()-7*i);
   return isoKey(d);
 });
}
export function selectRecentWeek(weeks:readonly string[],input:unknown){
 return typeof input==="string"&&weeks.includes(input)?input:weeks[0]??null;
}
