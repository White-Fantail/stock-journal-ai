import assert from "node:assert/strict";
import {test} from "node:test";
import {assessRiskFactors} from "../lib/risk-factor-exposure";
import type {PortfolioOverviewRisk} from "../lib/portfolio-overview-risk";
import type {RiskFactorRevision} from "../lib/saas-trades-api";
const base:PortfolioOverviewRisk={
 state:"READY",currency:"USD",asOf:"2026-10-27T00:00:00Z",
 accountCount:2,nav:"1000",cash:"100",invested:"900",residual:"0",
 cashPct:"10.00",investedPct:"90.00",largestTickerPct:"50.00",topTwoTickerPct:"80.00",
 basis:"SYNCHRONIZED_TIGER_ACCOUNT_NAV_ONLY",
 completePortfolioVerified:false,accountingVerified:false,
 positions:[
  {ticker:"TSLA",marketValue:"500",observedTigerPct:"50.00",personalMaxAllocationPct:null,aboveObservedTigerReference:null,accounts:2},
  {ticker:"NVDA",marketValue:"300",observedTigerPct:"30.00",personalMaxAllocationPct:null,aboveObservedTigerReference:null,accounts:1},
  {ticker:"RKLB",marketValue:"100",observedTigerPct:"10.00",personalMaxAllocationPct:null,aboveObservedTigerReference:null,accounts:1},
 ],
};
const label=(ticker:string,factors:RiskFactorRevision["factors"]):RiskFactorRevision=>({
 id:"2f425e57-d819-4091-bd30-820171852342",ticker,createdAt:"2026-10-26T00:00:00Z",
 rationale:"User subjectively grouped correlated risks",factors,
});
test("overlapping user factors are NOT added to a fake 100% allocation",()=>{
 const r=assessRiskFactors(base,[
  label("TSLA",["HIGH_GROWTH","AI_INFRA"]),
  label("NVDA",["AI_INFRA","US_TECH"]),label("RKLB",[]),
 ]);
 assert.equal(r.state,"READY");
 if(r.state!=="READY")return;
 assert.equal(r.groupsOverlap,true);
 assert.equal(r.source,"USER_CLASSIFIED_TIGER_SNAPSHOT_ONLY");
 assert.equal(r.groups.find(x=>x.factor==="AI_INFRA")?.observedNavPct,"80.00");
 assert.equal(r.groups.find(x=>x.factor==="HIGH_GROWTH")?.observedNavPct,"50.00");
 assert.equal(r.groups.find(x=>x.factor==="US_TECH")?.observedNavPct,"30.00");
 assert.equal(r.unclassifiedNavPct,"10.00");
 assert.deepEqual(r.unclassifiedTickers,["RKLB"]);
});
test("unknown or missing classification never implies the company lacks risk",()=>{
 const v=assessRiskFactors(base,[]);
 assert.equal(v.state,"READY");
 if(v.state==="READY"){
  assert.equal(v.groups.length,0);
  assert.equal(v.unclassifiedNavPct,"90.00");
 }
 assert.equal(assessRiskFactors(base,null).state,"UNAVAILABLE");
 assert.equal(assessRiskFactors({state:"UNAVAILABLE",reason:"bad",completePortfolioVerified:false},[]).state,"UNAVAILABLE");
 assert.equal(assessRiskFactors(base,[label("TSLA",["AI_INFRA"]),label("TSLA",["US_TECH"])]).state,"UNAVAILABLE");
});
test("manual label API never includes inferred sector market data or broker orders",()=>{
 const data=assessRiskFactors(base,[label("TSLA",["AI_INFRA"])]);
 assert.equal(data.state,"READY");
 assert.ok(!JSON.stringify(data).includes("correlationScore"));
 assert.ok(!JSON.stringify(data).includes("buySignal"));
});
