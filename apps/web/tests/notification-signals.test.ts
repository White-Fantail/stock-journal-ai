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
  assert.equal(signals.length,0);
  assert.ok(signals.every(x=>!x.kind.startsWith("PRICE_")));
  assert.equal(derivePersonalAlerts(personal(1),health(),[plan()],now).length,0);
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
test("failure, stale schedule, and partial orders never certify brokerage returns",()=>{
  const alerts=derivePersonalAlerts(personal(10,true),health("FAILED",2300),[],now);
  assert.ok(alerts.some(x=>x.kind==="SYNC_FAILED"));
  assert.ok(alerts.some(x=>x.kind==="SYNC_DELAYED"));
  assert.ok(alerts.some(x=>x.kind==="HISTORY_PARTIAL"));
  assert.equal(derivePersonalAlerts(null,null,[],now)[0].kind,"SYNC_UNREPORTED");
});
