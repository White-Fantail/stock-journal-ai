"use client";
import {useState} from "react";
import type {JournalPriceLevel} from "../../../../lib/saas-trades-api";
type Kind=JournalPriceLevel["kind"];
const GROUPS:ReadonlyArray<{kind:Kind;name:string;hint:string}>=[
  {kind:"ENTRY",name:"진입 가격",hint:"예: 지지 확인 후 분할 진입"},
  {kind:"CONFIRM",name:"확인 가격",hint:"예: 돌파 또는 지지 재확인"},
];
export function PlanPriceLevelsForm({initialLevels}:{initialLevels:readonly JournalPriceLevel[]}){
  const [levels,setLevels]=useState<JournalPriceLevel[]>(()=>initialLevels
    .filter(l=>l.kind==="ENTRY"||l.kind==="CONFIRM").slice(0,8).map(l=>({...l})));
  function add(kind:Kind){
    if(levels.length>=8||levels.filter(l=>l.kind===kind).length>=4)return;
    setLevels(old=>[...old,{kind,price:"",note:""}]);
  }
  function patch(index:number,field:"price"|"note",value:string){
    setLevels(old=>old.map((l,i)=>i===index?{...l,[field]:value}:l));
  }
  return <section className="plan-level-editor plan-risk-check">
    <h3>진입·확인 가격선</h3>
    <p className="journal-form-hint">선택 입력 · 가격선별 근거를 저장합니다. 각 종류 최대 4개, 실제 주문이나 가격 알림은 생성하지 않습니다.</p>
    {GROUPS.map(g=><div key={g.kind} className="plan-level-group">
      <div className="plan-level-heading"><strong>{g.name}</strong>
        <button type="button" className="btn btn-outline"
          disabled={levels.length>=8||levels.filter(l=>l.kind===g.kind).length>=4}
          onClick={()=>add(g.kind)}>+ 가격 추가</button>
      </div>
      {!levels.some(l=>l.kind===g.kind)&&<p className="journal-form-hint">아직 설정된 가격선이 없습니다.</p>}
      {levels.map((l,i)=>l.kind===g.kind?<div key={i} className="plan-level-row">
        <label>{g.name}<input type="text" inputMode="decimal" value={l.price}
          onChange={e=>patch(i,"price",e.target.value)}
          pattern="(?:0|[1-9][0-9]{0,23})(?:[.][0-9]{1,12})?"
          required placeholder="예: 613.50"/></label>
        <label>판단 근거<input type="text" maxLength={400} value={l.note}
          onChange={e=>patch(i,"note",e.target.value)} placeholder={g.hint}/></label>
        <button type="button" className="btn btn-outline" aria-label={g.name+" 삭제"}
          onClick={()=>setLevels(old=>old.filter((_,j)=>j!==i))}>삭제</button>
      </div>:null)}
    </div>)}
    <input type="hidden" name="priceLevels" value={JSON.stringify(levels)}/>
    <p className="journal-form-hint">목표·손절 가격은 위의 기본 계획 필드를 사용합니다. 이전 계획은 변경하지 않고 보존됩니다.</p>
  </section>;
}
