import assert from "node:assert/strict";
import {test} from "node:test";
import {journalLastRecordedAt,orderJournalSymbols} from "../lib/journal-symbol-order";
import type {JournalEntry,JournalPlan} from "../lib/saas-trades-api";

function note(ticker:string,createdAt:string,linked=false):JournalEntry{
 return {id:ticker+createdAt,kind:linked?"TRADE_NOTE":"THESIS",ticker,content:"User-authored",
  createdAt,tradeEventId:null,provenance:"USER_AUTHORED",brokerRef:null,
  observationRef:linked?{accountId:"private",sourceRef:"a".repeat(64),
    kind:"ORDER",status:"OBSERVED_NOT_VERIFIED"}:null};
}
function plan(ticker:string,createdAt:string):JournalPlan{
 return {ticker,createdAt,id:ticker+"-plan"} as JournalPlan;
}
test("investment journal sorts latest saved note and plan, even above holdings",()=>{
 const entries=[note("RKLB","2026-10-27T18:00:00Z"),
                note("META","2026-10-30T20:15:00Z"),
                note("GOOGL","2026-10-29T09:00:00Z")];
 const plans=[plan("TSLA","2026-10-31T06:00:00Z"),plan("RKLB","2026-10-29T12:00:00Z")];
 const symbols=["TSLA","RKLB","META","GOOGL","APP","NVDA"];
 const result=orderJournalSymbols(symbols,entries,plans,["APP","RKLB"]);
 assert.deepEqual(result,["TSLA","META","RKLB","GOOGL","APP","NVDA"]);
 assert.deepEqual(symbols,["TSLA","RKLB","META","GOOGL","APP","NVDA"],"must not mutate inputs");
 assert.equal(journalLastRecordedAt("RKLB",entries,plans),Date.parse("2026-10-29T12:00:00Z"));
});
test("a newer trade-linked reason or broker sync never changes the investment journal order",()=>{
 const entries=[note("RKLB","2026-10-29T00:00:00Z"),
                note("META","2026-10-28T00:00:00Z"),
                note("META","2026-10-31T22:00:00Z",true)];
 assert.deepEqual(orderJournalSymbols(["META","RKLB","APP"],entries,[],[]),
   ["RKLB","META","APP"]);
 assert.equal(journalLastRecordedAt("META",entries,[]),Date.parse("2026-10-28T00:00:00Z"));
 assert.deepEqual(orderJournalSymbols(["APP","META"],[entries[2]],[],["APP"]),["APP","META"]);
});
test("timestamps compare as instants, tie-break deterministically; no-record holdings precede observed-only",()=>{
 const entries=[note("B","2026-10-30T10:00:00+13:00"),
                note("A","2026-10-29T21:00:00Z"),
                note("C","not-a-date")];
 assert.deepEqual(orderJournalSymbols(["C","B","A","D","E","B"],entries,[],["E","C"]),
   ["A","B","C","E","D"]);
 assert.equal(journalLastRecordedAt("C",entries,[]),null);
 assert.deepEqual(orderJournalSymbols(["C","B","A"],[],[],[]),["A","B","C"]);
});
