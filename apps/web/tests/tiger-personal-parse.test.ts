import assert from "node:assert/strict";
import {test} from "node:test";
import {parsePersonalRead} from "../lib/tiger-personal-parse";

const observedOrder={
  sourceRef:"a".repeat(64),symbol:"RKLB",currency:"USD",side:"BUY",
  status:"FILLED",filled:"3.5",price:"55.01",fee:"0.17",feeCurrency:"USD",
  at:"1793000000000",
};
const position={
  symbol:"RKLB",currency:"USD",quantity:"3.5",
  averageCost:"52.25",marketValue:"192.53",unrealizedPnl:"9.65",
};
function payload(){
  return {
    coverage:"SNAPSHOT_ONLY",verified:false,
    accounts:[{
      alias:"Tiger pilot ••••9999",asOf:"2026-10-26T15:00:00+00:00",
      assets:{netLiquidation:"321.08",cashBalance:"90.10",currency:"USD"},
      positions:[position],orders:[observedOrder],
      marketObservations:[],fillObservations:[],feeObservations:[],
      fillProbeCount:0,fillProbeUnavailable:0,fillProbeDifference:0,
      fillProbePartial:0,fillProbeTruncated:false,
      feeProbeMatched:0,feeProbeCurrencyUnknown:0,feeProbeDifference:0,
      feeProbeUnavailable:0,windowCount:13,totalOrders:471,
      partial:false,truncated:false,hasMore:true,
    }],
  };
}

test("valid broker response is unchanged and does not claim verified executions",()=>{
  const data=parsePersonalRead(payload());
  assert.equal(data.warnings.length,0);
  assert.equal(data.value?.coverage,"SNAPSHOT_ONLY");
  assert.equal(data.value?.verified,false);
  assert.equal(data.value?.accounts[0].orders.length,1);
  assert.equal(data.value?.accounts[0].totalOrders,471);
  assert.equal(data.value?.accounts[0].partial,false);
});
test("malformed optional quote does not hide the actual order and holding",()=>{
  const input=payload();
  (input.accounts[0].marketObservations as unknown[]).push({
    symbol:"RKLB",currency:"USD",price:"92.33",quoteAt:"invalid",
    mode:"US_DELAYED_15M",stale:false,estimatedValue:null,
    estimatedUnrealized:null,estimatedReturnPct:null,
  });
  const parsed=parsePersonalRead(input);
  assert.deepEqual(parsed.warnings,["QUOTES_INVALID"]);
  assert.equal(parsed.value?.accounts[0].orders.length,1);
  assert.equal(parsed.value?.accounts[0].positions.length,1);
  assert.equal(parsed.value?.accounts[0].marketObservations.length,0);
  assert.equal(parsed.value?.accounts[0].partial,true);
  assert.deepEqual(parsed.value?.readWarnings,["QUOTES_INVALID"]);
});
test("invalid observation is omitted without discarding other valid orders",()=>{
  const input=payload();
  (input.accounts[0].orders as unknown[]).push({
    ...observedOrder,sourceRef:"bad",symbol:"NOT-SAFE!!",
  });
  const parsed=parsePersonalRead(input);
  assert.equal(parsed.value?.accounts[0].orders.length,1);
  assert.equal(parsed.value?.accounts[0].orders[0].sourceRef,"a".repeat(64));
  assert.deepEqual(parsed.warnings,["ORDERS_INVALID"]);
  assert.equal(parsed.value?.accounts[0].partial,true);
});
test("malformed fee/fill observations cannot poison the user's valid portfolio",()=>{
  const input=payload();
  (input.accounts[0].feeObservations as unknown[]).push({total:"3.00",currency:"USD"});
  (input.accounts[0].fillObservations as unknown[]).push({timeRaw:"today",symbol:"RKLB"});
  const parsed=parsePersonalRead(input);
  assert.deepEqual(parsed.warnings,["FEES_INVALID","FILLS_INVALID"]);
  assert.equal(parsed.value?.accounts[0].orders.length,1);
  assert.equal(parsed.value?.accounts[0].feeObservations.length,0);
  assert.equal(parsed.value?.accounts[0].fillObservations.length,0);
  assert.equal(parsed.value?.accounts[0].partial,true);
});
test("legacy order with absent fee currency is still displayed without guessing the currency",()=>{
  const input=payload();
  const {feeCurrency:ignored,...legacy}=observedOrder;
  const doc={...input,accounts:[{...input.accounts[0],orders:[legacy]}]};
  const result=parsePersonalRead(doc);
  assert.equal(result.value?.accounts[0].orders.length,1);
  assert.equal(result.value?.accounts[0].orders[0].feeCurrency,null);
  assert.equal(result.value?.accounts[0].partial,true);
  assert.deepEqual(result.warnings,["ORDERS_LEGACY_FEE_CURRENCY"]);
});
test("invalid fee currency still rejects the damaged order",()=>{
  const input=payload();
  const doc={...input,accounts:[{...input.accounts[0],orders:[{...observedOrder,feeCurrency:"INVALID"}]}]};
  const result=parsePersonalRead(doc);
  assert.equal(result.value?.accounts[0].orders.length,0);
  assert.deepEqual(result.warnings,["ORDERS_INVALID"]);
});

test("wrong provenance or account structure cannot enter the private UI",()=>{
  const input=payload();
  assert.equal(parsePersonalRead({...input,verified:true}).value,null);
  assert.equal(parsePersonalRead({...input,coverage:"VERIFIED"}).value,null);
  assert.equal(parsePersonalRead({...input,accounts:[{alias:"unsafe",orders:[]}]}).value,null);
  assert.equal(parsePersonalRead({...input,accounts:[{alias:"unsafe",positions:[]}]}).value,null);
  assert.equal(parsePersonalRead({...input,accounts:new Array(6).fill(input.accounts[0])}).value,null);
});
test("incomplete legacy optional fields are visibly marked incomplete",()=>{
  const input=payload();
  const raw={...input,accounts:[{...input.accounts[0],marketObservations:undefined}]};
  const parsed=parsePersonalRead(raw);
  assert.equal(parsed.value?.accounts[0].orders.length,1);
  assert.equal(parsed.value?.accounts[0].partial,true);
  assert.deepEqual(parsed.warnings,["QUOTES_INVALID"]);
});
