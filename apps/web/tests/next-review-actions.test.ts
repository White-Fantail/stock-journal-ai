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
