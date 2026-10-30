import assert from "node:assert/strict";
import {test} from "node:test";
import {parsePersonalRead} from "../lib/tiger-personal-parse";
import {orderTypeLabel,orderStatusLabel,orderTerms,executionPriceIsKnown,feeIsKnown} from "../lib/tiger-order-display";
const base={
 sourceRef:"a".repeat(64),symbol:"META",currency:"USD",side:"SELL",
 status:"SUBMITTED",filled:"0",price:"0",fee:"0",feeCurrency:null,
 at:"1793400000000",orderType:"STP",orderQuantity:"3",auxPrice:"609",
 limitPrice:null,timeInForce:"GTC",outsideRth:false,
};
function parse(input:unknown){
 return parsePersonalRead({coverage:"SNAPSHOT_ONLY",verified:false,
 accounts:[{alias:"Tiger",asOf:null,assets:null,positions:[],orders:[input],
 marketObservations:[],fillObservations:[],feeObservations:[],
 fillProbeCount:0,fillProbeUnavailable:0,fillProbeDifference:0,
 fillProbePartial:0,fillProbeTruncated:false,feeProbeMatched:0,feeProbeCurrencyUnknown:0,
 feeProbeDifference:0,feeProbeUnavailable:0,windowCount:1,
 totalOrders:1,partial:false,truncated:false,hasMore:false}]});
}
test("submitted META stop has trigger but no execution price or fee",()=>{
 const result=parse(base);
 assert.deepEqual(result.warnings,[]);
 const order=result.value!.accounts[0].orders[0];
 assert.equal(orderTypeLabel(order.orderType),"스탑");
 assert.equal(orderStatusLabel(order.status),"접수 · 체결 대기");
 assert.equal(executionPriceIsKnown(order),false);
 assert.equal(feeIsKnown(order),false);
 assert.deepEqual(orderTerms(order),["주문 3주","스탑 발동가 609 USD",
   "유효기간 GTC","정규장 외 거래 미허용"]);
});
test("trailing auxiliary amount is NOT displayed as stop trigger",()=>{
 const order=parse({...base,orderType:"TRAIL",auxPrice:"1.25"}).value!.accounts[0].orders[0];
 assert.ok(orderTerms(order).includes("추적 가격차 1.25 USD"));
 assert.ok(!orderTerms(order).some(v=>v.includes("스탑 발동가")));
});
test("legacy order type unknown is explicit; never guess an STP",()=>{
 const {orderType,orderQuantity,auxPrice,limitPrice,timeInForce,outsideRth,...old}=base;
 const result=parse(old);
 assert.equal(result.value!.accounts[0].orders[0].orderType,null);
 assert.equal(orderTypeLabel(result.value!.accounts[0].orders[0].orderType),"유형 미확인");
});
test("reject injected order type and out of-range trigger without poisoning portfolio",()=>{
 for(const malformed of [{orderType:"PLACE"},{auxPrice:"-609"},
                         {outsideRth:"maybe"}]){
   const result=parse({...base,...malformed});
   assert.equal(result.value?.accounts[0].orders.length,0);
   assert.deepEqual(result.warnings,["ORDERS_INVALID"]);
 }
});
