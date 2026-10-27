import Link from "next/link";
import type {TigerPersonalRead} from "../../../lib/tiger-api";
import type {JournalPlan,RiskFactorRevision} from "../../../lib/saas-trades-api";
import {portfolioReviewActions} from "../../../lib/portfolio-review-actions";
import {assessPortfolioOverviewRisk} from "../../../lib/portfolio-overview-risk";

export function PortfolioAttention({personal,plans,factors}:{
 personal:TigerPersonalRead;plans:readonly JournalPlan[]|null;
 factors:readonly RiskFactorRevision[]|null;
}){
 const actions=portfolioReviewActions({personal,plans,factors});
 const risk=assessPortfolioOverviewRisk(personal,plans);
 const dates=personal.accounts.map(a=>a.asOf).filter((v):v is string=>
   !!v&&Number.isFinite(Date.parse(v)));
 const asOf=dates.length===personal.accounts.length&&dates.length?
   new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",dateStyle:"medium",
     timeStyle:"short"}).format(new Date(Math.min(...dates.map(v=>Date.parse(v))))):null;
 return <section className="user-panel portfolio-focus" aria-label="내 포트폴리오의 다음 점검">
   <div className="user-panel-head">
     <div><h2>내 보유 위험, 무엇부터 점검할까요?</h2>
       <p className="user-footnote">투자 원칙을 실천하기 위한 참고 질문입니다. 매도·매수 지시가 아닙니다.</p></div>
     <Link href="/private/principles">내 투자 원칙 →</Link>
   </div>
   <div className="portfolio-scope-banner">
     <strong>출처: Tiger 계좌 관측 · 확정 투자 원장 아님</strong>
     <span>{personal.accounts.length}개 조회 계좌 · 기준 시각 {asOf??"전체 확인 불가"} (NZ) ·
       {risk.state==="READY"?"동일 통화·시점 조건으로 계좌 내 비중 비교 가능":
       "통합 비중 비교 보류"}</span>
     <p>개인 외부 자산, 검증되지 않은 환율·수익률은 포함하지 않습니다.
       계좌 자료는 전체 재산이나 원칙 준수를 증명하지 않습니다.</p>
   </div>
   {actions.length?<div className="portfolio-action-grid">
     {actions.map(a=><article className="portfolio-action-card" key={a.id}>
       <h3>{a.title}</h3><p>{a.description}</p>
       <Link href={a.href} className="btn btn-outline">{a.kind==="CHECK"?"상태 확인":
         a.kind==="FACTOR"?"위험 요인 기록":"투자 계획 작성"} →</Link>
     </article>)}
   </div>:<p className="user-footnote">현재 조회 범위에서 추가로 제안할 미작성 항목이 없습니다.
       실제 위험이나 빠진 자산이 없다는 의미는 아닙니다.</p>}
 </section>;
}
