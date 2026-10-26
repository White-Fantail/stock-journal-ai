import assert from "node:assert/strict";
import {test} from "node:test";
import {buildMonthlyProcessReport,currentNzMonth,monthWindow,stepMonth} from "../lib/monthly-process";
import type {JournalEntry,JournalPlan,ManualTradeEvent} from "../lib/saas-trades-api";
const now=new Date("2026-10-27T08:00:00Z");
const note=(ticker:string,kind:JournalEntry["kind"],createdAt:string)=>({
 ticker,kind,createdAt,content:"Synthetic only",
}) as JournalEntry;
const plan=(ticker:string,createdAt:string,extra={})=>({
 ticker,createdAt,...extra,
}) as JournalPlan;
const trade=(ticker:string,kind:ManualTradeEvent["kind"],createdAt:string)=>({
 ticker,kind,createdAt,
}) as ManualTradeEvent;

test("calendar uses Christchurch NZ boundaries and DST, not UTC months",()=>{
 assert.equal(monthWindow("2026-10")?.start,Date.parse("2026-09-30T11:00:00Z"));
 assert.equal(monthWindow("2026-09")?.start,Date.parse("2026-08-31T12:00:00Z"));
 assert.equal(monthWindow("2029-04")?.start,Date.parse("2029-03-31T11:00:00Z"));
 assert.equal(monthWindow("2029-05")?.start,Date.parse("2029-04-30T12:00:00Z"));
 assert.equal(currentNzMonth(new Date("2026-09-30T12:00:00Z")),"2026-10");
 assert.equal(stepMonth("2026-12",1),"2027-01");
 assert.equal(stepMonth("2027-01",-1),"2026-12");
 assert.equal(monthWindow("2026-99"),null);
 assert.equal(monthWindow("2026-2"),null);
});
test("process totals use authored UTC timestamps interpreted in NZ calendar month",()=>{
 const report=buildMonthlyProcessReport("2026-10",[
  note("TSLA","THESIS","2026-09-30T11:15:00Z"),
  note("TSLA","REVIEW","2026-10-20T01:00:00Z"),
  note("RKLB","REVIEW","2026-09-30T10:59:00Z"),
 ],[plan("TSLA","2026-10-15T00:00:00Z",{strategyType:"LONG_TERM",
  investmentHorizon:"OVER_THREE_YEARS",invalidationCondition:"Thesis changed",
  reviewCadence:"MONTHLY",maxAllocationPct:"20"})],[
  trade("TSLA","EXECUTION","2026-10-20T02:00:00Z"),
  trade("RKLB","VOID","2026-10-21T02:00:00Z"),
 ],now);
 assert.equal(report?.noteCount,2);
 assert.equal(report?.reviewCount,1);
 assert.equal(report?.planRevisionCount,1);
 assert.equal(report?.userTradeRecordCount,1);
 assert.equal(report?.voidCount,1);
 assert.equal(report?.uniqueSymbols,2);
 assert.equal(report?.plannedSymbols,1);
 assert.equal(report?.completeStrategySymbols,1);
 assert.equal(report?.source,"USER_AUTHORED_PROCESS_ONLY");
});
test("future, invalid and capped histories never pretend to be complete",()=>{
 assert.equal(buildMonthlyProcessReport("2026-12",[],[],[],now),null);
 assert.equal(buildMonthlyProcessReport("not-a-month",[],[],[],now),null);
 assert.equal(buildMonthlyProcessReport("2026-10",
  Array.from({length:200},()=>note("X","REVIEW","2026-10-01T00:00:00Z")),[],[],now),null);
});
