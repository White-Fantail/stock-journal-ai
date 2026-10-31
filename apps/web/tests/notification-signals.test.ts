import assert from "node:assert/strict";
import {test} from "node:test";
import {compareAmounts,derivePersonalAlerts} from "../lib/notification-signals";
import type {TigerPersonalHealth,TigerPersonalRead} from "../lib/tiger-api";
import type {JournalPlan} from "../lib/saas-trades-api";
const now=new Date("2026-10-27T00:00:00Z");
const iso=(mins:number)=>new Date(now.getTime()-mins*60000).toISOString();
const stamp=(mins:number)=>String(now.getTime()-mins*60000);
const plan=(ticker="TSLA")=>({ticker,targetPrice:"200",stopPrice:"180",priceCurrency:"USD",
  createdAt:iso(100),rationale:"Investor plan"}) as JournalPlan;
const health=(assets:"OK"|"FAILED"="OK",mins=5):TigerPersonalHealth=>({
  source:"PERSONAL_SYNC_HEALTH",coverageVerified:false,
  accounts:[{alias:"Tiger pilot",lastAssetsAt:iso(mins),latest:{
    alias:"Tiger pilot",latestRunAt:iso(5),assets,orders:"OK",fills:"OK"}}],
});
const personal=(quoteAge=20,partial=false):TigerPersonalRead=>({
  coverage:"SNAPSHOT_ONLY",verified:false,accounts:[{
    alias:"Tiger pilot",asOf:iso(5),partial,truncated:false,hasMore:false,
    positions:[{symbol:"TSLA",currency:"USD",quantity:"1",averageCost:null,
       marketValue:null,unrealizedPnl:null}],
    marketObservations:[{symbol:"TSLA",currency:"USD",price:"210.125",quoteAt:stamp(quoteAge),
       mode:"US_DELAYED_15M",stale:false,estimatedValue:null,
       estimatedUnrealized:null,estimatedReturnPct:null}],
  }] as TigerPersonalRead["accounts"],
});
test("money comparison is exact and not a signal engine",()=>{
  assert.equal(compareAmounts("210.125000000001","210.125"),1);
  assert.throws(()=>compareAmounts("0001","1"),/INVALID_DECIMAL/);
});
test("price crossing NEVER emits a trade or price alert",()=>{
  const signals=derivePersonalAlerts(personal(),health(),[plan()],now);
  assert.equal(signals.filter(x=>x.kind==="PLAN_INCOMPLETE").length,1);
  assert.ok(signals.every(x=>!x.kind.startsWith("PRICE_")));
  assert.equal(derivePersonalAlerts(personal(1),health(),[plan()],now).filter(x=>x.kind==="PLAN_INCOMPLETE").length,1);
  assert.equal(derivePersonalAlerts(personal(1),health(),null,now)
    .filter(x=>x.kind==="PLAN_MISSING").length,0);
});
test("only held symbols with a fresh snapshot and no plan receive a review suggestion",()=>{
  const signals=derivePersonalAlerts(personal(),health(),[],now);
  assert.equal(signals.filter(x=>x.kind==="PLAN_MISSING").length,1);
  assert.equal(derivePersonalAlerts(personal(),health(),[plan()],now)
    .filter(x=>x.kind==="PLAN_MISSING").length,0);
  const old=personal();
  const stale={...old,accounts:old.accounts.map(a=>({...a,asOf:iso(12*24*60)}))};
  assert.equal(derivePersonalAlerts(stale,health(),[],now)
    .filter(x=>x.kind==="PLAN_MISSING").length,0);
});
test("fully authored strategy removes incomplete check without prices",()=>{
  const complete={...plan(),strategyType:"LONG_TERM",investmentHorizon:"OVER_THREE_YEARS",
    invalidationCondition:"Change in business thesis",maxAllocationPct:"15.00",
    reviewCadence:"QUARTERLY"} as JournalPlan;
  const notices=derivePersonalAlerts(personal(),health(),[complete],now);
  assert.equal(notices.filter(x=>x.kind==="PLAN_INCOMPLETE").length,0);
  assert.equal(notices.filter(x=>x.kind==="PLAN_MISSING").length,0);
  assert.ok(notices.every(x=>!x.kind.startsWith("PRICE_")));
});
test("failure, stale schedule, and partial orders never certify brokerage returns",()=>{
  const alerts=derivePersonalAlerts(personal(10,true),health("FAILED",2300),[],now);
  assert.ok(alerts.some(x=>x.kind==="SYNC_FAILED"));
  assert.ok(alerts.some(x=>x.kind==="SYNC_DELAYED"));
  assert.ok(alerts.some(x=>x.kind==="HISTORY_PARTIAL"));
  assert.equal(derivePersonalAlerts(null,null,[],now)[0].kind,"SYNC_UNREPORTED");
});

test("check centre and portfolio suppress missing-plan claims on ambiguous scope",()=>{
 const base=personal();
 for(const accounts of [[],[base.accounts[0],base.accounts[0]]]){
   const snapshot={...base,accounts};
   const alerts=derivePersonalAlerts(snapshot,health(),[],now);
   assert.equal(alerts.some(a=>a.kind==="PLAN_MISSING"||a.kind==="PLAN_INCOMPLETE"),false);
   assert.ok(alerts.some(a=>a.id==="holdings-check"));
 }
});
test("a future or stale Tiger snapshot does not generate missing-plan claims",()=>{
 for(const asOf of [new Date(now.getTime()+60000).toISOString(),iso(8*24*60)]){
   const source=personal();
   const snapshot={...source,accounts:source.accounts.map(a=>({...a,asOf}))};
   const alerts=derivePersonalAlerts(snapshot,health(),[],now);
   assert.equal(alerts.some(a=>a.kind==="PLAN_MISSING"),false);
   assert.ok(alerts.some(a=>a.id==="holdings-check"));
 }
});
