"use client";
import {useState} from "react";
import {calculatePurchaseScenario,referencePrice,type PurchaseScenario} from "../../../../lib/purchase-scenario";
import type {InvestmentStrategyType} from "../../../../lib/saas-trades-api";

export type PlanPortfolioReference=Readonly<{
 currency:string;asOf:string;accountCount:number;
 nav:string;cash:string;heldValue:string;heldShares:string;heldPercent:string;
}>;
type SourceMode="tiger"|"manual";
const safe=(value:string)=>value.trim();
const textValue=(value:string)=>value||"미설정";

export function PlanRiskCheck({ticker,initialStop,initialTarget,initialCurrency,
 initialStrategy,initialMaxPct,principleMaxPct,reference,unavailableReason}:{
 ticker:string;initialStop:string;initialTarget:string;initialCurrency:string;
 initialStrategy:InvestmentStrategyType|null;initialMaxPct:string|null;
 principleMaxPct:string|null;reference:PlanPortfolioReference|null;
 unavailableReason:string|null;
}){
 const [strategy,setStrategy]=useState(initialStrategy??"");
 const [stop,setStop]=useState(initialStop);
 const [currency,setCurrency]=useState(initialCurrency);
 const [maxPct,setMaxPct]=useState(initialMaxPct??"");
 const [mode,setMode]=useState<SourceMode>(reference?"tiger":"manual");
 const [manualNav,setManualNav]=useState("");
 const [manualCash,setManualCash]=useState("");
 const [manualValue,setManualValue]=useState("");
 const [manualShares,setManualShares]=useState("");
 const [price,setPrice]=useState(reference?referencePrice(reference.heldValue,reference.heldShares)??"":"");
 const [buyShares,setBuyShares]=useState("0");
 const [includeReview,setIncludeReview]=useState(false);
 const [expandedManual,setExpandedManual]=useState(false);
 const [decision,setDecision]=useState("");
 const priceCurrency=currency.toUpperCase();
 const sourceReady=mode==="tiger"&&reference?.currency===priceCurrency;
 const chosen=sourceReady?reference:null;
 const inputs=mode==="manual"?{
   nav:manualNav,cash:manualCash,heldValue:manualValue,heldShares:manualShares
 }:chosen?{nav:chosen.nav,cash:chosen.cash,
   heldValue:chosen.heldValue,heldShares:chosen.heldShares}:null;
 const effectiveCap=safe(maxPct)||principleMaxPct||null;
 const capSource=safe(maxPct)?"종목 계획":principleMaxPct?"나의 투자 원칙":"미설정";
 const validInputs=inputs&&inputs.nav!==""&&inputs.cash!==""&&
   inputs.heldValue!==""&&inputs.heldShares!==""&&safe(price)!==""&&safe(buyShares)!=="";
 const scenario:PurchaseScenario|null=validInputs?calculatePurchaseScenario({
   ...inputs,price:safe(price),buyShares:safe(buyShares),
   maxAllocationPct:effectiveCap,stop:strategy==="TECHNICAL"?safe(stop)||null:null,
 }):null;
 const calculated=scenario?.state==="READY"?scenario:null;
 const sourceLabel=sourceReady&&chosen
   ?`Tiger 관측 ${chosen.asOf} · ${chosen.accountCount}개 계좌 (미검증)`
   :"사용자 직접 입력 (증권사 미검증)";
 const scenarioNote=calculated?[
   `매수 전 점검 · ${ticker} · ${priceCurrency} · ${sourceLabel}`,
   `기준 자산 ${inputs?.nav}, 가용 현금 ${inputs?.cash}, 기존 평가액 ${inputs?.heldValue}, 기존 수량 ${inputs?.heldShares}주`,
   `가정 매수가 ${price}, 추가 ${buyShares}주, 예상 매수금액 ${calculated.purchaseAmount}`,
   `종목 비중 ${calculated.beforePercent}% → ${calculated.afterPercent}%`,
   `비중 기준 ${effectiveCap??"미설정"}% (${capSource}); ${calculated.capExceeded===null?"비교 없음":calculated.capExceeded?"기준 초과":"기준 이내"}`,
   `-20% 하락 시 전체 계좌 관측 순자산 대비 약 -${calculated.drawdowns.twenty}% (정적 가정)`,
   `현금 범위 ${calculated.withinCash?"이내":"초과"}; 현금 범위 내 정수주 ${calculated.maxAdditionalUnderCash}주`,
   strategy==="TECHNICAL"?(calculated.stopImpact!==null?
     `손절가 ${stop} 시 평가액 감소 추정 ${calculated.stopImpact}`:
     `손절가 계산 보류: ${calculated.stopWarning??"기준가 없음"}`):"가격 손절 위험은 계산하지 않음",
   decision.trim()?`내 판단: ${decision.trim()}`:""
 ].filter(Boolean).join(" | ").slice(0,1200):"";
 const showNote=includeReview&&calculated?scenarioNote:"";
 const dateLabel=chosen?new Date(chosen.asOf).toLocaleString("ko-KR",{
   timeZone:"Pacific/Auckland",dateStyle:"medium",timeStyle:"short"}):null;
 return <>
   <section className="plan-risk-check" aria-label={ticker+" 투자 방식과 위험 기준"}>
     <h3>1. 어떤 방식으로 투자하나요?</h3>
     <div className="journal-form-two">
       <label>투자 전략 유형
         <select name="strategyType" value={strategy}
           onChange={e=>setStrategy(e.target.value as InvestmentStrategyType|"")}>
           <option value="">미정 · 투자 이유부터 기록</option>
           <option value="LONG_TERM">장기 투자 · 투자 논리와 보유 비중 중심</option>
           <option value="TECHNICAL">가격 기준 진입 · 손절 기준도 점검</option>
           <option value="EVENT_DRIVEN">실적·이벤트 기반 · 사건 발생 시 재검토</option>
           <option value="OTHER">기타 전략</option>
         </select>
       </label>
       <label>이 종목 최대 보유 비중 (%) · 선택
         <input name="maxAllocationPct" type="text" inputMode="decimal"
           pattern="(?:[0-9]{1,3}(?:[.][0-9]{1,2})?)"
           value={maxPct} onChange={e=>setMaxPct(e.target.value)}
           placeholder={principleMaxPct?`원칙 ${principleMaxPct}% 참조`:"예: 20"}/>
       </label>
     </div>
     <p className="user-footnote">{capSource==="나의 투자 원칙"
       ?`종목별 기준을 입력하지 않으면 나의 투자 원칙 ${principleMaxPct}%를 점검할 때만 참고합니다. 종목 계획에 자동 저장하지 않습니다.`
       :"최대 비중은 매수 지시나 수익률 목표가 아니라 스스로 설정한 집중도 기준입니다."}</p>
   </section>
   <details className="data-disclosure" open={Boolean(initialStop||initialTarget)}>
     <summary>목표가·손절 기준 가격 (선택 사항 · 실제 주문 아님)</summary>
     <div className="journal-form-three">
       <label>목표가<input name="targetPrice" inputMode="decimal" type="text"
         defaultValue={initialTarget} pattern="(0|[1-9][0-9]{0,23})([.][0-9]{1,12})?"
         placeholder="미설정"/></label>
       <label>손절 기준 가격<input name="stopPrice" inputMode="decimal" type="text"
         value={stop} onChange={e=>setStop(e.target.value)}
         pattern="(0|[1-9][0-9]{0,23})([.][0-9]{1,12})?" placeholder="미설정"/></label>
       <label>가격 통화<input name="priceCurrency" value={currency}
         onChange={e=>setCurrency(e.target.value.toUpperCase())}
         maxLength={3} pattern="[A-Za-z]{3}"/></label>
     </div>
     <p className="journal-form-hint">{strategy==="LONG_TERM"
       ?"장기 투자에서는 손절가가 필수는 아닙니다. 사업 가정과 비중을 점검하는 것이 우선입니다."
       :"이 가격은 나의 판단을 기록하기 위한 기준입니다. 가격 감시·손절 주문을 자동 실행하지 않습니다."}</p>
   </details>
   <section className="plan-risk-check" aria-label={ticker+" 매수 전 위험 점검"}>
     <div>
       <h3>2. 추가 매수를 가정해 보면 <small>선택 사항 · 주문 아님</small></h3>
       <p className="user-footnote">종목 비중과 -10%·-20%·-30% 하락 시나리오를 먼저 확인합니다. 계산 결과는 참고용으로, 매수를 권장하지 않습니다.</p>
     </div>
     {reference?<div className="portfolio-scope-banner">
       <strong>Tiger 계좌 관측 참고치 · 확정 원장 아님</strong>
       <span>{dateLabel} (NZ) · {reference.accountCount}개 계좌 · {reference.currency}</span>
       <p>관측 종목 비중 {reference.heldPercent}% · 보유 평가액 {reference.heldValue} {reference.currency} · 계좌 현금 {reference.cash} {reference.currency}</p>
       <p>관측 계좌에 한정되며, 외부 계좌·다른 통화 자산은 포함되지 않습니다.</p>
     </div>:<p className="journal-form-hint" role="status">자동 합산 불가: {unavailableReason??"완전한 계좌 스냅샷이 없습니다."} 값을 모른다면 계산을 생략하고 투자계획만 저장해도 됩니다.</p>}
     <label>계산에 사용할 계좌 자료
       <select value={mode} onChange={e=>{
         const next=e.target.value as SourceMode;setMode(next);
         if(next==="tiger"&&reference)setPrice(referencePrice(reference.heldValue,reference.heldShares)??"");
         if(next==="manual")setPrice("");
         setIncludeReview(false);
       }}>
         {reference&&<option value="tiger">Tiger 관측 참고치 사용</option>}
         <option value="manual">내가 확인한 금액 직접 입력</option>
       </select>
     </label>
     {mode==="tiger"&&!sourceReady&&<p role="alert">
       투자계획 통화({priceCurrency})와 계좌 합산 통화({reference?.currency??"확인 불가"})가 다릅니다.
       환율을 임의 적용하지 않습니다. 통화를 확인하거나 직접 입력해 주세요.
     </p>}
     {mode==="manual"&&<>
       <p className="user-footnote">직접 입력은 증권사 검증이 아니며, 동일한 통화·시점의 전체 투자 기준 자금과 이미 보유한 이 종목의 평가액을 입력해야 합니다. 모르면 비워 두세요.</p>
       <div className="journal-form-two">
         <label>투자 기준 자산 총액 ({priceCurrency})
           <input type="text" inputMode="decimal" value={manualNav} onChange={e=>setManualNav(e.target.value)} placeholder="예: 10000"/></label>
         <label>매수에 사용할 수 있는 현금 ({priceCurrency})
           <input type="text" inputMode="decimal" value={manualCash} onChange={e=>setManualCash(e.target.value)} placeholder="예: 2000"/></label>
         <label>기존 {ticker} 평가액 ({priceCurrency})
           <input type="text" inputMode="decimal" value={manualValue} onChange={e=>setManualValue(e.target.value)} placeholder="보유하지 않으면 0"/></label>
         <label>기존 {ticker} 보유 수량 (주)
           <input type="text" inputMode="decimal" value={manualShares} onChange={e=>setManualShares(e.target.value)} placeholder="보유하지 않으면 0"/></label>
       </div>
     </>}
     <div className="journal-form-two">
       <label>가정할 매수가 ({priceCurrency})
         <input type="text" inputMode="decimal" value={price}
           onChange={e=>setPrice(e.target.value)} placeholder="예: 420"/></label>
       <label>추가 매수를 가정할 수량 (주) · 0주도 가능
         <input type="text" inputMode="decimal" value={buyShares}
           onChange={e=>setBuyShares(e.target.value)} placeholder="예: 3"/>
       </label>
     </div>
     <div className="plan-quantity-presets" aria-label="추가 매수량 빠른 선택">
       <span>빠른 비교</span>
       {[0,1,3,5,10].map(q=><button key={q} type="button"
         className={buyShares===String(q)?"plan-quantity-active":""}
         aria-pressed={buyShares===String(q)}
         onClick={()=>setBuyShares(String(q))}>{q}주</button>)}
     </div>
     {sourceReady&&reference&&<p className="user-footnote">
       {price?"초기 매수가는 기존 종목의 관측 평가액÷보유 수량으로 추정한 참고가격을 사용했습니다. 필요하면 변경하세요.":"이 종목의 기존 보유 수량이 확인되지 않아 예상 매수가를 직접 입력해야 합니다."}
       {" "}현재 실시간 주가가 아닙니다.</p>}
     {!scenario?<p className="journal-form-hint" role="status">기준 자료와 가정할 가격·수량을 입력하면 결과가 나타납니다. 추가 매수를 하지 않는 경우 0주 상태로 현재 위험만 비교할 수 있습니다.</p>:
       scenario.state==="INVALID"?<p role="alert">{scenario.reason}</p>:
       <div className="plan-scenario-result" role="status">
         <div className="account-summary-values portfolio-account-values">
           <div><small>예상 매수에 필요한 금액</small><strong>{scenario.purchaseAmount} {priceCurrency}</strong></div>
           <div><small>해당 종목 비중 변화</small><strong>{scenario.beforePercent}% → {scenario.afterPercent}%</strong></div>
           <div><small>매수 후 남는 현금 (가정)</small><strong>{scenario.cashLeft} {priceCurrency}</strong></div>
           <div><small>보유 평가액 합계 (가정)</small><strong>{scenario.afterPositionValue} {priceCurrency}</strong></div>
         </div>
         {!scenario.withinCash&&<p className="plan-risk-warning" role="alert">계산상 매수 금액이 입력한 가용 현금보다 큽니다. 차입이나 추가 입금은 가정하지 않았습니다.</p>}
         {scenario.capExceeded!==null?<p className={scenario.capExceeded?"plan-risk-warning":"journal-form-hint"}>
           {capSource} 기준 {scenario.capReference}% 대비 {scenario.capExceeded?
             "추가 매수 후 예상 비중이 기준을 초과합니다.":"추가 매수 후 예상 비중이 기준 이내입니다."}
           {" "}비중 기준만 고려한 정수주 계산 상한은 {scenario.maxAdditionalUnderCap}주입니다.
         </p>:<p className="journal-form-hint">단일 종목 최대 비중을 설정하면 본인의 계획과 비교할 수 있습니다.</p>}
         <p className="journal-form-hint">
           입력한 현금만 고려한 정수주 상한은 {scenario.maxAdditionalUnderCash}주입니다.
           {scenario.maxAdditionalWithinLimits!==null
             ?` 현금과 최대 비중을 모두 고려한 산술 상한은 ${scenario.maxAdditionalWithinLimits}주입니다.`
             :" 최대 보유 비중이 미설정되어 통합 상한을 계산하지 않습니다."}
           {" "}이는 권장 매수량이 아니며, 주문 단위·수수료·여유 현금을 고려하지 않은 단순 계산입니다.
         </p>
         <h4>이 종목만 하락한다면 전체 계좌 기준 영향은?</h4>
         <div className="plan-drawdown-grid">
           <div><small>종목 -10%</small><strong>-{scenario.drawdowns.ten}%</strong><small>매수 전 -{scenario.beforeDrawdowns.ten}%</small></div>
           <div><small>종목 -20%</small><strong>-{scenario.drawdowns.twenty}%</strong><small>매수 전 -{scenario.beforeDrawdowns.twenty}%</small></div>
           <div><small>종목 -30%</small><strong>-{scenario.drawdowns.thirty}%</strong><small>매수 전 -{scenario.beforeDrawdowns.thirty}%</small></div>
         </div>
         {strategy==="TECHNICAL"&&<p className="journal-form-hint">
           {scenario.stopImpact!==null?
             `손절 기준가 ${stop} ${priceCurrency}까지 내려가면 관측 평가액 및 가정 매수가 대비 약 ${scenario.stopImpact} ${priceCurrency} 감소하는 시나리오입니다.`:
             scenario.stopWarning??"손절 기준가를 작성하면 해당 기준까지의 평가액 감소를 추가로 살펴볼 수 있습니다."}
         </p>}
         <p className="journal-limit">하락 계산은 다른 종목·현금·환율이 일정하고 위 수량을 계획대로 매수했다는 정적 가정입니다.
           실제 손익·실현손실·주문 가능 수량·전체 재산 비중이 아닙니다. 갭 하락과 수수료·세금은 반영하지 않습니다.</p>
       </div>}
     <div className="plan-risk-decision">
       <label className="journal-confirm">
         <input type="checkbox" checked={includeReview} onChange={e=>setIncludeReview(e.target.checked)} disabled={!calculated}/>
         이번 가정과 내 판단을 투자계획 변경 이력에 함께 기록
       </label>
       {includeReview&&calculated&&<>
         <label>이번 계획에서 주의할 점 (직접 작성 · 선택)
           <textarea rows={2} maxLength={240} value={decision} onChange={e=>setDecision(e.target.value)}
             placeholder="예: 이 종목의 비중이 높아져 새 매수는 보류하고 다음 분기에 검토한다."/>
         </label>
         <p className="journal-form-hint">아래 요약을 이번 계획의 사용자 판단 기록으로 저장합니다. 자동 체결 또는 증권사 검증으로 간주하지 않습니다.</p>
         <p className="plan-risk-note-preview">{scenarioNote}</p>
       </>}
       <input name="riskDecisionNote" type="hidden" value={showNote}/>
     </div>
   </section>
 </>;
}
