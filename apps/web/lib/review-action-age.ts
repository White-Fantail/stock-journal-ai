/** Presentation-only grouping. An old action is never silently completed. */
export function isOlderReviewAction(checkinAt:string,now=new Date(),days=90):boolean{
 const timestamp=Date.parse(checkinAt);
 const current=now.getTime();
 return Number.isFinite(timestamp)&&Number.isFinite(current)&&
   timestamp<=current&&current-timestamp>days*86400000;
}
