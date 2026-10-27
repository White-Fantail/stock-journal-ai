import assert from "node:assert/strict";
import {test} from "node:test";
import {decisionGuide} from "../lib/journal-decision-guide";
import type {JournalEntry,JournalPlan} from "../lib/saas-trades-api";

const plan=(ticker:string,reviewCadence:"MONTHLY"|"EVENT_DRIVEN"|"ANNUAL"):JournalPlan=>({
 id:"00000000-0000-4000-8000-000000000001",ticker,createdAt:"2026-09-01T00:00:00Z",
 targetPrice:null,stopPrice:null,priceCurrency:null,rationale:"Synthetic decision",
 strategyType:null,investmentHorizon:null,invalidationCondition:null,
 maxAllocationPct:null,reviewCadence,provenance:"USER_AUTHORED",isBrokerOrder:false
});
test("plan prompts are distinct from a broker-verified trade or investment advice",()=>{
 const d=decisionGuide("TEST",[],[],new Date("2026-10-27T00:00:00Z"));
 assert.equal(d.plan,"MISSING");assert.equal(d.thesis,"MISSING");
 assert.equal(d.nextReview,null);assert.equal(d.due,false);
});
test("due date comes from a user-selected periodic review, not a quote trigger",()=>{
 const d=decisionGuide("TEST",[plan("TEST","MONTHLY")],[],new Date("2026-10-27T00:00:00Z"));
 assert.equal(d.plan,"EXISTS");assert.equal(d.due,true);assert.ok(d.nextReview);
 const event=decisionGuide("TEST",[plan("TEST","EVENT_DRIVEN")],[],new Date("2026-10-27T00:00:00Z"));
 assert.equal(event.nextReview,null);assert.equal(event.due,false);
});
test("capped journal feed must not produce a definitive review due date",()=>{
 const notes=Array.from({length:200},(_,i)=>({
  id:String(i),ticker:"OTHER",kind:"THESIS",content:"synthetic",createdAt:"2026-09-01T00:00:00Z"
 })) as JournalEntry[];
 const d=decisionGuide("TEST",[plan("TEST","MONTHLY")],notes,new Date("2026-10-27T00:00:00Z"));
 assert.equal(d.coverageIncomplete,true);assert.equal(d.nextReview,null);
});

test("plan rationale counts as an investment thesis without duplicate notes",()=>{
 const d=decisionGuide("TEST",[plan("TEST","MONTHLY")],[],new Date("2026-10-27T00:00:00Z"));
 assert.equal(d.plan,"EXISTS");assert.equal(d.thesis,"EXISTS");
});
