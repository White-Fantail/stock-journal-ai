import assert from "node:assert/strict";
import {test} from "node:test";
import {groupTigerOrderObservations} from "../lib/tiger-order-groups";
import type {TigerPersonalFill,TigerPersonalOrder} from "../lib/tiger-api";

function order(sourceRef:string,filled:string|null):TigerPersonalOrder{
  return {sourceRef,symbol:"RKLB",currency:"USD",side:"BUY",status:"FILLED",
    filled,price:"51.9",fee:null,feeCurrency:null,at:"1792700000000"};
}
function fill(sourceRef:string,quantity:string,orderSourceRef?:string):TigerPersonalFill{
  return {sourceRef,orderSourceRef,symbol:"RKLB",currency:"USD",side:"BUY",
    quantity,price:"51.9",timeRaw:"2026-10-23 14:53:01"};
}
test("one order groups 14+21 partial fills; does not create duplicate trade rows",()=>{
  const result=groupTigerOrderObservations([order("order-1","35")],
    [fill("fill-1","14","order-1"),fill("fill-2","21","order-1")]);
  assert.equal(result.orders.length,1);
  assert.equal(result.orders[0].fills.length,2);
  assert.equal(result.orders[0].reconciliation,"OBSERVED_SUM_MATCH");
  assert.equal(result.unlinked.length,0);
});
test("exact decimal summation never rounds floating quantities",()=>{
  const result=groupTigerOrderObservations([order("o",".3".replace(/^\./,"0."))],
    [fill("f1","0.1","o"),fill("f2","0.2","o")]);
  assert.equal(result.orders[0].reconciliation,"OBSERVED_SUM_MATCH");
});
test("same symbol price and time never merge different orders",()=>{
  const result=groupTigerOrderObservations([order("a","14"),order("b","21")],
    [fill("f1","14","a"),fill("f2","21","b")]);
  assert.deepEqual(result.orders.map(x=>x.fills.length),[1,1]);
  assert.deepEqual(result.orders.map(x=>x.reconciliation),["OBSERVED_SUM_MATCH","OBSERVED_SUM_MATCH"]);
});
test("orphan, legacy, mismatched and duplicate fills are not silently attributed",()=>{
  const items=[
    fill("valid","2","a"),fill("valid","2","a"),
    fill("unknown","1","other"),fill("legacy","1"),
    {...fill("wrong","1","a"),symbol:"TSLA"},
  ];
  const result=groupTigerOrderObservations([order("a","3")],items);
  assert.equal(result.orders[0].fills.length,1);
  assert.equal(result.orders[0].reconciliation,"PARTIAL_OR_DIFFERENT");
  assert.deepEqual(result.unlinked.map(x=>x.sourceRef),["unknown","legacy","wrong"]);
});
test("unobserved executions and unconfirmed order quantity do not imply zero executions",()=>{
  assert.equal(groupTigerOrderObservations([order("a","5")],[]).orders[0].reconciliation,"NOT_OBSERVED");
  assert.equal(groupTigerOrderObservations([order("a",null)],[fill("f","5","a")])
    .orders[0].reconciliation,"QUANTITY_UNKNOWN");
});
