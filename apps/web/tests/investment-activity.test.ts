import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {activityForTicker,planBeforeTrade,type ActivitySources} from "../lib/investment-activity";
import type {JournalEntry,JournalPlan,ManualTradeEvent} from "../lib/saas-trades-api";
import type {TigerPersonalOrder,TigerPersonalFill,VerifiedBrokerExecution} from "../lib/tiger-api";

const plan=(id:string,createdAt:string):JournalPlan=>({
  id,ticker:"ABC",createdAt,rationale:id,targetPrice:"120.00",
  stopPrice:"90.00",priceCurrency:"USD",provenance:"USER_AUTHORED",isBrokerOrder:false,
});
const manual=(id:string,executedAt:string|null):ManualTradeEvent=>({
  id,kind:"EXECUTION",voidsEventId:null,ticker:"ABC",side:"BUY",
  quantity:"2",price:"99.50",currency:"USD",fee:null,
  executedAt,createdAt:"2026-10-03T00:00:00Z",rationale:"my reason",provenance:"USER_ASSERTED",
});
const order=(sourceRef:string):TigerPersonalOrder=>({
  sourceRef,symbol:"ABC",currency:"USD",side:"BUY",status:"FILLED",
  filled:"2",price:"99.50",fee:null,feeCurrency:null,at:"1791000000000",
  orderType:"LMT",orderQuantity:"2",auxPrice:null,limitPrice:"99.50",
  timeInForce:null,outsideRth:null,
});
const fill=(sourceRef:string,orderSourceRef?:string):TigerPersonalFill=>({
  sourceRef,orderSourceRef,symbol:"ABC",currency:"USD",side:"BUY",
  quantity:"2",price:"99.50",timeRaw:"unknown time zone",
});
const note=(id:string,tradeEventId:string|null,kind:JournalEntry["kind"]):JournalEntry=>({
  id,kind,ticker:"ABC",content:id,tradeEventId,createdAt:"2026-10-02T00:00:00Z",
  provenance:"USER_AUTHORED",brokerRef:null,observationRef:null,
});
const verified:VerifiedBrokerExecution={
  sourceRef:"v1",accountId:"acc1",symbol:"ABC",currency:"USD",
  side:"BUY",quantity:"2",price:"99.50",fee:"0.10",
  executedAt:"2026-10-04T00:00:00Z",reviewVersion:3,provenance:"BROKER_VERIFIED",
};
function source(overrides:Partial<ActivitySources>={}):ActivitySources{
  return {
    ticker:"ABC",entries:[],plans:[plan("earlier","2026-10-01T00:00:00Z")],
    trades:[],orders:[],fills:[],verified:[],...overrides,
  };
}

test("single view retains provenance and does not duplicate trade-linked notes",()=>{
  const events=activityForTicker(source({
    trades:[manual("t1","2026-10-03T00:00:00Z")],
    entries:[note("thesis",null,"THESIS"),note("reason","t1","TRADE_NOTE")],
    orders:[order("o1")],fills:[fill("f1","o1"),fill("unlinked")],
    verified:[verified],
  }));
  assert.deepEqual(events.map(e=>e.category).sort(),
    ["PLAN","NOTE","MANUAL","OBSERVED_ORDER","UNLINKED_FILL","VERIFIED"].sort());
  const group=events.find(e=>e.category==="OBSERVED_ORDER");
  assert.equal(group?.category==="OBSERVED_ORDER"&&group.value.fills.length,1);
  const unlinked=events.find(e=>e.category==="UNLINKED_FILL");
  assert.equal(unlinked?.at,null);
  assert.equal(events.at(-1)?.category,"UNLINKED_FILL");
});

test("voided manual trades are hidden without changing other provenance",()=>{
  const transaction=manual("t1","2026-10-03T00:00:00Z");
  const voidEvent:ManualTradeEvent={...transaction,id:"void1",kind:"VOID",voidsEventId:"t1"};
  const events=activityForTicker(source({trades:[transaction,voidEvent],verified:[verified]}));
  assert.ok(!events.some(e=>e.category==="MANUAL"));
  assert.equal(events.filter(e=>e.category==="VERIFIED").length,1);
});

test("plan context never uses a revision made after execution",()=>{
  const earlier=plan("earlier","2026-10-01T00:00:00Z");
  const later=plan("later","2026-10-05T00:00:00Z");
  const rows=activityForTicker(source({
    plans:[earlier,later],trades:[manual("t1","2026-10-03T00:00:00Z")],
  }));
  const execution=rows.find(e=>e.category==="MANUAL")!;
  assert.equal(planBeforeTrade(execution,[earlier,later])?.id,"earlier");
  assert.equal(planBeforeTrade(execution,[later]),null);
  const noTime=activityForTicker(source({trades:[manual("t2",null)]}))
    .find(e=>e.category==="MANUAL")!;
  assert.equal(planBeforeTrade(noTime,[earlier]),null);
});

test("order observation is never labelled with a fabricated execution time",()=>{
  const unknown={...order("o1"),at:"not-a-number"};
  const rows=activityForTicker(source({orders:[unknown],fills:[fill("f1","o1")]}));
  const record=rows.find(e=>e.category==="OBSERVED_ORDER");
  assert.equal(record?.at,null);
  assert.equal(planBeforeTrade(record!,[plan("p","2026-01-01T00:00:00Z")]),null);
});

test("manual trade authoring accepts a ticker suggestion but preserves explicit confirmation",()=>{
  const page=readFileSync(new URL("../app/private/trades/new/page.tsx",import.meta.url),"utf8");
  assert.ok(page.includes("defaultValue={initialTicker}"));
  assert.ok(page.includes('name="confirm"'));
});

test("different ticker cannot borrow plan or trade",()=>{
  const events=activityForTicker(source({ticker:"OTHER",trades:[manual("abc",null)]}));
  assert.deepEqual(events,[]);
});
