import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {test} from "node:test";
import {portfolioReviewActions,portfolioReviewQueue} from "../lib/portfolio-review-actions";
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
test("holding-related read warnings suppress confident missing-plan and factor claims",()=>{
 for(const personal of [data(["POSITIONS_INVALID"]),data(["ASSETS_INVALID"]),
                        data(["UNKNOWN_SOURCE_ERROR"])]){
  const actions=portfolioReviewActions({personal,plans:[],factors:[]});
  assert.equal(actions.length,1);
  assert.equal(actions[0].id,"partial");
 }
});
test("order pagination and unrelated parser warnings do not hide holdings follow-ups",()=>{
 for(const personal of [data([],true),data(["ORDERS_INVALID","QUOTES_INVALID"],true)]){
   const actions=portfolioReviewActions({personal,plans:[],factors:[]});
   assert.ok(actions.some(a=>a.id==="plan:TSLA"));
   assert.ok(actions.some(a=>a.id==="factor:TSLA"));
   assert.ok(!actions.some(a=>a.id==="partial"));
 }
});
test("failed authoring fetch is not interpreted as missing records",()=>{
 const actions=portfolioReviewActions({personal:data(),plans:null,factors:null});
 assert.ok(actions.some(a=>a.id==="plan-unavailable"));
 assert.ok(actions.some(a=>a.id==="factor-unavailable"));
 assert.ok(!actions.some(a=>a.id.startsWith("plan:")||a.id.startsWith("factor:")));
});

const plan=(ticker:string,options:{
  invalidationCondition?:string|null;reviewCadence?:string|null;
  maxAllocationPct?:string|null;createdAt?:string;id?:string
}={})=>({
 id:options.id??"plan-1",ticker,createdAt:options.createdAt??"2026-10-26T00:00:00Z",
 targetPrice:null,stopPrice:null,priceCurrency:null,rationale:"Long-term growth thesis",
 provenance:"USER_AUTHORED" as const,isBrokerOrder:false as const,
 invalidationCondition:options.invalidationCondition??null,
 reviewCadence:options.reviewCadence??null,maxAllocationPct:options.maxAllocationPct??null,
});
const position=(symbol:string,marketValue:string)=>({
 symbol,currency:"USD",quantity:"1",averageCost:null,marketValue,unrealizedPnl:null,
});

test("investor queue puts the author's over-limit reference first, without inventing compliance",()=>{
 const personal={...data(),accounts:[{...data().accounts[0],
  assets:{currency:"USD",netLiquidation:"1000",cashBalance:"100"},
  positions:[position("TSLA","700"),position("RKLB","200")],
 }]};
 const q=portfolioReviewQueue({personal,plans:[
   plan("TSLA",{invalidationCondition:"FSD commercialization thesis fails",
     reviewCadence:"EVENT_DRIVEN",maxAllocationPct:"60"}),
   plan("RKLB",{invalidationCondition:"Launch economics deteriorate",
     reviewCadence:"MONTHLY",maxAllocationPct:"30"}),
 ] as never,factors:[{ticker:"TSLA",factors:["AI_INFRA"]}] as never});
 assert.equal(q.comparisonReady,true);
 assert.equal(q.holdingCount,2);
 assert.equal(q.plannedCount,2);
 assert.equal(q.classifiedCount,1);
 assert.equal(q.actions[0].id,"cap:TSLA");
 assert.equal(q.actions[0].priority,"FIRST");
 assert.equal(q.actions[0].observedTigerPct,"70.00");
 assert.equal(q.actions[0].personalMaxAllocationPct,"60");
 assert.equal(q.actions[0].href,"/private/journal/new?mode=plan&ticker=TSLA");
 assert.ok(q.actions.some(a=>a.id==="factor:RKLB"));
 assert.ok(!q.actions.some(a=>a.id==="condition:RKLB"));
 assert.ok(!q.actions.some(a=>a.id==="cadence:TSLA"));
 assert.ok(!q.actions.some(a=>/손절가 필수|매도 필요/.test(a.title+a.description)));
});

test("latest user plan revision wins, optional stop/target gaps never create nags",()=>{
 const plans=[plan("TSLA",{id:"old",createdAt:"2026-01-01T00:00:00Z",
   invalidationCondition:null,reviewCadence:null}),
   plan("TSLA",{id:"new",createdAt:"2026-10-26T00:00:00Z",
     invalidationCondition:"Reassess if original thesis fails",reviewCadence:"EVENT_DRIVEN"})];
 const q=portfolioReviewQueue({personal:data(),plans:plans as never,
   factors:[{ticker:"TSLA",factors:["AI_INFRA"]}] as never});
 assert.equal(q.plannedCount,1);
 assert.equal(q.classifiedCount,1);
 assert.equal(q.actions.length,0);
});

test("missing plans and review conditions take priority over optional classifications",()=>{
 const personal={...data(),accounts:[{...data().accounts[0],
   assets:{currency:"USD",netLiquidation:"1000",cashBalance:"100"},
   positions:[position("RKLB","200"),position("TSLA","700")],
 }]};
 const q=portfolioReviewQueue({personal,plans:[],
   factors:[]});
 assert.deepEqual(q.actions.filter(a=>a.kind==="PLAN").map(a=>a.id),
   ["plan:TSLA","plan:RKLB"]);
 assert.ok(q.actions.findIndex(a=>a.id==="factor:TSLA")>
   q.actions.findIndex(a=>a.id==="plan:RKLB"));
 const existing=portfolioReviewQueue({personal,plans:[
   plan("TSLA",{invalidationCondition:null,reviewCadence:null}),
   plan("RKLB",{invalidationCondition:"Business assumption changes",reviewCadence:"EVENT_DRIVEN"}),
 ] as never,factors:[]});
 assert.ok(existing.actions.some(a=>a.id==="condition:TSLA"));
 assert.ok(existing.actions.some(a=>a.id==="cadence:TSLA"));
 assert.ok(!existing.actions.some(a=>a.id==="condition:RKLB"||a.id==="cadence:RKLB"));
});

test("unknown source scope never invents missing plans or classifications",()=>{
 const q=portfolioReviewQueue({personal:data(),plans:null,factors:null});
 assert.equal(q.plannedCount,null);
 assert.equal(q.classifiedCount,null);
 assert.equal(q.comparisonReady,false);
 assert.deepEqual(q.actions.map(a=>a.id),["plan-unavailable","factor-unavailable"]);
 const blocked=portfolioReviewQueue({personal:data(["POSITIONS_INVALID"]),
   plans:[],factors:[]});
 assert.equal(blocked.actions.length,1);
 assert.equal(blocked.actions[0].id,"partial");
 assert.equal(blocked.plannedCount,null);
 const orderOnly=portfolioReviewQueue({personal:data(["ORDERS_INVALID"],true),
   plans:[],factors:[]});
 assert.ok(orderOnly.actions.some(a=>a.id==="plan:TSLA"));
});

test("all held symbols remain reachable and suggestions are deterministic",()=>{
 const personal={...data(),accounts:[{...data().accounts[0],
   assets:{currency:"USD",netLiquidation:"1000",cashBalance:"0"},
   positions:Array.from({length:10},(_,i)=>position("T"+String(i), "100")),
 }]};
 const q=portfolioReviewQueue({personal,plans:[],factors:[]});
 assert.equal(q.holdingCount,10);
 assert.equal(q.actions.filter(a=>a.kind==="PLAN").length,10);
 assert.equal(q.actions.filter(a=>a.kind==="FACTOR").length,10);
 const second=portfolioReviewQueue({personal,plans:[],factors:[]});
 assert.deepEqual(q.actions.map(a=>a.id),second.actions.map(a=>a.id));
});

test("portfolio surfaces investment-plan and risk follow-ups without an extra disclosure click",()=>{
 const page=readFileSync(new URL("../app/private/portfolio/page.tsx",import.meta.url),"utf8");
 assert.match(page,/<PortfolioAttention personal=\{personal\} plans=\{plans\} factors=\{userFactors\}\s*\/>/);
 assert.doesNotMatch(page,/<summary>투자계획·위험 분류 보완 제안 보기<\/summary>/);
 assert.match(page,/<summary>비중·공통 위험 분석 보기<\/summary>/);
});

test("stale or undated holdings cannot create false missing-plan or risk labels",()=>{
 for(const asOf of ["2025-01-01T00:00:00Z",null,"invalid"]){
   const personal={...data(),accounts:[{...data().accounts[0],asOf}]};
   const q=portfolioReviewQueue({personal,plans:[],factors:[]});
   assert.deepEqual(q.actions.map(a=>a.id),["holdings-stale"]);
   assert.equal(q.plannedCount,null);
   assert.equal(q.classifiedCount,null);
   assert.equal(q.comparisonReady,false);
 }
});
