"use client";

import {useActionState} from "react";
import Link from "next/link";
import {saveAiImprovement,initialAiImprovementSaveState} from "./save-improvement";

export function AiImprovementForm({suggestion,saveKey,preferredTicker,planRevisions}:{
  suggestion:string;saveKey:string;preferredTicker:string|null;
  planRevisions:Readonly<Record<string,string>>;
}){
  const [state,save,pending]=useActionState(saveAiImprovement,initialAiImprovementSaveState);
  const entries=Object.entries(planRevisions).filter(([ticker,id])=>
    /^[A-Z0-9.:-]{1,32}$/.test(ticker)&&
    /^[0-9a-f-]{36}$/i.test(id)).sort(([a],[b])=>a.localeCompare(b));
  const chosen=preferredTicker&&entries.some(([ticker])=>ticker===preferredTicker)
    ?preferredTicker:entries[0]?.[0]??"";
  // A revision is selected from existing, authored plans only. A stale version
  // is rejected again by the server before creating the immutable check-in.
  if(state.status==="saved")return <div className="state-panel" role="status" style={{marginTop:12,padding:12}}>
    <strong>{state.message}</strong>
    <p><Link href="/private/review">저장한 다음 행동 확인 →</Link></p>
  </div>;
  return <details className="data-disclosure" style={{marginTop:12}}>
    <summary>이 제안을 내 다음 점검 행동으로 등록</summary>
    <p className="user-footnote">AI 제안은 자동 저장되지 않습니다. 내가 내용을 직접 검토하고
      현재 투자계획에 대한 자기평가를 작성해야 등록할 수 있습니다. 투자계획 자체는 수정하지 않습니다.</p>
    {entries.length===0?<p>저장하려면 종목별 투자계획이 먼저 필요합니다.
      <Link href="/private/journal/new?mode=plan"> 투자계획 작성 →</Link></p>:
    <form action={save} style={{display:"grid",gap:12,marginTop:12}}>
      <input type="hidden" name="idempotencyKey" value={saveKey}/>
      <label>적용할 종목
        <select name="ticker" defaultValue={chosen} required>
          {entries.map(([ticker])=><option key={ticker} value={ticker}>{ticker}</option>)}
        </select>
      </label>
      <p className="user-footnote">현재 종목의 투자계획 버전으로 저장됩니다. 계획이 바뀌면 저장을 중단합니다.</p>
      <input type="hidden" name="expectedPlanRevisionId"
        value={planRevisions[chosen]??""}/>
      <label>현재 투자 원칙에 대한 내 평가
        <select name="selfAssessment" required defaultValue="">
          <option value="" disabled>내가 직접 판단해 선택</option>
          <option value="FOLLOWED">원칙을 지켰음</option>
          <option value="PARTIAL">일부만 지켰음</option>
          <option value="DEVIATED">원칙에서 벗어남</option>
          <option value="UNCERTAIN">판단 유보 · 근거 부족</option>
        </select>
      </label>
      <label>내가 확인한 사실과 판단 근거
        <textarea name="content" maxLength={6000} minLength={1} required rows={3}
          placeholder="AI 설명을 그대로 사실로 받아들이지 말고, 내 기록을 확인해 근거를 직접 작성하세요."/>
      </label>
      <label>내 다음 점검 행동 (검토하고 수정 가능)
        <textarea name="nextAction" defaultValue={suggestion} maxLength={1500}
          minLength={1} required rows={3}/>
      </label>
      <label style={{display:"flex",gap:8,alignItems:"flex-start"}}>
        <input type="checkbox" name="approval" required value="USER_REVIEWED_AND_APPROVED"/>
        <span>AI 제안을 검토했고, 수정한 내용을 내 자기평가와 다음 행동으로 기록하는 데 동의합니다.</span>
      </label>
      {state.status==="error"&&<p role="alert">{state.message}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending?"저장 중…":"내 개선 행동으로 저장"}
      </button>
    </form>}
  </details>;
}
