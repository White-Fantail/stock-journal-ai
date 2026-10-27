import assert from "node:assert/strict";
import {test} from "node:test";
import {calculatePreBuyRisk} from "../lib/risk-budget";
const base={capital:"10000",availableCash:"10000",entry:"420",invalidation:"400",riskPercent:"5"};
test("new purchase respects risk limit and available cash",()=>{
 const r=calculatePreBuyRisk({...base,holdings:[]});
 assert.equal(r.status,"OK");
 if(r.status==="OK"){
  assert.equal(r.maxShares,"23");assert.equal(r.estimatedCapitalUsed,"9660.00");
  assert.equal(r.maximumLoss,"500.00");assert.equal(r.estimatedTotalPlanLoss,"460.00");
 }
});
test("add-on purchase subtracts risk of existing holdings in the same currency",()=>{
 const r=calculatePreBuyRisk({...base,holdings:[{quantity:"10",averageCost:"430"}]});
 assert.equal(r.status,"OK");
 if(r.status==="OK"){
  assert.equal(r.heldPlanLoss,"300.00");assert.equal(r.maxShares,"10");
  assert.equal(r.estimatedTotalPlanLoss,"500.00");assert.equal(r.limitedBy,"RISK");
 }
});
test("existing exposure exhausts risk budget, never gives negative share count",()=>{
 const r=calculatePreBuyRisk({...base,holdings:[{quantity:"20",averageCost:"440"}]});
 assert.equal(r.status,"OK");
 if(r.status==="OK"){
  assert.equal(r.heldPlanLoss,"800.00");assert.equal(r.maxShares,"0");
  assert.equal(r.remainingLossBudget,"0.00");assert.equal(r.limitedBy,"EXISTING");
 }
});
test("separate available cash and risk base, no unverified zero for missing cost",()=>{
 const cash=calculatePreBuyRisk({...base,availableCash:"800",holdings:[]});
 assert.equal(cash.status,"OK");
 if(cash.status==="OK"){assert.equal(cash.maxShares,"1");assert.equal(cash.limitedBy,"CAPITAL");}
 assert.equal(calculatePreBuyRisk({...base,holdings:[{quantity:"10",averageCost:null}]}).status,"INVALID");
 assert.equal(calculatePreBuyRisk({...base,holdings:[{quantity:"-1",averageCost:"420"}]}).status,"INVALID");
 assert.equal(calculatePreBuyRisk({...base,holdings:[{quantity:"0.5",averageCost:"420"}]}).status,"OK");
 assert.equal(calculatePreBuyRisk({...base,invalidation:"440",holdings:[]}).status,"INVALID");
});
