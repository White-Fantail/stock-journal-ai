import assert from "node:assert/strict";
import {test} from "node:test";
import {assessAccountPolicyReference} from "../lib/allocation-policy";
import type {TigerPersonalAccount} from "../lib/tiger-api";
import type {JournalPlan} from "../lib/saas-trades-api";

const now=new Date("2026-10-27T00:00:00Z");
const account=(positions: {symbol:string;quantity:string;currency:string;marketValue:string|null}[],
 nav="1000",currency="USD")=>({
 asOf:"2026-10-26T12:00:00Z",assets:{netLiquidation:nav,currency,cashBalance:"100"},
 positions,
}) as TigerPersonalAccount;
const pos=(symbol:string,marketValue:string)=>({
 symbol,quantity:"1",currency:"USD",marketValue,
 averageCost:null,unrealizedPnl:null,
});
const plan=(ticker:string,maxAllocationPct:string|null,createdAt="2026-10-26T00:00:00Z")=>({
 ticker,maxAllocationPct,createdAt,
}) as JournalPlan;

test("NAV-denominated account comparison is distinct from invested-stock share",()=>{
 const result=assessAccountPolicyReference(account([pos("TSLA","200"),pos("RKLB","300")]),
   [plan("TSLA","15.00"),plan("RKLB","35")],now);
 assert.equal(result.state,"READY");
 if(result.state==="READY"){
   assert.equal(result.denominator,"ACCOUNT_NAV");
   assert.equal(result.assessment,"ACCOUNT_COMPARISON_NOT_PORTFOLIO_COMPLIANCE");
   assert.equal(result.positions[0].ticker,"RKLB");
   assert.equal(result.positions[0].observedAccountPct,"30.00");
   assert.equal(result.positions[0].exceedsAccountReference,false);
   assert.equal(result.positions[1].observedAccountPct,"20.00");
   assert.equal(result.positions[1].exceedsAccountReference,true);
 }
});

test("amounts exactly at the personal limit do not count as above reference",()=>{
 const result=assessAccountPolicyReference(account([pos("X","200")]),
   [plan("X","20.00")],now);
 assert.equal(result.state,"READY");
 if(result.state==="READY")assert.equal(result.positions[0].exceedsAccountReference,false);
});

test("unknown or mixed currencies, missing NAV, leverage and partial plan history fail closed",()=>{
 const a=account([pos("X","500")]);
 for(const x of [
  {...a,assets:null},
  {...a,assets:{currency:null,netLiquidation:"1000",cashBalance:"500"}},
  {...a,assets:{currency:"NZD",netLiquidation:"1000",cashBalance:"500"}},
  {...a,assets:{currency:"USD",netLiquidation:null,cashBalance:"500"}},
  {...a,assets:{currency:"USD",netLiquidation:"400",cashBalance:"0"}},
  {...a,asOf:"2026-10-01T00:00:00Z"},
  {...a,positions:[{...pos("X","-100")}]},
  {...a,positions:[{...pos("X","500"),currency:"NZD"}]},
 ])assert.equal(assessAccountPolicyReference(x,[plan("X","20")],now).state,"UNAVAILABLE");
 assert.equal(assessAccountPolicyReference(a,null,now).state,"UNAVAILABLE");
 assert.equal(assessAccountPolicyReference(a,Array.from({length:200},
  (_,i)=>plan("X"+i,"10")),now).state,"UNAVAILABLE");
});

test("only the latest authored policy is used; missing policy remains unknown",()=>{
 const result=assessAccountPolicyReference(account([pos("X","200"),pos("Y","100")]),
   [plan("X","50","2026-10-01T00:00:00Z"),
    plan("X","10","2026-10-25T00:00:00Z")],now);
 assert.equal(result.state,"READY");
 if(result.state==="READY"){
  assert.equal(result.positions.find(x=>x.ticker==="X")?.personalPortfolioLimitPct,"10");
  assert.equal(result.positions.find(x=>x.ticker==="X")?.exceedsAccountReference,true);
  assert.equal(result.positions.find(x=>x.ticker==="Y")?.exceedsAccountReference,null);
 }
});
