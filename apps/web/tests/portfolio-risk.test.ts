import assert from "node:assert/strict";
import {test} from "node:test";
import {assessConcentration} from "../lib/portfolio-risk";
import type {TigerPersonalAccount} from "../lib/tiger-api";
const now=new Date("2026-10-27T00:00:00Z");
function account(positions:{symbol:string;currency:string;quantity:string;marketValue:string|null}[]){
  return {asOf:"2026-10-26T12:00:00Z",partial:false,truncated:false,hasMore:false,
    positions} as TigerPersonalAccount;
}
test("concentration uses only same-account, same-currency Tiger snapshot money",()=>{
 const out=assessConcentration(account([
  {symbol:"A",currency:"USD",quantity:"1",marketValue:"400.000000000001"},
  {symbol:"B",currency:"USD",quantity:"1",marketValue:"250"},
  {symbol:"C",currency:"USD",quantity:"1",marketValue:"350.000000000001"},
 ]),now);
 assert.equal(out.status,"READY");
 if(out.status==="READY"){
   assert.equal(out.largestPercent,"40.00");
   assert.equal(out.topTwoPercent,"75.00");
   assert.equal(out.positions[0].symbol,"A");
 }
});
test("no made-up value when price, currency, count, or timestamp is unreliable",()=>{
 const input=account([{symbol:"A",currency:"USD",quantity:"1",marketValue:null}]);
 assert.equal(assessConcentration(input,now).status,"UNAVAILABLE");
 assert.equal(assessConcentration({...input,positions:[
  {symbol:"A",currency:"USD",quantity:"1",marketValue:"2"},
  {symbol:"B",currency:"NZD",quantity:"1",marketValue:"3"}]},now).status,"UNAVAILABLE");
 assert.equal(assessConcentration({...input,partial:true},now).status,"UNAVAILABLE");
 assert.equal(assessConcentration({...input,asOf:null},now).status,"UNAVAILABLE");
 assert.equal(assessConcentration({...input,asOf:"2026-10-01T00:00:00Z"},now).status,"UNAVAILABLE");
 assert.equal(assessConcentration({...input,asOf:"2026-10-30T00:00:00Z"},now).status,"UNAVAILABLE");
});
test("zero holdings do not affect distribution; invalid or short positions fail closed",()=>{
 const a=account([{symbol:"A",currency:"USD",quantity:"1",marketValue:"100"},
  {symbol:"B",currency:"USD",quantity:"0",marketValue:null}]);
 const out=assessConcentration(a,now);
 assert.equal(out.status,"READY");
 if(out.status==="READY")assert.equal(out.topTwoPercent,"100.00");
 assert.equal(assessConcentration({...a,positions:[{
   symbol:"X",currency:"USD",quantity:"-1",marketValue:"100"}]},now).status,"UNAVAILABLE");
});
