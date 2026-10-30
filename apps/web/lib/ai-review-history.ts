/** Bound longitudinal user self-assessment recap. Never claim actual broker
 * compliance, objective performance or execution of a suggested next action.
 * Backend context intentionally exposes only the newest ten check-ins.
 */
import type {PlanCheckinContext,PlanSelfAssessment} from "./saas-trades-api";
export type ReviewHistoryItem=Readonly<{
  id:string;createdAt:string;selfAssessment:PlanSelfAssessment;nextAction:string;
}>;
export type ReviewDistribution=Readonly<{
  recent:Readonly<Record<PlanSelfAssessment,number>>;
  previous:Readonly<Record<PlanSelfAssessment,number>>;
  label:"LATEST_FOUR_VS_PREVIOUS_FOUR_SELF_REPORTS";
}>;
const EMPTY=():Record<PlanSelfAssessment,number>=>({
 FOLLOWED:0,PARTIAL:0,DEVIATED:0,UNCERTAIN:0,
});
export function summarizeReviewHistory(context:PlanCheckinContext):{
  items:ReviewHistoryItem[];distribution:ReviewDistribution|null;coverage:string;
}{
 const items=[...context.recent]
   .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))
   .slice(0,8).map(v=>({id:v.id,createdAt:v.createdAt,
     selfAssessment:v.selfAssessment,nextAction:v.nextAction}));
 let distribution:ReviewDistribution|null=null;
 // Comparisons are for equally sized RECORD COUNTS, NOT equally sized time windows.
 // Require distinct authored days within both groups; otherwise do not compare.
 if(items.length===8){
   const newer=items.slice(0,4),older=items.slice(4,8);
   const days=(a:ReviewHistoryItem[])=>new Set(a.map(x=>x.createdAt.slice(0,10))).size;
   if(days(newer)>=2&&days(older)>=2){
     const recent=EMPTY(),previous=EMPTY();
     for(const item of newer)recent[item.selfAssessment]++;
     for(const item of older)previous[item.selfAssessment]++;
     distribution={recent,previous,label:"LATEST_FOUR_VS_PREVIOUS_FOUR_SELF_REPORTS"};
   }
 }
 return {items,distribution,
   coverage:"선택 종목의 최근 자기평가 최대 8건만 표시하며 오래된 전체 이력 또는 거래 성과를 뜻하지 않습니다."};
}
