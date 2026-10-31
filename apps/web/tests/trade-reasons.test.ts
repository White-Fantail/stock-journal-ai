import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {notesForObserved,reasonPreview,tigerTradeHref,tradeLinked,correctionOf,latestObservedReasons} from "../lib/trade-reasons";
import type {JournalEntry} from "../lib/saas-trades-api";
const REF="a".repeat(64);
const OTHER="b".repeat(64);
function entry(id:string,ref:string|null,content:string):JournalEntry{
 return {id,kind:ref?"TRADE_NOTE":"STRATEGY",ticker:"RKLB",content,tradeEventId:null,
  createdAt:id==="2"?"2026-10-30T19:00:00Z":"2026-10-29T19:00:00Z",
  provenance:"USER_AUTHORED",brokerRef:null,
  observationRef:ref?{accountId:"owner-a",sourceRef:ref,kind:"ORDER",status:"OBSERVED_NOT_VERIFIED"}:null};
}
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
test("existing Tiger order notes appear only on matching order, with original text intact",()=>{
 const notes=[entry("1",REF,"56.50 지지 이탈\n전량 매도"),entry("2",REF,"다음은 장중 지지 확인"),
              entry("3",OTHER,"다른 주문"),entry("4",null,"단기 전략")];
 assert.deepEqual(notesForObserved(notes,REF,"ORDER").map(x=>x.id),["2","1"]);
 assert.deepEqual(notesForObserved(notes,REF,"FILL"),[]);
 assert.equal(notesForObserved(notes,REF,"ORDER")[1].content,"56.50 지지 이탈\n전량 매도");
 assert.equal(tradeLinked(notes[0]),true);
 assert.equal(tradeLinked(notes[3]),false);
 assert.equal(notesForObserved(notes,REF,"ORDER","other-account").length,0);
 assert.equal(reasonPreview(notesForObserved(notes,REF,"ORDER")), "다음은 장중 지지 확인");
});
test("reason link only accepts exact recorded order hashes and bounded pages",()=>{
 assert.equal(tigerTradeHref(REF,3),"/private/trades/tiger/"+REF+"?page=3&kind=ORDER");
 assert.equal(tigerTradeHref(REF,0,"FILL"),"/private/trades/tiger/"+REF+"?page=0&kind=FILL");
 assert.throws(()=>tigerTradeHref("../../evil"));
 assert.throws(()=>tigerTradeHref(REF,21));
});
test("trade list and detail share the SAME user-authored journal data, not a duplicate reason store",()=>{
 const list=read("../app/private/tiger/personal-preview.tsx");
 const detail=read("../app/private/trades/tiger/[sourceRef]/page.tsx");
 const edit=read("../app/private/trades/tiger/[sourceRef]/note/page.tsx");
 const journal=read("../app/private/journal/journal-workspace.tsx");
 const legacy=read("../app/private/journal/new/page.tsx");
 assert.ok(list.includes("notesForObserved(reasons"));
 assert.ok(detail.includes("notesForObserved(notesResult.value"));
 assert.ok(edit.includes("submitTigerObservationNote("));
 assert.ok(edit.includes("fetchJournal("));
 assert.ok(journal.includes("investmentEntries=useMemo(()=>entries.filter(e=>!tradeLinked(e))"));
 assert.ok(journal.includes("recentTradeSummary.map("));
 assert.ok(journal.includes("거래 상세 →"));
 assert.ok(legacy.includes("redirect(\"/private/trades/tiger/\"+ref+\"/note"));
 assert.ok(!list.includes("매매 이유 기록 →"));
});

test("trade reason server action rechecks the broker source and ticker before writing",()=>{
 const form=read("../app/private/trades/tiger/[sourceRef]/note/page.tsx");
 const action=form.slice(form.indexOf("async function addReason("),form.indexOf("export default async function TigerReasonNew"));
 assert.ok(action.includes("await tigerPersonalRead(page)"));
 assert.ok(action.includes("record.sourceRef===ref"));
 assert.ok(action.includes("matches?.length===1 && matches[0].symbol===ticker"));
 assert.ok(action.indexOf("if(!matchingRecord) redirect(")<action.indexOf("await submitTigerObservationNote("));
 assert.ok(action.includes("if(!matchingRecord) redirect(back+"));
});

test("Tiger order detail does not append share unit to an unknown filled quantity",()=>{
 const detail=read("../app/private/trades/tiger/[sourceRef]/page.tsx");
 assert.ok(detail.includes('order.filled===null?"체결 수량 미확인":formatQuantity(order.filled)+"주"'));
 assert.ok(!detail.includes('formatQuantity(order.filled,"확인 필요")+"주"'));
});

test("trade and journal pages distinguish unavailable broker data from genuinely empty history",()=>{
 const trades=read("../app/private/trades/page.tsx");
 const journal=read("../app/private/journal/page.tsx");
 assert.ok(trades.includes("personal===null"));
 assert.ok(trades.includes("기록이 없거나 삭제되었다는 뜻은 아닙니다"));
 assert.ok(journal.includes("personal===null"));
 assert.ok(journal.includes("내 투자일지와 계획 기록은 계속 표시됩니다"));
 assert.ok(journal.includes("enabled={!unavailable}"));
});

test("Tiger order detail uses the same strict fee evidence as its list",()=>{
 const list=read("../app/private/tiger/personal-preview.tsx");
 const detail=read("../app/private/trades/tiger/[sourceRef]/page.tsx");
 for(const text of [
   "parseStatementFeeEvidence(process.env.POSITIONARY_PERSONAL_FEE_STATEMENT_EVIDENCE)",
   "data.accounts.length===1",
   "resolvedFeeCurrency(",
   'basis==="STATEMENT_MATCH"',
 ]) {
   assert.ok(list.includes(text), "list: "+text);
   assert.ok(detail.includes(text), "detail: "+text);
 }
 assert.ok(detail.includes('basis==="CONFLICT"'));
 assert.ok(!detail.includes('order.feeCurrency??"통화 미확인"'));
});
test("manual trades never silently label an unrecorded fee currency as execution currency",()=>{
 const form=read("../app/private/trades/new/page.tsx");
 const list=read("../app/private/trades/manual/page.tsx");
 const detail=read("../app/private/trades/[id]/page.tsx");
 assert.ok(form.includes("수수료 통화를 별도로 저장하지 않습니다"));
 assert.equal(list.split("통화 별도 미기록").length-1,2);
 assert.ok(detail.includes("수수료 통화 별도 미기록"));
});

test("append-only Tiger corrections display only latest text while retaining history",()=>{
 const first=entry("10000000-0000-4000-8000-000000000001",REF,"original reason");
 const revised=entry("10000000-0000-4000-8000-000000000002",REF,"정정 ("+first.id+"): corrected reason");
 const third=entry("10000000-0000-4000-8000-000000000003",REF,"정정 ("+revised.id+"): latest reason");
 const groups=latestObservedReasons([first,revised,third]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].current.id,third.id);
 assert.deepEqual(groups[0].history.map(x=>x.id),[third.id,revised.id,first.id]);
 assert.deepEqual(correctionOf(third),{parentId:revised.id,content:"latest reason"});
});
test("corrections cannot suppress history of a different Tiger order",()=>{
 const first=entry("10000000-0000-4000-8000-000000000001",REF,"original");
 const forged=entry("10000000-0000-4000-8000-000000000002",OTHER,"정정 ("+first.id+"): unrelated");
 const groups=latestObservedReasons([first,forged]);
 assert.equal(groups.length,2);
 assert.ok(groups.every(x=>x.history.length===1));
});
test("detail page shows the latest correction and correction history",()=>{
 const detail=read("../app/private/trades/tiger/[sourceRef]/page.tsx");
 assert.ok(detail.includes("latestObservedReasons(notes)"));
 assert.ok(detail.includes("history.slice(1).map("));
 assert.ok(detail.includes("이유 정정"));
});

test("Tiger corrections cannot cross account boundaries even with matching order hashes",()=>{
 const original=entry("10000000-0000-4000-8000-000000000011",REF,"account A reason");
 const foreign={...entry("10000000-0000-4000-8000-000000000012",REF,
   "정정 ("+original.id+"): foreign correction"),
   observationRef:{...original.observationRef!,accountId:"owner-b"}};
 const groups=latestObservedReasons([original,foreign]);
 assert.equal(groups.length,2);
 assert.ok(groups.every(x=>x.history.length===1));
 assert.deepEqual(new Set(groups.map(x=>x.current.observationRef?.accountId)),
   new Set(["owner-a","owner-b"]));
});

test("correction form only edits current revision and rejects unchanged reason",()=>{
 const form=read("../app/private/trades/tiger/[sourceRef]/note/page.tsx");
 assert.ok(form.includes("activeReasons.find(group=>group.current.id===q.correct"));
 assert.ok(form.includes("(correctionOf(target)?.content??target.content).trim()===content"));
 assert.ok(form.includes('redirect(back+"&error=duplicate")'));
});
