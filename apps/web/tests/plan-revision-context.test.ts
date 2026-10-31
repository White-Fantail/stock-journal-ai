import assert from "node:assert/strict";
import {test} from "node:test";
import {planAtAuthoredTime} from "../lib/plan-revision-context";
import type {JournalPlan} from "../lib/saas-trades-api";
const plan=(id:string,ticker:string,createdAt:string)=>({
 id,ticker,createdAt,rationale:id,targetPrice:null,stopPrice:null,priceCurrency:null,
 provenance:"USER_AUTHORED",isBrokerOrder:false,
}) as JournalPlan;
test("trade note context uses the latest plan written no later than the note",()=>{
 const plans=[
   plan("old","TSLA","2026-01-01T00:00:00Z"),
   plan("later","TSLA","2026-05-02T00:00:00Z"),
   plan("future","TSLA","2026-08-01T00:00:00Z"),
   plan("other","RKLB","2026-04-01T00:00:00Z"),
 ];
 assert.equal(planAtAuthoredTime(plans,"TSLA","2026-05-03T00:00:00Z")?.id,"later");
 assert.equal(planAtAuthoredTime(plans,"TSLA","2026-02-01T00:00:00Z")?.id,"old");
 assert.equal(planAtAuthoredTime(plans,"TSLA","2025-01-01T00:00:00Z"),null);
 assert.equal(planAtAuthoredTime(plans,"RKLB","2026-05-03T00:00:00Z")?.id,"other");
});
test("unavailable or invalid timestamps never invent a historical plan",()=>{
 const plans=[plan("old","TSLA","2026-01-01T00:00:00Z")];
 assert.equal(planAtAuthoredTime(null,"TSLA","2026-04-01T00:00:00Z"),null);
 assert.equal(planAtAuthoredTime(plans,"TSLA","invalid"),null);
 assert.equal(planAtAuthoredTime([plan("bad","TSLA","invalid")],"TSLA","2026-04-01T00:00:00Z"),null);
});
