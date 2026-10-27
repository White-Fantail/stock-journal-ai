import assert from "node:assert/strict";
import {test} from "node:test";
import {portfolioReviewActions} from "../lib/portfolio-review-actions";
import type {TigerPersonalRead} from "../lib/tiger-api";

const data=(warnings:string[]=[],partial=false):TigerPersonalRead=>({
 coverage:"SNAPSHOT_ONLY",verified:false,readWarnings:warnings,
 accounts:[{alias:"Synthetic",asOf:"2026-10-27T00:00:00Z",
 assets:{currency:"USD",netLiquidation:"1000",cashBalance:"500"},
 positions:[{symbol:"TSLA",currency:"USD",quantity:"1",averageCost:null,marketValue:"500",unrealizedPnl:null}],
 marketObservations:[],orders:[],fillObservations:[],feeObservations:[],
 fillProbeCount:0,fillProbeUnavailable:0,fillProbeDifference:0,fillProbePartial:0,
 fillProbeTruncated:false,feeProbeMatched:0,feeProbeCurrencyUnknown:0,
 feeProbeDifference:0,feeProbeUnavailable:0,windowCount:0,partial,
 truncated:false,hasMore:false,totalOrders:0}]
});
test("unverified observation can prompt plan, never a verified exposure claim",()=>{
 const actions=portfolioReviewActions({personal:data(),plans:[],factors:[]});
 assert.ok(actions.some(a=>a.id==="plan:TSLA"&&a.href==="/private/journal/new?mode=plan&ticker=TSLA"));
 assert.ok(actions.some(a=>a.id==="factor:TSLA"));
 assert.equal(actions.some(a=>/매수|매도|자동 매매/.test(a.title)),false);
});
test("partial readings suppress confident missing-plan and factor claims",()=>{
 for(const personal of [data(["malformed provider entry"]),data([],true)]){
  const actions=portfolioReviewActions({personal,plans:[],factors:[]});
  assert.equal(actions.length,1);
  assert.equal(actions[0].id,"partial");
 }
});
test("failed authoring fetch is not interpreted as missing records",()=>{
 const actions=portfolioReviewActions({personal:data(),plans:null,factors:null});
 assert.ok(actions.some(a=>a.id==="plan-unavailable"));
 assert.ok(actions.some(a=>a.id==="factor-unavailable"));
 assert.ok(!actions.some(a=>a.id.startsWith("plan:")||a.id.startsWith("factor:")));
});
