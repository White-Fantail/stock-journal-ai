"use client";
import {useActionState,useState} from "react";
import {indicatorCriterion,STAGE_LABELS,type IndicatorRule} from "../../../../lib/indicators";
import {submitRecord} from "../actions";
export function RecordForm({rules,idempotencyKey,ticker,tradeEventId,journalId,initialSide,observedAt}:{
  rules:IndicatorRule[];idempotencyKey:string;ticker:string;tradeEventId:string;journalId:string;
  initialSide:"BUY"|"SELL";observedAt:string;
}){
  const [side,setSide]=useState(initialSide);
  const [selected,setSelected]=useState<string[]>([]);
  const [state,action,pending]=useActionState(submitRecord,{error:null});
  const [values,setValues]=useState<Record<string,string>>({ticker,observedAt,note:""});
  const change=(key:string,value:string)=>setValues(v=>({...v,[key]:value}));
  const eligible=rules.filter(r=>r.active&&r.side===side);
  return <form action={action} className="journal-compose-form">
    <input type="hidden" name="idempotencyKey" value={idempotencyKey}/>
    <input type="hidden" name="tradeEventId" value={tradeEventId}/>
    <input type="hidden" name="journalId" value={journalId}/>
    <div className="journal-form-two">
      <label>종목<input name="ticker" required maxLength={32} value={values.ticker} onChange={e=>change("ticker",e.target.value)} readOnly={!!(tradeEventId||journalId)} pattern="[A-Za-z0-9.:-]{1,32}"/></label>
      <label>매매 구분<select name="side" value={side} onChange={e=>{setSide(e.target.value as typeof side);setSelected([]);}}>
        {(!tradeEventId||initialSide==="BUY")&&<option value="BUY">매수</option>}
        {(!tradeEventId||initialSide==="SELL")&&<option value="SELL">매도</option>}
      </select></label>
    </div>
    <label>차트에서 확인한 시각 (시간대 포함)<input name="observedAt" required value={values.observedAt} onChange={e=>change("observedAt",e.target.value)} placeholder="2026-10-28T14:30:00+13:00" aria-describedby="indicator-time-help"/></label>
    <small id="indicator-time-help">현재 시각으로 자동 기록하지 않습니다. 과거 매매를 복기할 때는 당시 차트를 확인한 시각을 입력하세요.</small>
    <p>기록할 지표를 선택하세요 (최대 20개). 입력하지 않은 값은 미기록으로 보존합니다.</p>
    {eligible.length===0?<p>이 매매 구분에 사용할 지표가 없습니다. <a href="/private/indicators/edit">지표 등록 →</a></p>:
      eligible.map(rule=><fieldset key={rule.id} className="indicator-card">
        <legend><label><input type="checkbox" name="revisionId" value={rule.id} checked={selected.includes(rule.id)}
          disabled={!selected.includes(rule.id)&&selected.length>=20}
          onChange={e=>setSelected(ids=>e.target.checked?[...ids,rule.id]:ids.filter(id=>id!==rule.id))}/>
          {rule.name} {rule.parameters} · {rule.timeframe} · {STAGE_LABELS[rule.stage]}</label></legend>
        <p>나의 기준: {indicatorCriterion(rule)}</p>
        {selected.includes(rule.id)&&<div className="journal-form-two">
          <label>당시 값 (선택)<input name={`value:${rule.id}`} value={values[`value:${rule.id}`]??""} onChange={e=>change(`value:${rule.id}`,e.target.value)} inputMode="decimal" maxLength={22} placeholder="예: 28.5"/></label>
          {rule.operator==="MANUAL"?<label>내 판단<select name={`assessment:${rule.id}`} value={values[`assessment:${rule.id}`]??"UNCERTAIN"} onChange={e=>change(`assessment:${rule.id}`,e.target.value)}>
            <option value="UNCERTAIN">판단 보류</option><option value="MET">충족</option><option value="NOT_MET">미충족</option>
          </select></label>:<p className="user-footnote">저장하면 입력값과 기준을 비교합니다. 값이 없으면 판단 보류입니다.</p>}
        </div>}
      </fieldset>)}
    <label>판단 메모 (선택)<textarea name="note" value={values.note} onChange={e=>change("note",e.target.value)} maxLength={1500} rows={3} placeholder="큰 시간봉의 조건과 진입·매도 시점을 어떻게 판단했는지 기록하세요."/></label>
    {state.error&&<p role="alert">{state.error}</p>}
    <button disabled={pending||selected.length===0} type="submit" className="btn btn-primary">{pending?"저장 중…":"당시 지표 기록 저장"}</button>
    <p className="user-footnote">선택한 기준의 현재 버전과 입력값을 함께 보존합니다. 이 기록은 사용자가 직접 작성한 내용입니다.</p>
  </form>;
}
