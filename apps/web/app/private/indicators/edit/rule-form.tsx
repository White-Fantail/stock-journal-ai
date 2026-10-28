"use client";
import {useActionState,useState} from "react";
import type {IndicatorRule,IndicatorDefinition} from "../../../../lib/indicators";
import {submitRule} from "../actions";
export function RuleForm({rule,idempotencyKey}:{rule:IndicatorRule|null;idempotencyKey:string}){
  const [state,action,pending]=useActionState(submitRule,{error:null});
  const [operator,setOperator]=useState<IndicatorDefinition["operator"]>(rule?.operator??"LTE");
  const [draft,setDraft]=useState({name:rule?.name??"",parameters:rule?.parameters??"",timeframe:rule?.timeframe??"",
    side:rule?.side??"BUY",stage:rule?.stage??"CONTEXT",lower:rule?.lower??"",upper:rule?.upper??"",
    condition:rule?.condition??"",active:rule?.active??true});
  const change=(key:string,value:string|boolean)=>setDraft(d=>({...d,[key]:value}));
  return <form action={action} className="journal-compose-form">
    <input type="hidden" name="idempotencyKey" value={idempotencyKey}/>
    <input type="hidden" name="ruleId" value={rule?.ruleId??""}/>
    <input type="hidden" name="expectedRevisionId" value={rule?.id??""}/>
    <div className="journal-form-two">
      <label>지표 이름<input name="name" required maxLength={60} value={draft.name} onChange={e=>change("name",e.target.value)} placeholder="예: RSI, MACD"/></label>
      <label>설정값 (선택)<input name="parameters" maxLength={100} value={draft.parameters} onChange={e=>change("parameters",e.target.value)} placeholder="예: 기간 14"/></label>
      <label>시간봉<input name="timeframe" required maxLength={30} list="indicator-timeframes" value={draft.timeframe} onChange={e=>change("timeframe",e.target.value)} placeholder="예: 주봉, 일봉, 15분봉"/></label>
      <datalist id="indicator-timeframes">{["주봉","일봉","4시간봉","1시간봉","15분봉","5분봉","1분봉"].map(t=><option key={t} value={t}/>)}</datalist>
      <label>매매 구분<select name="side" value={draft.side} onChange={e=>change("side",e.target.value)}><option value="BUY">매수</option><option value="SELL">매도</option></select></label>
      <label>용도<select name="stage" value={draft.stage} onChange={e=>change("stage",e.target.value)}><option value="CONTEXT">검토 조건 (큰 흐름 확인)</option><option value="TIMING">시점 판단</option></select></label>
      <label>조건 방식<select name="operator" value={operator} onChange={e=>setOperator(e.target.value as typeof operator)}>
        <option value="LTE">기준값 이하</option><option value="GTE">기준값 이상</option>
        <option value="BETWEEN">범위 안</option><option value="MANUAL">직접 판단 (돌파 등)</option>
      </select></label>
    </div>
    {operator!=="MANUAL"&&<div className="journal-form-two">
      <label>{operator==="BETWEEN"?"최솟값":"기준값"}<input required name="lower" inputMode="decimal" maxLength={22} value={draft.lower} onChange={e=>change("lower",e.target.value)} placeholder="예: 30"/></label>
      {operator==="BETWEEN"&&<label>최댓값<input required name="upper" inputMode="decimal" maxLength={22} value={draft.upper} onChange={e=>change("upper",e.target.value)}/></label>}
    </div>}
    <label>{operator==="MANUAL"?"판단 기준":"추가 설명 (선택)"}<textarea name="condition" required={operator==="MANUAL"} rows={3} maxLength={500} value={draft.condition} onChange={e=>change("condition",e.target.value)} placeholder="예: RSI가 30 아래에서 위로 돌파했는지 직접 확인"/></label>
    <label><input type="checkbox" name="active" value="yes" checked={draft.active} onChange={e=>change("active",e.target.checked)}/> 기록할 때 이 지표를 사용</label>
    <p className="user-footnote">시간봉·매수·매도 기준이 다르면 각각 등록하세요. 숫자는 직접 정하는 기준이며, 수정하거나 사용을 중지해도 이전 매매 기록의 기준은 보존됩니다.</p>
    {state.error&&<p role="alert">{state.error}</p>}
    <button disabled={pending} className="btn btn-primary" type="submit">{pending?"저장 중…":"지표 기준 저장"}</button>
  </form>;
}
