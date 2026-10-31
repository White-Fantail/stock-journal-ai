import assert from "node:assert/strict";
import {test} from "node:test";
import {deriveNextReviewActions} from "../lib/next-review-actions";
test("unavailable records cannot be shown as a clean bill of investment health",()=>{
  const actions=deriveNextReviewActions({principles:null,principlesAvailable:false,notes:null,plans:null,personal:null});
  assert.ok(actions.some(x=>x.id==="notes-unavailable"));
  assert.ok(actions.some(x=>x.id==="principles-unavailable"));
});
test("a broker-free user can create their own investment principles and plan",()=>{
  const actions=deriveNextReviewActions({principles:null,principlesAvailable:true,notes:[],plans:[],personal:null});
  assert.equal(actions[0].href,"/private/getting-started");
  assert.ok(actions.some(x=>x.href==="/private/journal/new?mode=plan"));
});
test("no actual quote threshold or buy/sell execution exists in the task queue",()=>{
  const source=deriveNextReviewActions.toString();
  assert.ok(!source.includes("BUY_NOW"));
  assert.ok(!source.includes("priceAlert"));
});

test("unfinished self-reported next actions appear on home, completed ones do not",()=>{
 const row={checkinId:"00000000-0000-4000-8000-000000000001",ticker:"QATEST",
  nextAction:"Review business risks",selfAssessment:"PARTIAL" as const,checkinAt:"2026-10-26T00:00:00Z",
  state:null,note:null,resolvedAt:null};
 const base={principles:null,principlesAvailable:true,notes:[],plans:[],personal:null};
 const pending=deriveNextReviewActions({...base,followups:[row]});
 assert.ok(pending.some(x=>x.href.includes("/private/review/action/new?checkin=")));
 const done=deriveNextReviewActions({...base,followups:[{...row,state:"DONE"}]});
 assert.ok(!done.some(x=>x.id.startsWith("followup:")));
});

test("oldest unfinished authored follow-up is addressed first",()=>{
 const base={principles:null,principlesAvailable:true,notes:[],plans:[],personal:null};
 const row={checkinId:"00000000-0000-4000-8000-000000000001",ticker:"OLD",
  nextAction:"Review old risk",selfAssessment:"PARTIAL" as const,
  checkinAt:"2026-09-01T00:00:00Z",state:null,note:null,resolvedAt:null};
 const newer={...row,checkinId:"00000000-0000-4000-8000-000000000002",
  ticker:"NEW",checkinAt:"2026-10-01T00:00:00Z"};
 const actions=deriveNextReviewActions({...base,followups:[newer,row]});
 assert.ok(actions.some(a=>a.id==="followup:"+row.checkinId));
 assert.ok(!actions.some(a=>a.id==="followup:"+newer.checkinId));
});
test("incomplete data still appears alongside actual next steps",()=>{
 const row={checkinId:"00000000-0000-4000-8000-000000000001",ticker:"TEST",
  nextAction:"Check thesis",selfAssessment:"PARTIAL" as const,
  checkinAt:"2026-10-01T00:00:00Z",state:null,note:null,resolvedAt:null};
 const actions=deriveNextReviewActions({principles:null,principlesAvailable:false,
   notes:null,plans:null,personal:null,followups:[row]});
 assert.ok(actions.some(a=>a.id.startsWith("followup:")));
 assert.ok(actions.some(a=>a.id.endsWith("-unavailable")));
 assert.ok(actions.length<=3);
});

import type {TigerPersonalRead} from "../lib/tiger-api";
import type {JournalPlan} from "../lib/saas-trades-api";

const NOW=new Date("2026-10-27T00:00:00Z");
const holdings=(asOf:string|null="2026-10-26T12:00:00Z",readWarnings:string[]=[]):TigerPersonalRead=>({
 coverage:"SNAPSHOT_ONLY",verified:false,readWarnings,
 accounts:[{
  alias:"synthetic",asOf,assets:{currency:"USD",netLiquidation:"1000",cashBalance:"500"},
  positions:[{symbol:"TSLA",currency:"USD",quantity:"1",marketValue:"500",averageCost:null,unrealizedPnl:null}],
  orders:[],marketObservations:[],fillObservations:[],feeObservations:[],
  fillProbeCount:0,fillProbeUnavailable:0,fillProbeDifference:0,fillProbePartial:0,
  fillProbeTruncated:false,feeProbeMatched:0,feeProbeCurrencyUnknown:0,
  feeProbeDifference:0,feeProbeUnavailable:0,windowCount:0,partial:false,
  truncated:false,hasMore:false,totalOrders:0,
 }]
});
const nextBase={principles:null,principlesAvailable:true,notes:[],plans:[],now:NOW};

test("home and portfolio share the conservative holdings readiness gate",()=>{
 const fresh=deriveNextReviewActions({...nextBase,personal:holdings()});
 assert.ok(fresh.some(a=>a.id==="plan:TSLA"));
 const badSnapshots=[
   holdings("2026-10-01T00:00:00Z"),
   holdings(null),
   holdings("2026-11-01T00:00:00Z"),
   holdings(undefined,["POSITIONS_INVALID"]),
   holdings(undefined,["UNKNOWN_SOURCE_ERROR"]),
   {...holdings(),accounts:[holdings().accounts[0],holdings().accounts[0]]},
   {...holdings(),accounts:[{...holdings().accounts[0],
     positions:[{...holdings().accounts[0].positions[0],quantity:"-1"}]}]},
 ];
 for(const personal of badSnapshots){
  const actions=deriveNextReviewActions({...nextBase,personal});
  assert.ok(actions.some(a=>a.id==="holdings-unavailable"));
  assert.ok(!actions.some(a=>a.id==="plan:TSLA"||a.id==="exposure:TSLA"));
 }
});

test("unrelated order/quote read warnings do not suppress an actual holdings task",()=>{
 const actions=deriveNextReviewActions({...nextBase,
  personal:holdings(undefined,["ORDERS_INVALID","QUOTES_INVALID"])});
 assert.ok(actions.some(a=>a.id==="plan:TSLA"));
 assert.ok(!actions.some(a=>a.id==="holdings-unavailable"));
});

test("home may compare a user's maximum allocation but never asserts trade compliance",()=>{
 const plan={
  id:"authored",ticker:"TSLA",createdAt:"2026-10-25T00:00:00Z",
  rationale:"Own research",maxAllocationPct:"30",invalidationCondition:"Thesis failed",
  reviewCadence:"EVENT_DRIVEN",
 } as JournalPlan;
 const actions=deriveNextReviewActions({...nextBase,plans:[plan],personal:holdings()});
 const comparison=actions.find(a=>a.id==="exposure:TSLA");
 assert.ok(comparison);
 assert.match(comparison!.detail,/Tiger/);
 assert.match(comparison!.detail,/매도 신호는 아닙니다/);
 assert.ok(!actions.some(a=>a.id==="plan:TSLA"));
});
