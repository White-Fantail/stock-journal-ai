import assert from "node:assert/strict";
import {test} from "node:test";
import {calculatePurchaseScenario,referencePrice,sumObservedShares} from "../lib/purchase-scenario";
const sample={nav:"10000",cash:"4000",heldValue:"2000",heldShares:"5",
 price:"400",buyShares:"3",maxAllocationPct:"30",stop:"380"};
test("cash-funded added shares change exposure but do not inflate NAV",()=>{
 const r=calculatePurchaseScenario(sample);
 assert.equal(r.state,"READY");
 if(r.state!=="READY")return;
 assert.equal(r.purchaseAmount,"1200.00");
 assert.equal(r.beforePercent,"20.00");
 assert.equal(r.afterPercent,"32.00");
 assert.equal(r.capExceeded,true);
 assert.equal(r.maxAdditionalUnderCap,"2");
 assert.deepEqual(r.drawdowns,{ten:"3.20",twenty:"6.40",thirty:"9.60"});
 assert.equal(r.stopImpact,"160.00"); // existing 5x(400-380), new 3x(400-380)
});
test("existing risk uses reference valuation, not historical average cost",()=>{
 const r=calculatePurchaseScenario({...sample,heldValue:"2100",nav:"10100",cash:"4000",stop:"400",price:"420"});
 assert.equal(r.state,"READY");
 if(r.state==="READY"){assert.equal(r.stopImpact,"160.00");assert.equal(r.stopWarning,null);}
});
test("cap comparisons use exact unrounded values",()=>{
 const r=calculatePurchaseScenario({...sample,nav:"10000",heldValue:"2999.999999999999",heldShares:"10",buyShares:"0",cash:"4000"});
 assert.equal(r.state,"READY");
 if(r.state==="READY")assert.equal(r.capExceeded,false);
 const after=calculatePurchaseScenario({...sample,nav:"10000",heldValue:"2999.999999999999",heldShares:"10",buyShares:"0.000000000001",cash:"4000"});
 assert.equal(after.state,"READY");
 if(after.state==="READY")assert.equal(after.capExceeded,true);
});
test("invalid currency-like, leverage, negative, unmatched or stale numbers rejected by caller",()=>{
 for(const change of [{nav:"-1"},{cash:"10001"},{heldValue:"8000"},
   {heldShares:"0"},{price:"NaN"},{buyShares:"-1"},{buyShares:"01"},
   {maxAllocationPct:"101"}]){
  assert.equal(calculatePurchaseScenario({...sample,...change}).state,"INVALID");
 }
 const blocked=calculatePurchaseScenario({...sample,price:"370",stop:"380"});
 assert.equal(blocked.state,"READY");
 if(blocked.state==="READY"){assert.equal(blocked.stopImpact,null);assert.ok(blocked.stopWarning);}
});
test("no stop and no cap keep scenario interpretable without invented limits",()=>{
 const r=calculatePurchaseScenario({...sample,heldValue:"0",heldShares:"0",
  buyShares:"1",cash:"100",maxAllocationPct:null,stop:null});
 assert.equal(r.state,"READY");
 if(r.state==="READY"){assert.equal(r.withinCash,false);assert.equal(r.capExceeded,null);assert.equal(r.stopImpact,null);}
});

test("reference unit price and cross-account quantity remain fixed-point",()=>{
 assert.equal(referencePrice("1260","3"),"420.0000");
 assert.equal(referencePrice("10","0"),null);
 assert.equal(sumObservedShares(["1.25","2.75"]),"4");
 assert.equal(sumObservedShares(["0.000000000001","0.000000000002"]),"0.000000000003");
 assert.equal(sumObservedShares(["1","-2"]),null);
});
