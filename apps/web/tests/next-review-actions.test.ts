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
  nextAction:"Review business risks",selfAssessment:"PARTIAL",checkinAt:"2026-10-26T00:00:00Z",
  state:null,note:null,resolvedAt:null};
 const base={principles:null,principlesAvailable:true,notes:[],plans:[],personal:null};
 const pending=deriveNextReviewActions({...base,followups:[row]});
 assert.ok(pending.some(x=>x.href.includes("/private/review/action/new?checkin=")));
 const done=deriveNextReviewActions({...base,followups:[{...row,state:"DONE"}]});
 assert.ok(!done.some(x=>x.id.startsWith("followup:")));
});
