import assert from "node:assert/strict";
import {test} from "node:test";
import {assessPortfolioOverviewRisk} from "../lib/portfolio-overview-risk";
import type {TigerPersonalRead,TigerPersonalAccount} from "../lib/tiger-api";
import type {JournalPlan} from "../lib/saas-trades-api";

const NOW=new Date("2026-10-27T00:00:00Z");
const position=(symbol:string,marketValue:string|null,currency="USD")=>({
 symbol,quantity:"1",currency,marketValue,averageCost:null,unrealizedPnl:null,
});
const account=(alias:string,cash:string,nav:string,
  positions:ReturnType<typeof position>[],currency="USD",
  asOf="2026-10-26T12:00:00Z")=>({
 alias,assets:{currency,cashBalance:cash,netLiquidation:nav},asOf,positions,
 orders:[],marketObservations:[],fillObservations:[],feeObservations:[],
 fillProbeCount:0,fillProbeUnavailable:0,fillProbeDifference:0,
 fillProbePartial:0,fillProbeTruncated:false,feeProbeMatched:0,
 feeProbeCurrencyUnknown:0,feeProbeDifference:0,feeProbeUnavailable:0,
 windowCount:0,partial:false,truncated:false,hasMore:false,totalOrders:0,
}) satisfies TigerPersonalAccount;
const read=(accounts:TigerPersonalAccount[],readWarnings?:readonly string[])=>({
 coverage:"SNAPSHOT_ONLY",verified:false,accounts,
 ...(readWarnings?{readWarnings}:{}),
}) satisfies TigerPersonalRead;
const plan=(ticker:string,maxAllocationPct:string|null,createdAt="2026-10-25T00:00:00Z")=>({
 ticker,maxAllocationPct,createdAt,id:"a",rationale:"self",targetPrice:null,
 stopPrice:null,priceCurrency:null,provenance:"USER_AUTHORED",isBrokerOrder:false,
}) as JournalPlan;

test("cross-account NAV includes cash and correctly aggregates same ticker to fixed-point precision",()=>{
 const result=assessPortfolioOverviewRisk(read([
   account("1","300","1000",[position("TSLA","400"),position("RKLB","300")]),
   account("2","100","1000",[position("TSLA","300"),position("NVDA","600")]),
 ]),[plan("TSLA","34.99"),plan("RKLB","15"),plan("NVDA",null)],NOW);
 assert.equal(result.state,"READY");
 if(result.state!=="READY")return;
 assert.equal(result.completePortfolioVerified,false);
 assert.equal(result.accountingVerified,false);
 assert.equal(result.basis,"SYNCHRONIZED_TIGER_ACCOUNT_NAV_ONLY");
 assert.equal(result.accountCount,2);
 assert.equal(result.currency,"USD");
 assert.equal(result.nav,"2000");
 assert.equal(result.cash,"400");
 assert.equal(result.invested,"1600");
 assert.equal(result.cashPct,"20.00");
 assert.equal(result.investedPct,"80.00");
 assert.equal(result.largestTickerPct,"35.00");
 assert.equal(result.topTwoTickerPct,"65.00");
 assert.deepEqual(result.positions.map(x=>[x.ticker,x.marketValue,x.observedTigerPct,x.accounts]),
   [["TSLA","700","35.00",2],["NVDA","600","30.00",1],["RKLB","300","15.00",1]]);
 assert.equal(result.positions[0].aboveObservedTigerReference,true);
 assert.equal(result.positions[1].aboveObservedTigerReference,null);
 assert.equal(result.positions[2].aboveObservedTigerReference,false);
});

test("one-account, cash-only and sub-cent values work without floats",()=>{
 const r=assessPortfolioOverviewRisk(read([
   account("savings","100.000000000001","100.000000000001",[]),
 ]),[],NOW);
 assert.equal(r.state,"READY");
 if(r.state==="READY"){
   assert.equal(r.nav,"100.000000000001");
   assert.equal(r.invested,"0");
   assert.equal(r.cashPct,"100.00");
   assert.equal(r.largestTickerPct,"0.00");
   assert.equal(r.positions.length,0);
 }
 const exact=assessPortfolioOverviewRisk(read([
   account("1","500","1000",[position("TSLA","500")]),
 ]),[plan("TSLA","50.00")],NOW);
 assert.equal(exact.state,"READY");
 if(exact.state==="READY")assert.equal(exact.positions[0].aboveObservedTigerReference,false);
});

test("mixed currency, account-time drift and duplicate aliases cannot produce combined portfolio",()=>{
 const first=account("owner","300","1000",[position("TSLA","700")]);
 const cases=[
   [first,account("NZ","300","1000",[position("TSLA","700","NZD")],"NZD")],
   [first,account("other","300","1000",[position("TSLA","700")],"USD","2026-10-26T10:30:00Z")],
   [first,account("owner","300","1000",[position("RKLB","700")])],
   [first,account("other","300","1000",[position("TSLA","700","EUR")])],
   [first,account("other","300","1000",[position("TSLA",null)])],
 ];
 for(const accounts of cases){
   const result=assessPortfolioOverviewRisk(read(accounts),[],NOW);
   assert.equal(result.state,"UNAVAILABLE");
   assert.equal(result.completePortfolioVerified,false);
 }
});

test("missing funds, stale snapshot, incomplete source and unaccounted risk fail closed",()=>{
 const good=account("1","300","1000",[position("TSLA","700")]);
 const cases:TigerPersonalRead[]=[
   read([]),
   read([good],["POSITIONS_INVALID"]),
   read([{...good,asOf:null}]),
   read([{...good,asOf:"2026-10-10T00:00:00Z"}]),
   read([{...good,asOf:"2026-10-28T00:00:00Z"}]),
   read([{...good,assets:null}]),
   read([{...good,assets:{...good.assets,cashBalance:null}}]),
   read([{...good,assets:{...good.assets,netLiquidation:null}}]),
   read([{...good,assets:{...good.assets,cashBalance:"-100"}}]),
   read([{...good,assets:{...good.assets,netLiquidation:"900"}}]),
   read([{...good,assets:{...good.assets,netLiquidation:"1100"}}]),
   read([{...good,positions:[{...position("TSLA","700"),quantity:"-1"}]}]),
   read([{...good,positions:[{...position("TSLA","100"),quantity:"0"}]}]),
 ];
 for(const source of cases){
   const v=assessPortfolioOverviewRisk(source,[],NOW);
   assert.equal(v.state,"UNAVAILABLE");
 }
 assert.equal(assessPortfolioOverviewRisk(null,[],NOW).state,"UNAVAILABLE");
 assert.equal(assessPortfolioOverviewRisk(read([good]),null,NOW).state,"UNAVAILABLE");
 assert.equal(assessPortfolioOverviewRisk(read([good]),
   Array.from({length:200},()=>plan("TSLA","10")),NOW).state,"UNAVAILABLE");
});

test("latest revision wins, exact threshold beats rounded display, and no-plan stays unknown",()=>{
 const v=assessPortfolioOverviewRisk(read([
   account("1","649.99","1000",[position("TSLA","350.01")]),
 ]),[plan("TSLA","75","2026-10-01T00:00:00Z"),
   plan("TSLA","35.00","2026-10-26T00:00:00Z")],NOW);
 assert.equal(v.state,"READY");
 if(v.state==="READY"){
   assert.equal(v.positions[0].observedTigerPct,"35.00");
   assert.equal(v.positions[0].aboveObservedTigerReference,true);
 }
});
