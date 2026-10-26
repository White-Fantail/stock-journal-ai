import assert from "node:assert/strict";
import {test} from "node:test";
import {dueInvestmentReviews} from "../lib/review-schedule";
import type {JournalEntry,JournalPlan} from "../lib/saas-trades-api";
const plan=(ticker:string,createdAt:string,cadence:JournalPlan["reviewCadence"])=>({
  ticker,createdAt,reviewCadence:cadence,
}) as JournalPlan;
const review=(ticker:string,createdAt:string)=>({
  ticker,createdAt,kind:"REVIEW",
}) as JournalEntry;
test("calendar month end is clamped and no quote polling is needed",()=>{
 const tasks=dueInvestmentReviews([
  plan("AAA","2026-01-31T09:00:00Z","MONTHLY"),
  plan("BBB","2026-10-20T09:00:00Z","WEEKLY"),
  plan("CCC","2026-10-01T09:00:00Z","EVENT_DRIVEN"),
 ],[],new Date("2026-02-28T09:01:00Z"));
 assert.equal(tasks.length,1);
 assert.equal(tasks[0].ticker,"AAA");
 assert.equal(tasks[0].nextDueAt,"2026-02-28T09:00:00.000Z");
 assert.equal(tasks[0].state,"DUE");
});
test("latest plan, recorded reviews and future timestamps are handled conservatively",()=>{
 const now=new Date("2026-10-27T09:00:00Z");
 const tasks=dueInvestmentReviews([
   plan("TSLA","2026-10-01T00:00:00Z","WEEKLY"),
   plan("TSLA","2026-10-22T00:00:00Z","MONTHLY"),
   plan("RKLB","2026-10-01T00:00:00Z","WEEKLY"),
   plan("FUTURE","2026-12-01T00:00:00Z","MONTHLY"),
 ],[review("TSLA","2026-10-25T00:00:00Z"),
   review("RKLB","2026-10-22T00:00:00Z")],now);
 assert.equal(tasks.length,2);
 const tsla=tasks.find(t=>t.ticker==="TSLA");
 assert.equal(tsla?.state,"UPCOMING");
 assert.equal(tsla?.nextDueAt,"2026-11-25T00:00:00.000Z");
 assert.equal(tasks.find(t=>t.ticker==="RKLB")?.state,"UPCOMING");
});
test("missing cadence and event-only plans never generate timed reminders",()=>{
 const tasks=dueInvestmentReviews([
  plan("A","2026-01-01T00:00:00Z",null),
  plan("B","2026-01-01T00:00:00Z","EVENT_DRIVEN"),
 ],[],new Date("2026-10-27T00:00:00Z"));
 assert.deepEqual(tasks,[]);
});
