/** A descriptive UX guide based solely on owner-authored revisions.
 * Does not certify compliance, broker executions or completeness of investment history.
 */
import type {JournalEntry,JournalPlan} from "./saas-trades-api";
import {dueInvestmentReviews} from "./review-schedule";
export type DecisionGuide=Readonly<{
  plan:"MISSING"|"EXISTS";thesis:"MISSING"|"EXISTS";
  review:"NOT_STARTED"|"RECORDED";
  nextReview:string|null;due:boolean;reviewDate:string|null;
  cadenceKnown:boolean;coverageIncomplete:boolean;
}>;
export function decisionGuide(ticker:string,plans:readonly JournalPlan[],
 entries:readonly JournalEntry[],now=new Date()):DecisionGuide{
 const current=[...plans].filter(p=>p.ticker===ticker)
   .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0]??null;
 const own=entries.filter(e=>e.ticker===ticker);
 const thesis=own.some(e=>e.kind==="THESIS"&&e.content.trim().length>0);
 const review=own.filter(e=>e.kind==="REVIEW").sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null;
 // The authored feed is bounded. Never present a date as definitive if the
 // collection might be truncated. Events do not automatically prove rule compliance.
 const coverageIncomplete=plans.length>=200||entries.length>=200;
 const cadenceKnown=!!current?.reviewCadence;
 const task=current&&!coverageIncomplete?dueInvestmentReviews(plans,entries,now)
   .find(r=>r.ticker===ticker):null;
 return {plan:current?"EXISTS":"MISSING",thesis:thesis?"EXISTS":"MISSING",
  review:review?"RECORDED":"NOT_STARTED",reviewDate:review?.createdAt??null,
  nextReview:task?.nextDueAt??null,due:task?.state==="DUE",
  cadenceKnown,coverageIncomplete};
}
