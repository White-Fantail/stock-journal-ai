import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentWorkspace } from "../../../lib/require-workspace";
import { tigerStatus, tigerSyncStatus, tigerReviewStatus, type TigerReviewAccount, type TigerReviewStatus, type TigerAccount, type TigerSyncJob, type TigerStatus, type TigerSyncStatus } from "../../../lib/tiger-api";

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
    <p>이 계좌의 보유수량과 수익률을 표시하려면 전체 체결이력, 수수료, 기업행동 및 증권사 보유현황 대조가 필요합니다.</p>
    <div className="portfolio-unknown-grid">
      <div><small>보유 자산 평가액</small><strong>미확인</strong></div>
      <div><small>취득원가</small><strong>미확인</strong></div>
      <div><small>실현·미실현 손익</small><strong>미확인</strong></div>
    </div>
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
      {review.issues.length>0 && <ul>{review.issues.map(code=>
        <li key={code}>{issueText[code]??"추가로 확인해야 할 거래내역 검증 항목이 있습니다."}</li>)}</ul>}
    </div>}
    <Link href="/private/tiger/sync" className="btn btn-outline">수집 및 오류 상태 확인 →</Link>
  </section>;
}

export default async function PortfolioPage() {
  if(!await currentWorkspace()) redirect("/login");
  const [links,history,reviews]=await Promise.allSettled([tigerStatus(),tigerSyncStatus(),tigerReviewStatus()]);
  const accountState:TigerStatus|null=links.status==="fulfilled"?links.value:null;
  const historyState:TigerSyncStatus|null=history.status==="fulfilled"?history.value:null;
  const reviewState:TigerReviewStatus|null=reviews.status==="fulfilled"?reviews.value:null;
  const accounts=accountState?.accounts ?? [];
  const connectionById=new Map(accountState?.connections.map(c=>[c.id,c.status])??[]);
  const latestJob=new Map<string,TigerSyncJob>();
  const latestReview=new Map((reviewState?.accounts??[]).map(r=>[r.accountId,r]));
  for(const job of historyState?.jobs ?? []) {
    if(!latestJob.has(job.accountId)) latestJob.set(job.accountId,job);
  }
  return <main>
    <div className="page-intro"><span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
      <h1>내 포트폴리오</h1>
      <p>계좌 연결 상태와 데이터 검증 준비 현황을 확인하세요. 확인되지 않은 거래 내역으로 잔고나 손익을 만들어 표시하지 않습니다.</p>
    </div>
    <div className="info-strip" role="status"><span aria-hidden="true">ⓘ</span><div>
      <strong>현재 포트폴리오 수익률을 산출할 수 없습니다.</strong>
      <p>검증된 과거 거래, 수수료 및 동일 기준 시각의 증권사 보유현황이 없으면 결과는 미확인으로 유지합니다. 이 화면에 예시 거래나 테스트 잔고를 표시하지 않습니다.</p>
    </div></div>
    {accountState===null || historyState===null || reviewState===null ? <section className="state-panel" role="alert">
      <span className="pill pill-warning">조회 불가</span>
      <h2>포트폴리오 준비 상태를 확인할 수 없습니다.</h2>
      <p>계좌 연결 또는 동기화 서버에 접근하지 못했습니다. 연결되지 않았다고 단정하거나 포트폴리오를 0으로 표시하지 않습니다.</p>
      <Link href="/private/portfolio" className="btn btn-outline">다시 확인</Link>
    </section> : accounts.length===0 ? <section className="state-panel">
      <span className="pill pill-neutral">연결된 계좌 없음</span>
      <h2>연결된 계좌가 아직 없습니다.</h2>
      <p>Tiger 공식 제3자 앱 승인과 조회 범위 검증을 마친 뒤 연결된 계좌의 상태를 이곳에 표시합니다.</p>
      <Link href="/private/tiger" className="btn btn-outline">Tiger 연동 상태 보기</Link>
    </section> : <>
      <div className="dashboard-heading"><h2>계좌별 검증 상태</h2><span className="pill pill-neutral">{accounts.length}개 계좌</span></div>
      <div className="sync-jobs">{accounts.map(account=><AccountReadiness
        key={account.id} account={account}
        connection={connectionById.get(account.connectionId)??"UNKNOWN"}
        job={latestJob.get(account.id)??null} review={latestReview.get(account.id)??null}/>)}</div>
    </>}
    <section className="state-panel">
      <h2>포트폴리오 검증 절차</h2>
      <div className="connection-steps">
        <div className="connection-step">1 · 체결이력 수집<small>누락·중복·수수료 상태 확인</small></div>
        <div className="connection-step">2 · 거래 대조<small>주문·현금활동·기업행동 검증</small></div>
        <div className="connection-step">3 · 보유수량 대조<small>같은 기준 시각 증권사 스냅샷과 비교</small></div>
        <div className="connection-step">4 · 검증된 손익 공개<small>승인된 원장에서만 산출</small></div>
      </div>
    </section>
  </main>;
}
