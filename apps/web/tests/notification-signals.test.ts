import assert from "node:assert/strict";
import {test} from "node:test";
import {compareAmounts,derivePersonalAlerts} from "../lib/notification-signals";
import type {TigerPersonalHealth,TigerPersonalRead} from "../lib/tiger-api";
import type {JournalPlan} from "../lib/saas-trades-api";
const now=new Date("2026-10-27T00:00:00Z");
const iso=(mins:number)=>new Date(now.getTime()-mins*60000).toISOString();
const stamp=(mins:number)=>String(now.getTime()-mins*60000);
const plan=(target:string|null,stop:string|null,currency="USD")=>({
  ticker:"TSLA",targetPrice:target,stopPrice:stop,priceCurrency:currency,
  createdAt:iso(100),rationale:"My plan"
}) as JournalPlan;
const health=(assets:"OK"|"FAILED"="OK",mins=5):TigerPersonalHealth=>({
  source:"PERSONAL_SYNC_HEALTH",coverageVerified:false,
  accounts:[{alias:"Tiger pilot",lastAssetsAt:iso(mins),latest:{
    alias:"Tiger pilot",latestRunAt:iso(5),assets,orders:"OK",fills:"OK"}}],
});
const personal=(quoteAge=20,currency="USD"):TigerPersonalRead=>({
  coverage:"SNAPSHOT_ONLY",verified:false,accounts:[{
    alias:"Tiger pilot",asOf:iso(5),
    positions:[{symbol:"TSLA",currency:"USD",quantity:"1",averageCost:null,
       marketValue:null,unrealizedPnl:null}],
    marketObservations:[{symbol:"TSLA",currency:"USD",price:"210.125",quoteAt:stamp(quoteAge),
       mode:"US_DELAYED_15M",stale:false,estimatedValue:null,
       estimatedUnrealized:null,estimatedReturnPct:null}],
  }] as TigerPersonalRead["accounts"],
});
test("exact decimal price threshold avoids IEEE-754 money comparison",()=>{
  assert.equal(compareAmounts("210.125000000001","210.125"),1);
  assert.equal(compareAmounts("210.125","210.125000000001"),-1);
  assert.equal(compareAmounts("0001","1"),undefined);
});
test("only recent same-currency owned ticker prices trigger target/stop hints",()=>{
  const sig=derivePersonalAlerts(personal(),health(),[plan("210.125","190")],now);
  assert.equal(sig.filter(x=>x.kind==="PRICE_TARGET").length,1);
  assert.equal(sig.filter(x=>x.kind==="PRICE_STOP").length,0);
  assert.equal(derivePersonalAlerts(personal(50),health(),[plan("210","190")],now)
    .filter(x=>x.kind==="PRICE_TARGET").length,0);
  assert.equal(derivePersonalAlerts(personal(),health(),[plan("210","190","NZD")],now)
    .filter(x=>x.kind==="PRICE_TARGET").length,0);
});
test("failure and stale schedule are not confused with a verified portfolio",()=>{
  const signal=derivePersonalAlerts(null,health("FAILED",2300),[],now);
  assert.ok(signal.some(x=>x.kind==="SYNC_FAILED"));
  assert.ok(signal.some(x=>x.kind==="SYNC_DELAYED"));
  assert.equal(derivePersonalAlerts(null,null,[],now)[0].kind,"SYNC_UNREPORTED");
});
