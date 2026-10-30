import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {planNoteDifferences} from "../lib/plan-note-differences";
import type {JournalEntry,JournalPlan} from "../lib/saas-trades-api";
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
const plan={
 id:"00000000-0000-0000-0000-000000000001",ticker:"RKLB",
 createdAt:"2026-10-01T00:00:00.000Z",
 targetPrice:"60",stopPrice:"50",priceCurrency:"USD",
 rationale:"Existing strategy",provenance:"USER_AUTHORED",isBrokerOrder:false,
} as JournalPlan;
const note=(content:string,date="2026-10-20T00:00:00.000Z",ticker="RKLB")=>
 ({ticker,content,createdAt:date,kind:"THESIS",id:"abc"} as JournalEntry);

test("explicit later stop/target prices are review candidates, not approved revisions",()=>{
 const signals=planNoteDifferences("RKLB",[
   note("손절가 56.5로 변경할지 검토, 목표가 USD 65도 후보"),
 ],[plan]);
 assert.deepEqual(signals.map(x=>x.kind),["STOP","TARGET"]);
 assert.deepEqual(signals.map(x=>x.mentioned),["56.5","65"]);
 assert.ok(signals.every(x=>x.source==="USER_AUTHORED_NOTE_REVIEW_CANDIDATE"));
});

test("a post-plan conditional exit threshold is distinguished from the stop price",()=>{
 const signals=planNoteDifferences("RKLB",[note("56.5가 깨지면 전량 매도 고려")],[plan]);
 assert.equal(signals.length,1);
 assert.equal(signals[0].kind,"EXIT_CONDITION");
 assert.equal(signals[0].planned,"50");
 assert.equal(signals[0].mentioned,"56.5");
});

test("outdated notes, other tickers, equal prices and mismatched currencies are ignored",()=>{
 const signals=planNoteDifferences("RKLB",[
   note("손절가 80","2026-09-01T00:00:00.000Z"),
   note("목표가 65","2026-10-20T00:00:00.000Z","TSLA"),
   note("목표가 USD 60, 손절가 50"),
   note("목표가 NZD 65"),
 ],[plan]);
 assert.equal(signals.length,0);
});

test("numeric candidate values do not enter the external AI envelope",()=>{
 const actions=read("../app/private/analysis/actions.ts");
 const view=read("../app/private/analysis/analysis-panel.tsx");
 assert.ok(actions.includes("planSignals=planNoteDifferences("));
 assert.ok(actions.includes("aiRequestBody(process.env.OPENROUTER_MODEL!,envelope)"));
 assert.ok(!actions.includes("aiRequestBody(process.env.OPENROUTER_MODEL!,planSignals)"));
 assert.ok(view.includes("수치는 외부 AI로 보내지 않고"));
 assert.ok(view.includes("실제 계획 변경이나 원칙 위반을 확정하지 않으며"));
});
