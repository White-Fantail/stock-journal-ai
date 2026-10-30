import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {evidenceForAnalysis,parseAiResult,aiRequestBody,sanitizedExcerpt} from "../lib/ai-analysis";
import type {JournalEntry,JournalPlan,ManualTradeEvent} from "../lib/saas-trades-api";
import type {TigerPersonalOrder} from "../lib/tiger-api";
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");

const entries=[{kind:"THESIS",ticker:"TSLA",content:"I believe in FSD but I missed a stop rule.",
  createdAt:"2026-10-20T10:01:00Z",id:"sensitive-journal-id"}] as JournalEntry[];
const plans=[{ticker:"TSLA",targetPrice:"210.50",stopPrice:null,
  rationale:"My entry strategy",createdAt:"2026-10-19T10:01:00Z"}] as JournalPlan[];
const events=[{id:"sensitive-event-id",kind:"EXECUTION",ticker:"TSLA",side:"BUY",
  rationale:"Bought because of thesis",createdAt:"2026-10-18T10:01:00Z",
  executedAt:"2026-10-18T10:01:00Z",quantity:"40",price:"200",fee:"1.50"}] as ManualTradeEvent[];
const orders=[{symbol:"TSLA",status:"FILLED",side:"BUY",
  at:"1792700000000",sourceRef:"z".repeat(64),
  filled:"1.25",price:"200.12",fee:"1.00"}] as TigerPersonalOrder[];

test("only consent-selected bounded evidence leaves application, no IDs or monetary fields",()=>{
  const raw=evidenceForAnalysis("STOCK_REVIEW","TSLA",entries,plans,events,orders,new Date("2026-10-27T00:00:00Z"));
  assert.equal(raw.evidence.length,4);
  assert.deepEqual(raw.evidence.map(e=>e.ref),["N1","P1","M1","O1"]);
  const payload=JSON.stringify(raw);
  for(const forbidden of ["sensitive-journal-id","sensitive-event-id","200.12","210.50",
    '"quantity"','"price"','"fee"','"accountId"','"sourceRef"']){
    assert.ok(!payload.includes(forbidden),forbidden);
  }
  assert.ok(payload.includes("USER_ASSERTED_NOT_BROKER_VERIFIED"));
  assert.ok(payload.includes("UNVERIFIED_BROKER_ORDER_NOT_FILL"));
  assert.ok(payload.includes("손절가 기록: 없음"));
});

test("opt-in AI sees policy completeness but not numeric allocation amounts",()=>{
  const strategic=[{...plans[0],strategyType:"LONG_TERM",
    investmentHorizon:"OVER_THREE_YEARS",
    invalidationCondition:"Business thesis fails",
    maxAllocationPct:"17.25",reviewCadence:"QUARTERLY"}] as JournalPlan[];
  const e=evidenceForAnalysis("STOCK_REVIEW","TSLA",entries,strategic,events,orders);
  const plan=e.evidence.find(x=>x.kind==="PLAN");
  assert.ok(plan?.detail.includes("LONG_TERM"));
  assert.ok(plan?.detail.includes("Business thesis fails"));
  assert.ok(plan?.detail.includes("QUARTERLY"));
  assert.ok(plan?.detail.includes("위험 비중 한도: 설정"));
  assert.ok(!JSON.stringify(e).includes("17.25"));
  assert.ok(!JSON.stringify(e).includes('"maxAllocationPct"'));
});
test("source material is untrusted and hallucinated evidence IDs fail closed",()=>{
  const envelope=evidenceForAnalysis("HABITS",null,entries,plans,events,orders);
  const response={
    summary:"투자 논리와 계획을 비교했습니다.",
    focus:{mode:"HABITS",title:"반복되는 기록 습관",items:[{subject:"손절 계획",assessment:"계획이 미기록",evidenceRefs:["P1"]}]},
    findings:[{type:"risk",title:"손절 미기록",explanation:"계획이 부족합니다.",
      evidenceRefs:["P1"],nextStep:"손절 기준을 기록해 보세요."}],
    questions:["계획에서 벗어난 이유는 무엇인가요?"],limitations:["체결 이력 검증 전"],
  };
  assert.deepEqual(parseAiResult(JSON.stringify(response),envelope),response);
  assert.throws(()=>parseAiResult(JSON.stringify({...response,findings:[
    {...response.findings[0],evidenceRefs:["foreign"]}]}),envelope),/UNSUPPORTED_EVIDENCE/);
  assert.throws(()=>parseAiResult(JSON.stringify({...response,findings:[
    {...response.findings[0],evidenceRefs:[]}]}),envelope),/UNSUPPORTED_EVIDENCE/);
});

test("ZDR only, no silent fallback, no background generation or broker trading",()=>{
  const envelope=evidenceForAnalysis("STOCK_REVIEW","TSLA",entries,plans,events,orders);
  const request=aiRequestBody("test/model",envelope);
  assert.deepEqual(request.provider,{zdr:true,data_collection:"deny",require_parameters:true});
  assert.equal(request.max_tokens,1400);
  const route=read("../app/private/analysis/actions.ts");
  assert.ok(route.includes('form.get("consent")!=="SEND_SELECTED_JOURNAL_TO_OPENROUTER"'));
  assert.ok(route.includes('https://openrouter.ai/api/v1/chat/completions'));
  assert.ok(route.includes('claimAiAnalysis('));
  assert.ok(!route.includes("place_order("));
  assert.ok(!route.includes("NEXT_PUBLIC_OPENROUTER"));
});

test("accidentally pasted email, secret, account-like identifier and links are minimized",()=>{
  const fragment="Mail finance@example.com key sk-test_secret_token_12345678 account 123456789012345 https://host.example/finance?token=secret";
  const redacted=sanitizedExcerpt(fragment,380);
  assert.ok(redacted.includes("[이메일 숨김]"));
  assert.ok(redacted.includes("[토큰 숨김]"));
  assert.ok(redacted.includes("[숫자 식별자 숨김]"));
  assert.ok(redacted.includes("[링크 숨김]"));
  for(const secret of ["finance@example.com","sk-test_secret_token","123456789012345","token=secret"]){
    assert.ok(!redacted.includes(secret));
  }
});

test("AI evidence strips financial numbers and short labeled account identifiers in prose",()=>{
 const unsafe=[{...entries[0],content:"250달러에 10주 매수, USD 200.50, account no: 12345678, 계좌번호 123-456-789"}];
 const payload=JSON.stringify(evidenceForAnalysis("STOCK_REVIEW","TSLA",unsafe,plans,events,orders));
 for(const forbidden of ["250달러","10주","USD 200.50","12345678","123-456-789"]){
  assert.ok(!payload.includes(forbidden),forbidden);
 }
 assert.ok(payload.includes("[금액"));
 assert.ok(payload.includes("[계좌 식별정보 숨김]"));
 assert.ok(read("../app/private/analysis/analysis-panel.tsx").includes("모든 민감한 표현이 자동 제거된다고 보장할 수 없으므로"));
});

test("habit evidence includes different symbols despite a burst of newest notes",()=>{
 const many=Array.from({length:24},(_,i)=>({...entries[0],
   createdAt:new Date(Date.UTC(2026,9,30,0,0,24-i)).toISOString(),
   content:"TSLA memo "+i}));
 const older={...entries[0],ticker:"RKLB",content:"Older RKLB thesis",
   createdAt:"2026-10-10T00:00:00Z"};
 const result=evidenceForAnalysis("HABITS",null,[...many,older],[],[],[]);
 const notes=result.evidence.filter(e=>e.kind==="NOTE");
 assert.equal(notes.length,18);
 assert.ok(notes.some(e=>e.ticker==="RKLB"),"other symbols must not be starved");
 assert.ok(notes.some(e=>e.ticker==="TSLA"));
});

test("AI navigation is unified while legacy coaching deep links remain supported",()=>{
 const menu=read("../app/private/layout.tsx");
 const page=read("../app/private/analysis/page.tsx");
 const panel=read("../app/private/analysis/analysis-panel.tsx");
 assert.equal(menu.split('href="/private/analysis">AI 투자 복기').length-1,2);
 assert.ok(!menu.includes('href="/private/analysis?mode=COACHING"'));
 assert.ok(page.includes('params.mode==="COACHING"'));
 for(const title of ["종목별 투자 판단 검토","내 투자 습관 분석","지난 점검과 개선 추적"]){
   assert.ok(panel.includes(title),title);
 }
 assert.ok(panel.includes('name="consent"'));
 assert.ok(panel.includes('name="mode"'));
});

test("stock plan comparison reports changed fields without disclosing prices",()=>{
 const previous={...plans[0],ticker:"RKLB",targetPrice:"60",stopPrice:"50",
   rationale:"Initial strategy",createdAt:"2026-10-10T00:00:00Z"};
 const latest={...previous,targetPrice:"65",stopPrice:"56.5",
   rationale:"Revised conditions",createdAt:"2026-10-20T00:00:00Z"};
 const evidence=evidenceForAnalysis("STOCK_REVIEW","RKLB",[],[previous,latest],[],[]);
 const change=evidence.evidence.find(e=>e.kind==="PLAN_CHANGE");
 assert.ok(change);
 assert.equal(change.ref,"D1");
 assert.ok(change.detail.includes("목표가"));
 assert.ok(change.detail.includes("손절가"));
 for(const amount of ["56.5","65","60"]){
   assert.ok(!JSON.stringify(evidence).includes('"'+amount+'"'));
 }
 const unchanged=evidenceForAnalysis("STOCK_REVIEW","RKLB",[],[previous],[],[]);
 assert.ok(!unchanged.evidence.some(e=>e.kind==="PLAN_CHANGE"));
});

test("plan revision evidence is visible independently from model narrative",()=>{
 const view=read("../app/private/analysis/analysis-panel.tsx");
 assert.ok(view.includes('e.kind==="PLAN_CHANGE"'));
 assert.ok(view.includes("최근 두 계획을 비교해 변경된 항목을 확인했습니다"));
 assert.ok(view.includes("구체적인 숫자를 전달하지 않았습니다"));
});

test("habit evidence diversifies manual trades and observed orders across tickers",()=>{
 const trades=Array.from({length:20},(_,i)=>({...events[0],
   id:"t"+i,ticker:"TSLA",
   executedAt:new Date(Date.UTC(2026,9,30,0,0,30-i)).toISOString()}));
 trades.push({...events[0],id:"other",ticker:"RKLB",executedAt:"2026-10-01T00:00:00Z"});
 const orders=Array.from({length:20},(_,i)=>({...ordersFixture(),
   symbol:"TSLA",at:String(Date.UTC(2026,9,30,0,0,30-i))}));
 orders.push({...ordersFixture(),symbol:"RKLB",at:String(Date.UTC(2026,9,1))});
 const result=evidenceForAnalysis("HABITS",null,[],[],trades as ManualTradeEvent[],orders as TigerPersonalOrder[]);
 assert.ok(result.evidence.some(x=>x.kind==="USER_TRADE"&&x.ticker==="RKLB"));
 assert.ok(result.evidence.some(x=>x.kind==="TIGER_ORDER_OBSERVED"&&x.ticker==="RKLB"));
 assert.equal(result.evidence.filter(x=>x.kind==="USER_TRADE").length,12);
 assert.equal(result.evidence.filter(x=>x.kind==="TIGER_ORDER_OBSERVED").length,12);
});
function ordersFixture(){return {...orders[0]};}

test("focus schema and parser reject cross-mode, ungrounded and empty model focus",()=>{
 const e=evidenceForAnalysis("STOCK_REVIEW","TSLA",entries,plans,events,orders);
 const base={summary:"모델이 기록을 확인했습니다.",
   focus:{mode:"STOCK_REVIEW",title:"판단 점검",items:[{subject:"계획",assessment:"기록 확인 필요",evidenceRefs:["P1"]}]},
   findings:[],questions:[],limitations:[]};
 assert.equal(parseAiResult(JSON.stringify(base),e).focus.mode,"STOCK_REVIEW");
 for(const focus of [
   {...base.focus,mode:"HABITS"},
   {...base.focus,items:[]},
   {...base.focus,items:[{...base.focus.items[0],evidenceRefs:["UNKNOWN"]}]},
 ]) assert.throws(()=>parseAiResult(JSON.stringify({...base,focus}),e));
 const schema=aiRequestBody("test/model",e).response_format.json_schema.schema;
 assert.ok(schema.required.includes("focus"));
 assert.deepEqual(schema.properties.focus.properties.mode.enum,["STOCK_REVIEW"]);
});
