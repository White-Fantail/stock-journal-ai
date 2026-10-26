import assert from "node:assert/strict";
import {test} from "node:test";
import {calculateLongRisk} from "../lib/risk-budget";
test("exact decimal arithmetic enforces risk budget and available cash",()=>{
 assert.deepEqual(calculateLongRisk({capital:"20000",entry:"100",invalidation:"90",riskPercent:"0.5"}),{
  status:"OK",maximumLoss:"100.00",maxShares:"10",estimatedCapitalUsed:"1000.00",
  estimatedPlanLoss:"100.00",limitedBy:"RISK"});
 const x=calculateLongRisk({capital:"1000",entry:"100",invalidation:"99.99",riskPercent:"1"});
 assert.equal(x.status,"OK");
 if(x.status==="OK"){assert.equal(x.maxShares,"10");assert.equal(x.limitedBy,"CAPITAL");}
});
test("invalid, negative, tiny-budget or leveraged inputs do not promise orders",()=>{
 for(const entry of ["-20","0","NaN","1e6","01","1.0000000000001"]){
  assert.equal(calculateLongRisk({capital:"100",entry,invalidation:"0",riskPercent:"1"}).status,"INVALID");
 }
 assert.equal(calculateLongRisk({capital:"100",entry:"100",invalidation:"110",riskPercent:"1"}).status,"INVALID");
 assert.equal(calculateLongRisk({capital:"100",entry:"100",invalidation:"90",riskPercent:"200"}).status,"INVALID");
 const tiny=calculateLongRisk({capital:"100",entry:"95",invalidation:"1",riskPercent:"0.1"});
 assert.equal(tiny.status,"OK");
 if(tiny.status==="OK")assert.equal(tiny.maxShares,"0");
});
