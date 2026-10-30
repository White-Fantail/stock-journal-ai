import assert from "node:assert/strict";
import {test} from "node:test";
import {summarizeReviewHistory} from "../lib/ai-review-history";
import type {PlanCheckinContext,PlanSelfAssessment} from "../lib/saas-trades-api";
const states:PlanSelfAssessment[]=["FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"];
const make=(count:number,sameDay=false):PlanCheckinContext=>({
 ticker:"TSLA",currentPlan:null,source:"USER_SELF_ASSESSED_ONLY",recentLimit:10,
 recent:Array.from({length:count},(_,i)=>({
   id:"checkin-"+i,planRevisionId:"plan",selfAssessment:states[i%4],
   createdAt:sameDay?"2026-10-20T12:00:00Z":
      new Date(Date.UTC(2026,9,25-i,12)).toISOString(),
   nextAction:"Review thesis "+i,content:"User-authored "+i,
 })),
});
test("bounded owner-written review history preserves chronological evidence and self-report attribution",()=>{
 const result=summarizeReviewHistory(make(10));
 assert.equal(result.items.length,8);
 assert.equal(result.items[0].nextAction,"Review thesis 0");
 assert.ok(result.coverage.includes("최대 8건"));
 assert.deepEqual(result.distribution?.recent,{"FOLLOWED":1,"PARTIAL":1,"DEVIATED":1,"UNCERTAIN":1});
 assert.deepEqual(result.distribution?.previous,{"FOLLOWED":1,"PARTIAL":1,"DEVIATED":1,"UNCERTAIN":1});
});
test("sparse and same-day records never produce an improvement comparison",()=>{
 assert.equal(summarizeReviewHistory(make(7)).distribution,null);
 assert.equal(summarizeReviewHistory(make(8,true)).distribution,null);
 assert.equal(summarizeReviewHistory(make(0)).items.length,0);
});
