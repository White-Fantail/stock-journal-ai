"use client";
import {useState} from "react";
import {calculatePreBuyRisk, type RiskHolding} from "../../../../lib/risk-budget";

export type ObservedHolding = Readonly<{
 account:string;quantity:string;averageCost:string|null;
 currency:string;asOf:string|null
}>;
export function PlanRiskCheck({ticker,initialStop,initialTarget,initialCurrency,
 observedHoldings,snapshotAvailable}:{
 ticker:string;initialStop:string;initialTarget:string;initialCurrency:string;
 observedHoldings:readonly ObservedHolding[];snapshotAvailable:boolean;
}){
 const [stop,setStop]=useState(initialStop);
 const [currency,setCurrency]=useState(initialCurrency);
 const [capital,setCapital]=useState("");
 const [cash,setCash]=useState("");
 const [entry,setEntry]=useState("");
 const [risk,setRisk]=useState("1");
 // Never infer no holdings from a failed or partial snapshot. Explicit choice required.
 const [holdingMode,setHoldingMode]=useState<"unknown"|"tiger"|"manual"|"none">("unknown");
 const [manualQuantity,setManualQuantity]=useState("");
 const [manualCost,setManualCost]=useState("");
 const compatible=snapshotAvailable && observedHoldings.every(p=>
   p.currency===currency.toUpperCase() && p.asOf && p.averageCost!==null);
 const haveInputs=!!(capital&&cash&&entry&&stop&&risk);
 const holdings:RiskHolding[]=holdingMode==="tiger"?observedHoldings.map(p=>({
   quantity:p.quantity,averageCost:p.averageCost
 })) :holdingMode==="manual"?[{quantity:manualQuantity,averageCost:manualCost||null}]:[];
 const ready=haveInputs && holdingMode!=="unknown" && (holdingMode!=="tiger"||compatible);
 const result=ready?calculatePreBuyRisk({
   capital,availableCash:cash,entry,invalidation:stop,riskPercent:risk,holdings
 }):null;
 const holdingsLabel=holdingMode==="tiger"?"Tiger 조회값 기준":holdingMode==="manual"?
   "직접 입력한 보유량 기준":"보유 없음(본인 확인) 기준";
 return <>
   <details className="data-disclosure" open={Boolean(initialStop||initialTarget)}>
     <summary>목표가·손절 기준 가격 (선택 사항 · 실제 주문 아님)</summary>
     <div className="journal-form-three">
       <label>목표가<input name="targetPrice" inputMode="decimal" type="text"
         defaultValue={initialTarget}
         pattern="(0|[1-9][0-9]{0,23})([.][0-9]{1,12})?" placeholder="미설정"/></label>
       <label>손절 기준 가격<input name="stopPrice" inputMode="decimal" type="text"
         value={stop} onChange={e=>setStop(e.target.value)}
         pattern="(0|[1-9][0-9]{0,23})([.][0-9]{1,12})?" placeholder="미설정"/></label>
       <label>가격 통화<input name="priceCurrency" value={currency}
         onChange={e=>setCurrency(e.target.value.toUpperCase())}
         maxLength={3} pattern="[A-Za-z]{3}"/></label>
     </div>
     <p className="journal-form-hint">가격 두 개를 비우면 가격 계획을 해제합니다. 손절 기준 가격은 매수 전 위험 점검에도 사용되지만, 주문은 실행되지 않습니다.</p>
   </details>
   <section className="plan-risk-check" aria-label={ticker+" 매수 전 위험 점검"}>
     <h3>매수 전 위험 점검 <small>선택 사항</small></h3>
     <p className="user-footnote">계획의 손절 기준과 기존 보유 주식까지 고려해, 이번에 몇 주를 더 살 수 있는지 계산합니다. 숫자는 저장되지 않으며 실제 매수 주문도 아닙니다.</p>
     <div className="journal-form-two">
       <label>위험을 계산할 기준 자금 ({currency||"통화 선택"})
         <input type="text" inputMode="decimal" autoComplete="off" value={capital}
           onChange={e=>setCapital(e.target.value)} placeholder="예: 전체 투자 원금 10000"/></label>
       <label>이번 매수에 사용할 현금 ({currency||"통화 선택"})
         <input type="text" inputMode="decimal" autoComplete="off" value={cash}
           onChange={e=>setCash(e.target.value)} placeholder="예: 3000"/></label>
     </div>
     <div className="journal-form-two">
       <label>이번에 예상하는 매수가 ({currency||"통화 선택"})
         <input type="text" inputMode="decimal" autoComplete="off" value={entry}
           onChange={e=>setEntry(e.target.value)} placeholder="예: 420"/></label>
       <label>이번 투자에서 감수할 최대 손실 (%)
         <input type="text" inputMode="decimal" autoComplete="off" value={risk}
           onChange={e=>setRisk(e.target.value)} placeholder="예: 1"/></label>
     </div>
     <p className="journal-form-hint">손절 기준가: <strong>{stop||"미입력"}</strong> {currency}.
       기준 자금 × 손실 비율이 이 종목에 허용하는 손실 한도입니다. 기본 1%는 계산 예시이며 개인 권장 비율은 아닙니다.</p>
     <label>현재 {ticker} 보유 수량 확인
       <select value={holdingMode} onChange={e=>setHoldingMode(e.target.value as typeof holdingMode)}>
         <option value="unknown">보유 상태 확인 전 · 계산 보류</option>
         {snapshotAvailable&&<option value="tiger">연결된 Tiger 계좌 조회값으로 계산 (미검증)</option>}
         <option value="manual">기존 보유 수량과 평균 매수가 직접 입력</option>
         <option value="none">해당 종목을 보유하지 않음 (내가 확인함)</option>
       </select>
     </label>
     {holdingMode==="tiger" && <>
       {!compatible?<p role="alert">조회된 보유 자료의 통화·평균 매수가·기준시각을 확인할 수 없거나 계획 통화와 다릅니다. 직접 입력하거나 통화를 수정해 주세요.</p>:
         <div className="journal-form-hint">조회한 Tiger 계좌 {observedHoldings.length}개 종목 항목을 합산합니다. 실제 거래 원장으로 검증된 값은 아닙니다.
           {observedHoldings.map((p,i)=><span className="plan-risk-holding" key={p.account+":"+i}>
             {p.account}: {p.quantity}주 · 평균 매수가 {p.averageCost} {p.currency} · {p.asOf||"기준시각 미상"}
           </span>)}
           {observedHoldings.length===0&&<span className="plan-risk-holding">조회된 Tiger 계좌에 이 종목이 표시되지 않습니다. 다른 계좌의 보유 여부는 포함되지 않습니다.</span>}
         </div>}
     </>}
     {holdingMode==="manual"&&<div className="journal-form-two">
       <label>이미 보유한 수량 (주)
         <input type="text" inputMode="decimal" value={manualQuantity}
           onChange={e=>setManualQuantity(e.target.value)} placeholder="예: 10"/></label>
       <label>기존 주식의 평균 매수가 ({currency||"통화 선택"})
         <input type="text" inputMode="decimal" value={manualCost}
           onChange={e=>setManualCost(e.target.value)} placeholder="예: 430"/></label>
     </div>}
     {holdingMode==="unknown"?<p className="journal-form-hint" role="status">보유 내역을 확인한 뒤 계산할 수 있습니다. 조회 실패를 보유 0주로 취급하지 않습니다.</p>:
      !ready?<p className="journal-form-hint" role="status">손절 기준 가격, 예상 매수가, 자금 및 기존 보유량을 같은 통화로 입력하면 결과가 표시됩니다.</p>:
      result?.status==="INVALID"?<p role="alert">{result.reason}</p>:
      result?.status==="OK"?<>
       <div className="account-summary-values portfolio-account-values" role="status">
         <div><small>이번에 추가 매수 가능한 최대 수량</small><strong>{result.maxShares}주</strong></div>
         <div><small>추가 매수에 필요한 금액</small><strong>{result.estimatedCapitalUsed} {currency}</strong></div>
         <div><small>설정한 최대 손실 한도</small><strong>{result.maximumLoss} {currency}</strong></div>
         <div><small>기존 보유분의 손절가 기준 손실</small><strong>{result.heldPlanLoss} {currency}</strong></div>
         <div><small>새 매수분의 예상 손실</small><strong>{result.estimatedPlanLoss} {currency}</strong></div>
         <div><small>기존+추가 합산 예상 손실</small><strong>{result.estimatedTotalPlanLoss} {currency}</strong></div>
       </div>
       <p className="journal-form-hint">{holdingsLabel} · 남은 손실 한도 {result.remainingLossBudget} {currency}.
         {result.limitedBy==="EXISTING"?" 기존 보유분만으로 손실 한도에 도달했거나 초과했습니다.":
          result.limitedBy==="CAPITAL"?" 이번에 사용할 현금 한도가 추가 수량을 제한합니다.":
          " 남은 손실 한도에 의해 추가 수량이 제한됩니다."}
       </p>
       {result.maxShares==="0"&&<p role="status">현재 입력한 계획 조건에서는 추가 매수 가능한 수량이 0주입니다.</p>}
     </>:null}
     <p className="journal-limit">보유분의 기준 손실은 평균 매수가와 손절 기준가 차이로 계산합니다. 실제 현재가 대비 위험이나 실시간 시세는 반영하지 않습니다.
       외부 계좌·누락된 보유분은 자동 반영되지 않으며, Tiger 값은 검증되지 않은 관측입니다.
       갭 하락·주문 체결 실패·수수료·세금·환율 변동으로 실제 손실이 더 커질 수 있습니다. 한도가 자동으로 집행되는 기능이 아닙니다.</p>
   </section>
 </>;
}
