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
  assert.equal(request.max_tokens,950);
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
