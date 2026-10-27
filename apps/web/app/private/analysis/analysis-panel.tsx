"use client";

import {useActionState,useState} from "react";
import Link from "next/link";
import {runAiAnalysis,type AiState} from "./actions";
const initialAiState:AiState={status:"idle",message:"",result:null,evidence:[],asOf:null,model:null,remainingDay:null};

export function AnalysisPanel({available,symbols,initialMode="STOCK_REVIEW",initialSymbol}:{
  available:boolean;symbols:readonly string[];initialMode?:"STOCK_REVIEW"|"HABITS"|"COACHING";initialSymbol?:string;
}){
  const [mode,setMode]=useState<"STOCK_REVIEW"|"HABITS"|"COACHING">(initialMode);
  const [consented,setConsented]=useState(false);
  const [selected,setSelected]=useState(initialSymbol&&symbols.includes(initialSymbol)?initialSymbol:symbols[0]??"");
  const [state,submit,pending]=useActionState(runAiAnalysis,initialAiState);
  const selectedEvidence=new Map(state.evidence.map(x=>[x.ref,x]));
  return <div style={{display:"grid",gap:24}}>
    <section className="state-panel">
      <h2>투자 기록 복기</h2>
      <p>매매 기록과 내가 작성한 투자 논리를 근거로, 의사결정의 일관성과 반복되는 습관을 점검합니다.
        주가를 예측하거나 자동으로 주문하지 않습니다.</p>
      <form action={submit} style={{display:"grid",gap:16,maxWidth:680}}>
        <label>분석 범위
          <select name="mode" value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setConsented(false);}}>
            <option value="STOCK_REVIEW">선택 종목의 매매·계획 복기</option>
            <option value="HABITS">전체 기록에서 반복 습관 살펴보기</option>
            <option value="COACHING">최근 3개월과 이번 달의 계획·실천 복기</option>
          </select>
        </label>
        {mode!=="HABITS"&&<label>{mode==="COACHING"?"코칭할 종목":"분석 종목"}
          <select name="symbol" required value={selected} onChange={e=>{setSelected(e.target.value);setConsented(false);}}>
            {symbols.length===0?<option value="">기록된 종목이 없습니다</option>:
              symbols.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </label>}
        {mode==="COACHING"&&<p className="user-footnote">종목별 최근 자기평가, 월간 작성 건수와 직접 확인한 마지막 행동 상태를 근거로 삼습니다.
          <Link href="/private/review"> 지난 행동 상태를 먼저 기록</Link>하면 이번 코칭에서 확인할 수 있습니다.</p>}
        <div className="state-panel" style={{padding:16}}>
          <h3>외부 전송 범위</h3>
          {mode==="COACHING"?<p>선택한 종목과 관련해 <strong>최근 완료된 3개월 및 이번 달 진행 중인 투자일지 건수,
            전체 자기평가 건수, 최근 자기평가의 판단 근거와 본인이 적은 다음 행동 일부, 직접 보고한 최신 행동의 상태·간략한 근거</strong>를
            전송합니다. 완료된 달과 이번 달은 동일 길이로 비교하지 않습니다.
            계좌번호·증권사 주문·보유수량·가격·금액·수익률은 전송하지 않습니다.</p>:
          <p>선택한 종목(또는 전체)의 최근 <strong>일지 내용 일부, 투자계획 변경 사유, 직접 입력한 매매 사유</strong>와
            Tiger 주문의 방향·상태·날짜만 추려서 OpenRouter의 모델 제공자에게 전달합니다.
            계좌번호·인증 정보·원본 체결 식별자·보유 수량·가격·금액은 전송하지 않습니다.</p>}
          <p>OpenRouter에서 데이터 수집 거부 및 Zero Data Retention(ZDR) 제공자로 제한합니다.
            모델 제공자 약관과 데이터 처리 조건도 적용됩니다. 결과는 자동 저장되지 않습니다.</p>
        </div>
        <label style={{display:"flex",alignItems:"flex-start",gap:10}}>
          <input type="checkbox" required name="consent" checked={consented} onChange={e=>setConsented(e.target.checked)}
            value="SEND_SELECTED_JOURNAL_TO_OPENROUTER"/>
          <span>이번 분석을 위해 위에 설명한 기록 일부를 OpenRouter의 적격 AI 제공자에게 전송하는 데 동의합니다.</span>
        </label>
        {!available&&<p role="status">OpenRouter 분석 기능의 운영 API 키·모델·사용 설정이 아직 준비되지 않았습니다.</p>}
        <button type="submit" className="btn btn-primary" disabled={!available||pending||symbols.length===0}>
          {pending?"투자 기록 검토 중…":mode==="COACHING"?"지난 행동과 이번 달 기록 코칭받기":"AI로 내 투자 판단 분석하기"}
        </button>
        <small>워크스페이스당 1일 최대 4회, 월 최대 60회. 공급자 사용량에 따라 비용이 발생할 수 있습니다.</small>
      </form>
    </section>
    {mode==="COACHING"&&<p className="user-footnote">AI 코칭은 사용자가 지난 점검에서
      적어둔 다음 행동이 실제로 실행됐다고 자동 판정하지 않습니다.
      <Link href="/private/reports/monthly">월간 기록 비교</Link>와
      <Link href="/private/journal">투자계획·자기평가 작성</Link>을 병행할 수 있습니다.</p>}
    {state.status==="error"&&<section className="state-panel" role="alert">
      <h2>분석 불가</h2><p>{state.message}</p>
    </section>}
    {state.status==="success"&&state.result&&<section className="state-panel" aria-live="polite">
      <h2>{mode==="COACHING"?"이번 투자 습관 코칭":"내 투자 기록 복기"}</h2>
      <p className="user-footnote">AI가 제시한 행동은 자동 저장하지 않습니다. 적용할 내용은 투자일지에서 직접 검토한 뒤 기록하세요.</p>
      <p>{state.result.summary}</p>
      <small>기록 기준일 {state.asOf} · {state.model} · 오늘 남은 요청 {state.remainingDay}회 ·
        외부 AI 생성 결과이며, 실제 수익률이나 매매 체결을 검증한 자료가 아닙니다.</small>
      {state.result.findings.map((f,i)=><article key={i} style={{marginTop:20,paddingTop:12,borderTop:"1px solid var(--border, #ddd)"}}>
        <h3>{f.type==="strength"?"잘한 점":f.type==="risk"?"보완할 점":"반복 습관"} · {f.title}</h3>
        <p>{f.explanation}</p>
        <p><strong>다음에 해볼 것:</strong> {f.nextStep}</p>
        <small>근거: {f.evidenceRefs.map(ref=>{
          const ev=selectedEvidence.get(ref);
          return <span key={ref} style={{marginRight:12}}>{ref} {ev?.ticker} · {ev?.on} ({ev?.source})</span>;
        })}</small>
      </article>)}
      {state.result.questions.length>0&&<div style={{marginTop:20}}>
        <h3>다음 투자일지에 기록할 질문</h3>
        <ul>{state.result.questions.map((x,i)=><li key={i}>{x}</li>)}</ul>
      </div>}
      {state.result.limitations.length>0&&<div style={{marginTop:20}}>
        <h3>분석의 한계</h3>
        <ul>{state.result.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul>
      </div>}
      <details style={{marginTop:20}}>
        <summary>AI 분석에 사용한 근거 {state.evidence.length}건 확인</summary>
        <ul>{state.evidence.map(e=><li key={e.ref}><strong>{e.ref} {e.ticker} · {e.on}</strong>
          <p>{e.source} · {e.detail}</p></li>)}</ul>
      </details>
      {state.evidence.some(e=>e.kind==="MONTHLY_PROCESS")&&<p className="user-footnote">
        지난달에 적은 개선 과제를 이번 달에 실제로 수행했는지 확인하려면,
        <Link href="/private/journal"> 투자일지에서 종목을 선택해 새 자기평가</Link>를 작성하세요.
        AI 답변만으로 행동 완료 여부를 확정하지 않습니다. 반복적으로 원칙에서 벗어났다는 표시는 자기평가에서만 도출하며 두려움·충동·탐욕 여부를 자동 판정하지 않습니다.
      </p>}
      <div className="home-actions" style={{marginTop:16}}>
        <Link className="btn btn-primary" href={selected?"/private/journal?ticker="+encodeURIComponent(selected):"/private/journal"}>내 계획 직접 검토 →</Link>
        <Link className="btn btn-outline" href="/private/review">지난 행동 확인 →</Link>
      </div>
      <p style={{marginTop:18}}>이 분석은 투자 판단 복기를 돕는 참고 자료이며, 매수·매도 추천이나 수익 보장을 제공하지 않습니다.</p>
    </section>}
  </div>;
}
