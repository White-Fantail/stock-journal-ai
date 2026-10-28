import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {formatDecimal} from "../../../lib/format-decimal";
import { currentWorkspace } from "../../../lib/require-workspace";
import { tigerPersonalRead } from "../../../lib/tiger-api";
import { PersonalPortfolioBlock } from "../tiger/personal-preview";
import {assessConcentration} from "../../../lib/portfolio-risk";
import {assessAccountPolicyReference} from "../../../lib/allocation-policy";
import {PortfolioOverview} from "./portfolio-overview";
import {PortfolioAttention} from "./portfolio-attention";
import {fetchJournalPlans,fetchUserRiskFactors,type JournalPlan} from "../../../lib/saas-trades-api";
import {auth} from "../../../auth";
import type {TigerPersonalRead} from "../../../lib/tiger-api";
import { tigerStatus, tigerSyncStatus, tigerReviewStatus, tigerLedgerRead, type TigerReviewAccount, type TigerReviewStatus, type TigerAccount, type TigerSyncJob, type TigerStatus, type TigerSyncStatus, type TigerLedgerRead, type VerifiedBrokerPosition } from "../../../lib/tiger-api";

export const metadata:Metadata={title:"포트폴리오 · Positionary"};
export const dynamic="force-dynamic";

const issueText:Record<string,string>={
  HISTORY_COVERAGE_UNVERIFIED:"전체 거래이력 범위 미확인",
  PAGE_COVERAGE_UNVERIFIED:"페이지 범위 미확인",
  FEE_UNKNOWN:"수수료 미확인",
  CURRENCY_UNVERIFIED:"거래 통화 미확인",
  TIME_UNVERIFIED:"체결 시간대 미확인",
  PROVIDER_PARTIAL:"부분 수집",
  REAUTH_REQUIRED:"재인증 필요",
  CURSOR_LOOP:"페이지 반복 오류",
  PAGE_LIMIT:"페이지 처리 제한",
  INDEPENDENT_ATTESTATION_REQUIRED:"독립적인 이력 검증 증명이 필요합니다.",
  HISTORY_GAP:"거래이력 수집 구간 누락",
  SOURCE_VERSION_CONFLICT:"원본 거래 버전 충돌",
  POTENTIAL_DUPLICATE_FILL:"중복 체결 가능성",
  POSITION_QUANTITY_MISMATCH:"증권사 보유수량과 원장이 일치하지 않음",
  ORDERS_UNVERIFIED:"주문 내역 검증 필요",
  CASH_ACTIVITY_UNVERIFIED:"현금거래 내역 검증 필요",
  CORPORATE_ACTIONS_UNVERIFIED:"기업행동 검증 필요",
};

function timeLabel(raw:string|null):string {
  if(!raw) return "정보 없음";
  const t=new Date(raw);
  if(!Number.isFinite(t.valueOf())) return "정보 없음";
  return new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",dateStyle:"medium",timeStyle:"short"}).format(t);
}

/** A released historical native-currency FIFO view, NEVER a live quotation.
 *  Every row comes from the server-side signed, rechecked release. Unknown
 *  valuations and unrealized return remain visibly UNKNOWN.
 */
function VerifiedAccountSnapshot({account,proof,positions,truncated}:{
  account:TigerAccount;
  proof:Extract<TigerLedgerRead["accounts"][number],{state:"VERIFIED"}> | TigerLedgerRead["accounts"][number];
  positions:readonly VerifiedBrokerPosition[];
  truncated:boolean;
}) {
  return <section className="state-panel portfolio-account" aria-label={account.alias+" 검증 원장"}>
    <div className="sync-head">
      <div><span className="breadcrumb">Tiger Brokers · 독립 검증 원장</span><h2>{account.alias}</h2></div>
      <span className="pill pill-neutral">검증 버전 v{proof.version}</span>
    </div>
    <p>검증된 과거 원장 기준 값이며 현재 시세 기반 평가는 아닙니다.</p>
    <p className="sync-subtle">원장 기준 시각: {timeLabel(proof.asOf??null)} · FIFO · 종목별 원본 통화</p>
    <div className="portfolio-unknown-grid">
      <div><small>현재 평가액</small><strong>미확인</strong></div>
      <div><small>미실현손익</small><strong>미확인</strong></div>
      <div><small>계좌 총수익률</small><strong>미확인</strong></div>
    </div>
    {positions.length>0 ? <>
      <div className="mobile-data-cards" aria-label="검증된 포트폴리오 모바일 목록">
        {positions.map(p=><article className="mobile-data-card" key={p.symbol+":"+p.currency}>
          <div className="mobile-data-card-head">
            <strong><Link href={"/private/journal?ticker="+encodeURIComponent(p.symbol)}>{p.symbol}</Link></strong>
            <small>{p.currency} · 검증 v{proof.version}</small>
          </div>
          <dl className="mobile-data-card-fields">
            <div><dt>검증 수량</dt><dd>{formatQuantity(p.quantity)}주</dd></div>
            <div><dt>남은 FIFO 원가</dt><dd>{formatMoney(p.costBasis)} {p.currency}</dd></div>
            <div><dt>누적 실현손익</dt><dd>{formatMoney(p.realizedPnl)} {p.currency}</dd></div>
          </dl>
        </article>)}
      </div>
      <div className="portfolio-verified-scroll desktop-data-table">
      <table className="portfolio-verified-table">
        <thead><tr><th scope="col">종목</th><th scope="col">검증된 수량</th>
          <th scope="col">남은 취득원가</th><th scope="col">누적 실현손익</th></tr></thead>
        <tbody>{positions.map(p=><tr key={p.symbol+":"+p.currency}>
          <th scope="row"><Link href={"/private/journal?ticker="+encodeURIComponent(p.symbol)}>{p.symbol}</Link></th>
          <td>{formatQuantity(p.quantity)}주</td>
          <td>{formatMoney(p.costBasis)} {p.currency}</td>
          <td>{formatMoney(p.realizedPnl)} {p.currency}</td>
        </tr>)}</tbody>
      </table>
    </div></> : <p className="sync-subtle">현재 표시 가능한 검증 포지션이 없습니다. 계좌 자산이 0이라는 의미는 아닙니다.</p>}
    {truncated && <p role="status" className="sync-subtle">
      조회 상한으로 일부 종목이나 체결이 생략되었을 수 있습니다. 이 표를 전체 계좌 합계로 사용하지 마세요.
    </p>}
    <p className="sync-subtle">취득원가는 남아 있는 FIFO 매수 원가입니다. 실현손익은 동일 종목·통화 내 검증된 매도 결과에만 해당합니다.
      다른 통화끼리 합산하지 않으며, 현재 시세·배당·세금·환산 손익은 이 표에 포함하지 않습니다.</p>
    <Link href="/private/journal" className="btn btn-outline">검증 체결과 나의 투자일지 보기 →</Link>
  </section>;
}

function AccountReadiness({account,connection,job,review}:{
  account:TigerAccount;connection:string;job:TigerSyncJob|null;review:TigerReviewAccount|null
}) {
  const connected=connection==="CONNECTED";
  const issues=job?.issueCodes.filter(c=>c in issueText) ?? [];
  return <section className="state-panel portfolio-account" aria-label={account.alias+" 포트폴리오 검증 상태"}>
    <div className="sync-head">
      <div><span className="breadcrumb">Tiger Brokers</span><h2>{account.alias}</h2></div>
      <span className="pill pill-warning">{!connected?"연결 확인 필요": "데이터 검증 대기"}</span>
    </div>
    <p>이 계좌는 아직 검증된 평가 정보를 제공하지 않습니다. 수집·검증 현황은 아래에서 확인할 수 있습니다.</p>
    <div className="portfolio-unknown-grid">
      <div><small>보유 자산 평가액</small><strong>미확인</strong></div>
      <div><small>취득원가</small><strong>미확인</strong></div>
      <div><small>실현·미실현 손익</small><strong>미확인</strong></div>
    </div>
    <details className="portfolio-readiness-details">
      <summary>검증·수집 상태 자세히 보기</summary>
    <div className="portfolio-checks" aria-label="검증 요건">
      <span>전체 거래이력 <b>미검증</b></span>
      <span>수수료·통화 <b>미검증</b></span>
      <span>기업행동·현금활동 <b>미검증</b></span>
      <span>브로커 보유수량 대조 <b>미검증</b></span>
    </div>
    {job ? <>
      <p className="sync-subtle">최근 수집 작업: {timeLabel(job.updatedAt)} · {job.processedWindows}/{job.totalWindows}구간 처리 · 이력 완전성 미검증</p>
      {issues.length>0 && <p className="sync-subtle">확인할 내용: {issues.slice(0,3).map(c=>issueText[c]).join(" · ")}</p>}
    </> : <p className="sync-subtle">이 계좌에서 시작된 과거 거래내역 수집 작업이 확인되지 않았습니다.</p>}
    {review && <div className="sync-issues">
      <h3>최근 검증 이력 · v{review.version}</h3>
      <p className="sync-subtle">{review.state==="STAGED"?"수집원장 비공개 준비 완료 · 사용자 포트폴리오 미공개":"검증 문제 발견 · 수정 후 재검증 필요"} · {timeLabel(review.createdAt)}</p>
      <p className="sync-subtle">연결된 원본 증거: {review.sourceEvidenceCount}건 · 증거 추적 정보만 표시</p>
      {review.issues.length>0 && <ul>{review.issues.map(issue=>
        <li key={issue.code}>
          <strong>{({
            COVERAGE:"이력 범위",EXECUTION:"체결 기록",FEES:"수수료",
            CORPORATE_ACTION:"기업행동",CASH:"현금 거래",SNAPSHOT:"보유수량",
            AUTHORIZATION:"검증 승인",INTEGRITY:"데이터 무결성"
          } as Record<string,string>)[issue.category]??"추가 검증"} · {issue.severity==="BLOCKER"?"확인 필요":"검토 권장"}</strong>
          {" — "}{issueText[issue.code]??"추가로 확인해야 할 거래내역 검증 항목이 있습니다."}
        </li>)}</ul>}
    </div>}
    </details>
    <Link href="/private/tiger/sync" className="btn btn-outline">수집 및 오류 상태 확인 →</Link>
  </section>;
}

/** Explicitly scoped to each account: do not combine different currencies or as-of dates. */
function PortfolioConcentration({data,plans}:{data:TigerPersonalRead;plans:readonly JournalPlan[]|null}){
  return <section className="user-panel" aria-label="보유 종목 집중도">
    <div className="user-panel-head">
      <h2>보유 종목 집중도</h2>
      <Link href="/private/journal/new?mode=plan">투자 매수 전 위험 점검 →</Link>
    </div>
    <p className="user-footnote">기존 Tiger 계좌 스냅샷의 보유 종목 평가액만으로 계산한 참고 비중입니다.
      현금·다른 계좌·다른 통화를 합산하지 않습니다. 수익률이나 매매 신호가 아닙니다.</p>
    {data.readWarnings?.length?<p role="status">조회된 정보에 오류가 있어 집중도 계산을 보류합니다.</p>:
      data.accounts.map((account,index)=>{
        const result=assessConcentration(account);
        const policy=data.readWarnings?.length?null:assessAccountPolicyReference(account,plans);
        return <div key={account.alias+":"+index} className="account-summary-item">
          <div className="account-summary-head"><strong>{account.alias}</strong>
            <small>{timeLabel(account.asOf)} 기준</small></div>
          {result.status==="UNAVAILABLE"?<p className="user-footnote">{result.reason}</p>:<>
            <div className="account-summary-values portfolio-account-values">
              <div><small>최대 단일 종목 비중</small><strong>{formatPercent(result.largestPercent)}%</strong></div>
              <div><small>상위 두 종목 비중</small><strong>{formatPercent(result.topTwoPercent)}%</strong></div>
              <div><small>기준 통화</small><strong>{result.currency}</strong></div>
            </div>
            <div className="user-list">
              {result.positions.map(position=><Link className="user-list-row" key={position.symbol}
                href={"/private/journal?ticker="+encodeURIComponent(position.symbol)}>
                <strong>{position.symbol}</strong><strong>{formatPercent(position.percent)}%</strong>
              </Link>)}
            </div>
            <p className="user-footnote">위 비중의 분모는 확인된 보유 주식의 평가액 합계입니다. 현금이나 순자산 대비 비중은 아닙니다.
              집중도가 높다고 반드시 매도해야 하는 것은 아니며, 개인의 위험 한도에 비춰 검토해야 합니다.</p>
          </>}
          <div className="user-panel-head" style={{marginTop:18}}>
            <h3>내 최대 비중 계획과 비교</h3>
            <Link href="/private/journal">계획 관리 →</Link>
          </div>
          {policy===null?<p className="user-footnote">Tiger 조회 오류가 있어 계좌 순자산 기준 비교를 보류합니다.</p>:
            policy.state==="UNAVAILABLE"?<p className="user-footnote">{policy.reason}</p>:<>
              <p className="user-footnote">Tiger 동일 계좌 순자산({policy.accountCurrency}) 대비 참고 비중입니다.
                계획의 최대 보유 비중은 전체 투자 포트폴리오 기준일 수 있어, 아래 비교만으로 한도 위반이나 매매 필요성을 판정하지 않습니다. 비중은 소수 둘째 자리로 표시하되 내부 비교는 반올림 전 정확한 수치로 수행합니다.</p>
              <div className="user-list">
                {policy.positions.map(p=><div className="user-list-row" key={p.ticker}>
                  <div><strong><Link href={"/private/journal?ticker="+encodeURIComponent(p.ticker)}>{p.ticker}</Link></strong>
                    <small>계좌 순자산 대비 {formatPercent(p.observedAccountPct)}%</small></div>
                  <div className="user-list-value">
                    <strong>{p.personalPortfolioLimitPct===null?"최대 비중 미설정":"계획 "+formatPercent(p.personalPortfolioLimitPct)+"%"}</strong>
                    <small>{p.exceedsAccountReference===null?"계획 비교 보류":
                      p.exceedsAccountReference?"계좌 기준 참고 비중이 계획 수치보다 높음":"계좌 기준 참고 비중이 계획 수치 이하"}</small>
                  </div>
                </div>)}
              </div>
              <p className="user-footnote">이 값은 {timeLabel(policy.asOf)}의 계좌 자산 스냅샷에만 해당합니다.
                다른 계좌·통화·외부 자산이나 검증되지 않은 환율을 합산하지 않았습니다. 전체 포트폴리오 정책 준수 여부는 미확인입니다.</p>
            </>}
        </div>;
      })}
  </section>;
}

export default async function PortfolioPage() {
  const [workspace,session]=await Promise.all([currentWorkspace(),auth()]);
  if(!workspace||!session?.user?.id) redirect("/login");
  const [accountResult,planResult,factorResult]=await Promise.allSettled([
    tigerPersonalRead(),fetchJournalPlans(session.user.id),fetchUserRiskFactors(session.user.id),
  ]);
  const personal=accountResult.status==="fulfilled"?accountResult.value:null;
  const plans=planResult.status==="fulfilled"?planResult.value:null;
  const userFactors=factorResult.status==="fulfilled"?factorResult.value:null;
  if(personal && personal.accounts.length>0) return <main className="portfolio-data">
    <div className="page-intro home-data-heading">
      <div><h1>포트폴리오</h1><p>내 보유 현황에서 투자 집중도와 계획을 먼저 살펴보세요.</p></div>
      <div className="home-actions">
        <Link className="btn btn-primary" href="/private/journal">종목별 투자 계획 →</Link>
        <Link className="btn btn-outline" href="/private/journal/new?mode=plan">매수 전 위험 점검</Link>
      </div>
    </div>
    <PortfolioAttention personal={personal} plans={plans} factors={userFactors}/>
    <PortfolioOverview personal={personal} plans={plans} factors={userFactors}/>
    <section className="user-panel">
      <div className="user-panel-head"><h2>계좌별 보유 내역</h2>
        <Link href="/private/trades">원본 거래 기록 →</Link></div>
      <p className="user-footnote">실제 Tiger 계좌에서 조회한 값이며, 거래이력 전체의 검증이나 현재 투자 성과 확정은 아닙니다.</p>
      <PersonalPortfolioBlock data={personal}/>
    </section>
    <details className="portfolio-technical-details user-panel">
      <summary>계좌별 집중도와 검증 범위 자세히 보기</summary>
      <PortfolioConcentration data={personal} plans={plans}/>
    </details>
  </main>;
  const [links,history,reviews,brokerLedger]=await Promise.allSettled([tigerStatus(),tigerSyncStatus(),tigerReviewStatus(),tigerLedgerRead()]);
  const accountState:TigerStatus|null=links.status==="fulfilled"?links.value:null;
  const historyState:TigerSyncStatus|null=history.status==="fulfilled"?history.value:null;
  const reviewState:TigerReviewStatus|null=reviews.status==="fulfilled"?reviews.value:null;
  const ledgerState:TigerLedgerRead|null=brokerLedger.status==="fulfilled"?brokerLedger.value:null;
  const accounts=accountState?.accounts ?? [];
  const connectionById=new Map(accountState?.connections.map(c=>[c.id,c.status])??[]);
  const latestJob=new Map<string,TigerSyncJob>();
  const latestReview=new Map((reviewState?.accounts??[]).map(r=>[r.accountId,r]));
  for(const job of historyState?.jobs ?? []) {
    if(!latestJob.has(job.accountId)) latestJob.set(job.accountId,job);
  }
  return <main>
    <div className="page-intro home-data-heading"><div>
      <span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
      <h1>포트폴리오</h1><p>연결 계좌와 보유 현황을 확인합니다.</p>
    </div><Link className="btn btn-outline" href="/private/brokers">계좌 관리</Link></div>
    {accountState===null || historyState===null || reviewState===null ? <section className="state-panel" role="alert">
      <span className="pill pill-warning">조회 불가</span>
      <h2>포트폴리오 준비 상태를 확인할 수 없습니다.</h2>
      <p>계좌 연결 또는 동기화 서버에 접근하지 못했습니다. 연결되지 않았다고 단정하거나 포트폴리오를 0으로 표시하지 않습니다.</p>
      <div className="home-actions"><Link href="/private/portfolio" className="btn btn-outline">다시 확인</Link>
        <Link href="/private/journal" className="btn btn-primary">내 투자계획 확인 →</Link></div>
    </section> : accounts.length===0 ? <section className="state-panel">
      <span className="pill pill-neutral">연결된 계좌 없음</span>
      <h2>연결된 계좌가 아직 없습니다.</h2>
      <p>증권사를 연결하지 않아도 관심 종목의 투자 이유와 위험 기준을 작성할 수 있습니다.
        공식 승인이 필요한 계좌 연결은 별도 진행됩니다.</p>
      <div className="home-actions">
        <Link href="/private/journal/new?mode=plan" className="btn btn-primary">첫 종목 투자계획 작성 →</Link>
        <Link href="/private/tiger" className="btn btn-outline">Tiger 연동 상태 보기</Link>
      </div>
    </section> : <>
      <div className="dashboard-heading"><h2>계좌별 검증 상태</h2><span className="pill pill-neutral">{accounts.length}개 계좌</span></div>
      <div className="sync-jobs">{accounts.map(account=>{
        const proof=ledgerState?.readEnabled
          ? ledgerState.accounts.find(a=>a.accountId===account.id && a.state==="VERIFIED") : undefined;
        const active=connectionById.get(account.connectionId)==="CONNECTED";
        return proof && active ? <VerifiedAccountSnapshot
          key={account.id} account={account} proof={proof}
          positions={ledgerState?.positions.filter(p=>p.accountId===account.id)??[]}
          truncated={ledgerState?.truncated??false}/>
          : <AccountReadiness key={account.id} account={account}
            connection={connectionById.get(account.connectionId)??"UNKNOWN"}
            job={latestJob.get(account.id)??null} review={latestReview.get(account.id)??null}/>;
      })}</div>
    </>}

  </main>;
}
