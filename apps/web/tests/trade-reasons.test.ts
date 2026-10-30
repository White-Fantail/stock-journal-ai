import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {notesForObserved,reasonPreview,tigerTradeHref,tradeLinked} from "../lib/trade-reasons";
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
