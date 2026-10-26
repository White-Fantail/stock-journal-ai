"use client";
import {useState} from "react";
import {calculateLongRisk} from "../../../lib/risk-budget";

export function RiskCalculator(){
 const [capital,setCapital]=useState("20000");
 const [entry,setEntry]=useState("100");
 const [invalidation,setInvalidation]=useState("90");
 const [risk,setRisk]=useState("0.5");
 const result=calculateLongRisk({capital,entry,invalidation,riskPercent:risk});
 return <section className="journal-compose journal-create-page">
   <div className="journal-compose-form">
     <div className="journal-form-two">
       <label>투자 가능 금액 (계획 통화 기준)<input type="text" inputMode="decimal" autoComplete="off"
         value={capital} onChange={e=>setCapital(e.target.value)} placeholder="20000"/></label>
       <label>거래당 위험 한도 (%)<input type="text" inputMode="decimal" autoComplete="off"
         value={risk} onChange={e=>setRisk(e.target.value)} placeholder="0.5"/></label>
     </div>
     <div className="journal-form-two">
       <label>예상 진입 가격<input type="text" inputMode="decimal" autoComplete="off"
         value={entry} onChange={e=>setEntry(e.target.value)} placeholder="100"/></label>
       <label>투자 논리 무효화 시 예상 가격<input type="text" inputMode="decimal" autoComplete="off"
         value={invalidation} onChange={e=>setInvalidation(e.target.value)} placeholder="90"/></label>
     </div>
     <p className="journal-form-hint">모든 금액은 동일한 통화 기준입니다. 기존 보유 수량과 기타 포지션을 반영하지 않는 신규 현금 매수 예시입니다.</p>
     {result.status==="INVALID"?<p role="alert">{result.reason}</p>:<>
       <div className="account-summary-values portfolio-account-values" role="status">
         <div><small>계획상 최대 손실 예산</small><strong>{result.maximumLoss}</strong></div>
         <div><small>계산상 최대 수량</small><strong>{result.maxShares}주</strong></div>
         <div><small>예상 투입 금액</small><strong>{result.estimatedCapitalUsed}</strong></div>
       </div>
       <p className="journal-form-hint">선택한 수량의 계획상 손실은 {result.estimatedPlanLoss}입니다.
         {result.limitedBy==="CAPITAL"?" 현금 투입 한도 때문에 수량이 제한됩니다.":" 위험 예산에 의해 수량이 제한됩니다."}
       </p>
       {result.maxShares==="0"&&<p role="status">이 조건에서는 1주도 위험 예산 안에 들어오지 않습니다.</p>}
     </>}
     <p className="journal-limit">이는 투자 결정에 참고할 수 있는 산술 계산기이며 주문·매매 신호가 아닙니다.
       급격한 가격 변동, 갭 하락, 미끄러짐, 수수료, 세금, 환율, 레버리지와 기존 투자 노출을 포함하지 않습니다.
       실제 손실은 예상보다 커질 수 있습니다. 이 입력값은 서버에 저장되거나 증권사에 전송되지 않습니다.</p>
   </div>
 </section>;
}
