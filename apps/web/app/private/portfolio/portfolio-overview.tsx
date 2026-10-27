import Link from "next/link";
import {formatDecimal} from "../../../lib/format-decimal";
import {assessPortfolioOverviewRisk} from "../../../lib/portfolio-overview-risk";
import type {TigerPersonalRead} from "../../../lib/tiger-api";
import type {JournalPlan} from "../../../lib/saas-trades-api";

/** A snapshot-based asset risk lens. Unverified broker transaction coverage
 * and third-party accounts are never promoted to a complete portfolio.
 */
export function PortfolioOverview({personal,plans}:{
 personal:TigerPersonalRead;plans:readonly JournalPlan[]|null
}){
 const risk=assessPortfolioOverviewRisk(personal,plans);
 return <section className="user-panel" aria-label="전체 계좌 통합 위험 참고">
   <div className="user-panel-head">
     <div><h2>여러 Tiger 계좌 통합 위험</h2>
       <p className="user-footnote">순자산·현금·종목을 포함한 읽기 전용 참고 현황</p></div>
     <Link href="/private/risk">위험 계산기 →</Link>
   </div>
   {risk.state==="UNAVAILABLE"?<>
     <div className="state-panel" role="status">
       <strong>통합 비중 계산 보류</strong>
       <p>{risk.reason}</p>
       <p>계좌별 확인 가능한 항목은 아래에서 계속 볼 수 있습니다.
         확인되지 않은 평가액이나 환율을 0으로 대체하지 않습니다.</p>
     </div>
   </>:<>
     <p className="user-footnote">동일 통화 {risk.currency}로 표시된 Tiger 계좌 {risk.accountCount}개를
       사용했습니다. 모든 계좌 스냅샷은 1시간 이내 시점이며, 순자산과 현금·보유 평가액이
       각 계좌에서 반올림 허용 범위 내에 일치합니다.</p>
     <div className="account-summary-values portfolio-account-values">
       <div><small>관측 계좌 순자산 합계</small><strong>{formatDecimal(risk.nav)} {risk.currency}</strong></div>
       <div><small>현금</small><strong>{formatDecimal(risk.cash)} {risk.currency} · {risk.cashPct}%</strong></div>
       <div><small>보유 종목 평가액</small><strong>{formatDecimal(risk.invested)} {risk.currency} · {risk.investedPct}%</strong></div>
       <div><small>가장 큰 종목 비중</small><strong>{risk.largestTickerPct}%</strong></div>
       <div><small>상위 두 종목 비중</small><strong>{risk.topTwoTickerPct}%</strong></div>
     </div>
     <div className="user-panel-head"><h3>종목별 계좌 합산 비중</h3>
       <Link href="/private/journal">개인 투자계획 →</Link></div>
     {risk.positions.length===0?<p className="user-footnote">계좌에 표시된 보유 종목이 없습니다.
       총자산 보유 여부를 의미하지는 않습니다.</p>:<div className="user-list">
       {risk.positions.map(item=><div className="user-list-row portfolio-overview-row" key={item.ticker}>
         <div><strong><Link href={"/private/journal?ticker="+encodeURIComponent(item.ticker)}>
           {item.ticker}</Link></strong>
           <small>관측 평가액 {formatDecimal(item.marketValue)} {risk.currency}
             {" · "}{item.accounts}개 Tiger 계좌</small></div>
         <div className="user-list-value">
           <strong>{item.observedTigerPct}%</strong>
           <small>내 최대 비중: {item.personalMaxAllocationPct===null?"미설정":item.personalMaxAllocationPct+"%"}</small>
           {item.aboveObservedTigerReference!==null&&<small>
             {item.aboveObservedTigerReference?"Tiger 관측 합계가 내 계획 수치보다 높음":
               "Tiger 관측 합계가 내 계획 수치 이하"}
           </small>}
         </div>
       </div>)}
     </div>}
     <p className="journal-limit">계좌 기준: {new Intl.DateTimeFormat("ko-KR",{
       timeZone:"Pacific/Auckland",dateStyle:"medium",timeStyle:"short",
     }).format(new Date(risk.asOf))} (가장 이른 스냅샷).
       외부 증권사·은행·비상장 자산은 포함하지 않았습니다.
       이 값은 동기화된 Tiger 계좌 스냅샷의 위험 참고치이며,
       검증된 거래 원장·전체 재산 또는 객관적인 투자계획 준수 판정이 아닙니다.
       실제 주문·자동 매매·시세 감시 기능과 연결되지 않습니다.</p>
   </>}
 </section>;
}
