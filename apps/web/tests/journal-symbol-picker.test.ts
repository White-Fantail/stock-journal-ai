import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),"utf8");

test("journal uses per-user symbol dropdown including holdings, previous orders and notes",()=>{
  const form=read("../app/private/journal/new/page.tsx");
  const picker=read("../app/private/journal/new/symbol-picker.tsx");
  assert.ok(form.includes("fetchManualTrades(session.user.id)"));
  assert.ok(form.includes("fetchJournal(session.user.id)"));
  assert.ok(form.includes("fetchJournalPlans(session.user.id)"));
  assert.ok(form.includes("tigerPersonalRead(mode==="));
  assert.ok(form.includes("JournalSymbolPicker"));
  assert.ok(picker.includes("<select"));
  assert.ok(picker.includes("name=\"ticker\""));
  assert.ok(picker.includes("목록에 없는 종목 입력"));
  assert.ok(!form.includes("name=\"confirmation\""));
  assert.ok(form.includes("submitJournal("));
  assert.ok(form.includes("submitJournalPlan("));
  assert.ok(form.includes("submitBrokerFillNote("));
  assert.ok(form.includes("submitTigerObservationNote("));
});

test("client source selector changes related trade choices with selected ticker",()=>{
  const picker=read("../app/private/journal/new/symbol-picker.tsx");
  assert.ok(picker.includes("trades.filter(t=>t.ticker===ticker)"));
  assert.ok(picker.includes("key={ticker}"));
  assert.ok(picker.includes("type=\"hidden\" name=\"ticker\""));
});
