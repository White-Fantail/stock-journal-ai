import assert from "node:assert/strict";
import {test} from "node:test";
import {withAuthoredActionFollowup} from "../lib/coach-evidence";
import type {PlanCheckinContext,ReviewAction} from "../lib/saas-trades-api";
import type {AnalysisEnvelope} from "../lib/ai-analysis";
const ctx:PlanCheckinContext={
 ticker:"TEST",currentPlan:null,recentLimit:10,source:"USER_SELF_ASSESSED_ONLY",
 recent:[{id:"checkin-A",planRevisionId:"plan-A",selfAssessment:"PARTIAL",
   createdAt:"2026-10-10T00:00:00Z",nextAction:"Research the original business thesis",
   content:"My self-review"}],
};
const env:AnalysisEnvelope={mode:"COACHING",symbol:"TEST",asOf:"2026-10-27",
 evidence:[{ref:"R1",kind:"SELF_REVIEW",ticker:"TEST",on:"2026-10-10",
  source:"USER_SELF_ASSESSED_NOT_BROKER_VERIFIED",detail:"User's statement"}],limits:[]};
const followup:ReviewAction={
 checkinId:"checkin-A",ticker:"TEST",nextAction:"Research the original business thesis",
 selfAssessment:"PARTIAL",checkinAt:"2026-10-10T00:00:00Z",state:"DONE",
 note:"Confirmed by writing to finance@example.com with sk-secret123456789",
 resolvedAt:"2026-10-27T00:00:00Z",
};
test("only a matching latest checkin's explicit status is an F1 cited self-report",()=>{
 const result=withAuthoredActionFollowup(env,ctx,[followup],"TEST");
 const f=result.evidence.find(e=>e.ref==="F1");
 assert.equal(f?.kind,"ACTION_FOLLOWUP");
 assert.ok(f?.detail.includes("사용자가 실행했다고 확인"));
 assert.ok(f?.source.includes("NOT_INDEPENDENTLY_VERIFIED"));
 assert.ok(!JSON.stringify(result).includes("finance@example.com"));
 assert.ok(!JSON.stringify(result).includes("sk-secret123456789"));
 assert.ok(!JSON.stringify(result).includes("checkin-A"));
});
test("no checkin follow-up, older checkin, or another ticker is not proof of completion",()=>{
 for(const actions of [[],[{...followup,checkinId:"older"}],[{...followup,ticker:"OTHER"}],[{...followup,state:null}]])
 {
   const result=withAuthoredActionFollowup(env,ctx,actions as ReviewAction[],"TEST");
   assert.ok(!result.evidence.some(e=>e.ref==="F1"));
   assert.ok(result.limits.some(x=>x.includes("Do not assume")));
 }
});
test("scope mismatches and forged states fail closed",()=>{
 assert.throws(()=>withAuthoredActionFollowup(env,ctx,[followup],"WRONG"),/SCOPE_INVALID/);
 assert.throws(()=>withAuthoredActionFollowup(env,ctx,
  [{...followup,state:"BROKER_CONFIRMED" as ReviewAction["state"]}],"TEST"),/ACTION_FOLLOWUP_NOT_VERIFIED/);
});
