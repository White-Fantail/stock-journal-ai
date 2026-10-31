import Link from "next/link";
import type {TigerPersonalRead} from "../../../lib/tiger-api";
import type {JournalPlan,RiskFactorRevision} from "../../../lib/saas-trades-api";
import {portfolioReviewQueue,type PortfolioReviewAction} from "../../../lib/portfolio-review-actions";
import {assessPortfolioOverviewRisk} from "../../../lib/portfolio-overview-risk";

const priorityLabel={FIRST:"우선 확인",NEXT:"계획 보완",OPTIONAL:"선택 점검"};

function ReviewItem({item}:{item:PortfolioReviewAction}){
 return <article className="portfolio-review-item">
   <div className="portfolio-review-copy">
     <div className="portfolio-review-meta">
       <span>{priorityLabel[item.priority]}</span>
       {item.observedTigerPct!==null&&<span>
         Tiger 관측 순자산 대비 {item.observedTigerPct}%
       </span>}
       {item.kind==="COMPARE"&&item.personalMaxAllocationPct!==null&&<span>
         내가 정한 최대 비중 {item.personalMaxAllocationPct}%
       </span>}
     </div>
     <h3>{item.title}</h3>
     <p>{item.description}</p>
   </div>
   <Link className="btn btn-outline" href={item.href}>{item.actionLabel} →</Link>
 </article>;
}

export function PortfolioAttention({personal,plans,factors}:{
 personal:TigerPersonalRead;plans:readonly JournalPlan[]|null;
 factors:readonly RiskFactorRevision[]|null;
}){
 const queue=portfolioReviewQueue({personal,plans,factors});
 const risk=assessPortfolioOverviewRisk(personal,plans);
 const asOf=queue.asOf&&Number.isFinite(Date.parse(queue.asOf))?
   new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",dateStyle:"medium",
     timeStyle:"short"}).format(new Date(queue.asOf)):null;
 const top=queue.actions.slice(0,5);
 const remaining=queue.actions.slice(5);
 return <section className="user-panel portfolio-focus" aria-label="투자 판단을 위한 다음 점검">
   <div className="user-panel-head">
     <div>
       <h2>다음에 확인할 투자 판단</h2>
       <p className="user-footnote">내 보유종목과 직접 작성한 계획의 차이를 확인하고, 각 종목에서 바로 기록할 수 있습니다.</p>
     </div>
     <Link href="/private/review">점검 센터 →</Link>
   </div>
   <div className="portfolio-review-progress" aria-label="보유종목별 작성 현황">
     <div><small>관측 보유종목</small><strong>{queue.holdingCount===null?"조회 확인 필요":queue.holdingCount+"개"}</strong></div>
     <div><small>투자계획 작성</small><strong>{queue.plannedCount===null||queue.holdingCount===null?"조회 확인 필요":queue.plannedCount+" / "+queue.holdingCount}</strong></div>
     <div><small>위험 요인 분류</small><strong>{queue.classifiedCount===null||queue.holdingCount===null?"조회 확인 필요":queue.classifiedCount+" / "+queue.holdingCount}</strong></div>
   </div>
   {top.length?<div className="portfolio-review-list">
     {top.map(item=><ReviewItem item={item} key={item.id}/>)}
   </div>:<p className="user-footnote">
     현재 확인 가능한 범위에서는 추가로 제안할 기록 항목이 없습니다. 투자 위험이 없다는 의미는 아닙니다.
   </p>}
   {remaining.length>0&&<details className="portfolio-review-more">
     <summary>다른 점검 제안 {remaining.length}건 더 보기</summary>
     <div className="portfolio-review-list">
       {remaining.map(item=><ReviewItem item={item} key={item.id}/>)}
     </div>
   </details>}
   <p className="journal-limit portfolio-review-footnote">
     출처: Tiger 보유종목 관측 · 확정 투자 원장 아님.
     {risk.state==="READY"&&asOf?
       " 같은 통화·시점의 Tiger 계좌 기준 "+asOf+" (NZ) 참고 비중입니다.":
       " 통합 비중 비교가 불가능하면 종목별 비중과 한도 비교는 표시하지 않습니다."}
     {" "}외부 증권사·은행·비상장 자산은 포함하지 않으며, 참고 비중은 전체 재산 대비 비중이나 투자계획 준수 판정이 아닙니다.
     제안은 자동 주문이나 매매 신호가 아닙니다.
   </p>
 </section>;
}
