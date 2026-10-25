import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentWorkspace } from "../../../../lib/require-workspace";
import { tigerSyncStatus, type TigerSyncJob, type TigerSyncStatus } from "../../../../lib/tiger-api";

export const metadata:Metadata={title:"Tiger 동기화 상태 · Positionary"};
export const dynamic="force-dynamic";

const statuses:Record<string,string>={
  PENDING:"대기", RUNNING:"수집 중", PARTIAL:"일부만 수집",
  COMPLETE:"처리 완료", FAILED:"처리 실패", AUTH_REQUIRED:"재인증 필요"
};
const issueNames:Record<string,string>={
  HISTORY_COVERAGE_UNVERIFIED:"전체 거래이력 범위가 확인되지 않았습니다.",
  PAGE_COVERAGE_UNVERIFIED:"페이지 수집만으로 과거 전체 이력을 확인할 수 없습니다.",
  PROVIDER_PARTIAL:"증권사에서 일부 정보만 제공했습니다.",
  PROVIDER_TRANSIENT:"증권사 요청 실패 · 재시도 예정",
  FEE_UNKNOWN:"수수료 정보가 확인되지 않았습니다.",
  TIME_UNVERIFIED:"거래 시간대 검증이 필요합니다.",
  CURRENCY_UNVERIFIED:"거래 통화 검증이 필요합니다.",
  CURSOR_LOOP:"반복되는 페이지 커서가 감지됐습니다.",
  PAGE_LIMIT:"한 번에 수집할 수 있는 페이지 수를 초과했습니다.",
  REAUTH_REQUIRED:"Tiger에서 다시 인증해야 합니다.",
  SOURCE_ERROR:"조회 데이터를 확인하는 중 오류가 발생했습니다.",
  CHECKPOINT_INVALID:"저장된 수집 위치를 확인할 수 없습니다.",
  SOURCE_CONTRACT_INVALID:"증권사 데이터 형식을 검증하지 못했습니다."
};
function localTime(raw:string|null):string {
  if (!raw) return "확인되지 않음";
  const time=new Date(raw);
  return Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat("ko-KR",{dateStyle:"medium",timeStyle:"short",timeZone:"Pacific/Auckland"}).format(time)
    : "확인되지 않음";
}
function Job({job}:{job:TigerSyncJob}) {
  const percent=job.totalWindows>0
    ? Math.min(100,Math.floor(job.processedWindows/job.totalWindows*100)):0;
  const blocked=job.state==="FAILED" || job.state==="AUTH_REQUIRED"
    || job.connectionStatus!=="CONNECTED";
  return <section className="state-panel sync-job" aria-label={job.accountAlias+" 동기화"}>
    <div className="sync-head">
      <div><span className="breadcrumb">Tiger 계좌</span><h2>{job.accountAlias}</h2></div>
      <span className={blocked?"pill pill-warning":"pill pill-neutral"}>
        {job.connectionStatus!=="CONNECTED"?"연결 확인 필요":statuses[job.state]??"상태 확인 중"}
      </span>
    </div>
    <p className="sync-subtle">조회 요청 범위: {localTime(job.startUtc)} – {localTime(job.endUtc)}</p>
    <div className="sync-progress-title"><strong>작업 처리 진행</strong><span>{job.processedWindows} / {job.totalWindows}구간</span></div>
    <div className="sync-progress-track" role="progressbar"
      aria-label="수집 작업 처리율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div style={{width:percent+"%"}} className="sync-progress-fill"/>
    </div>
    <p className="sync-subtle">이 진행률은 작업 처리 여부만 표시합니다. <strong>거래이력 완전성은 미검증</strong> 상태입니다.</p>
    <div className="sync-metrics">
      <span><strong>{job.pagesStaged}</strong><small>저장한 페이지</small></span>
      <span><strong>{job.runningWindows}</strong><small>진행 중 구간</small></span>
      <span><strong>{job.pendingWindows}</strong><small>대기 구간</small></span>
      <span><strong>{job.blockedWindows}</strong><small>인증·오류 확인</small></span>
    </div>
    {job.nextRetryAt && <p className="sync-subtle">다음 재시도 예정: {localTime(job.nextRetryAt)} (뉴질랜드 시간)</p>}
    {job.issueCodes.length>0 && <div className="sync-issues">
      <h3>확인할 내용</h3>
      <ul>{job.issueCodes.map(code=><li key={code}>{issueNames[code]??"추가 검증이 필요한 수집 상태가 있습니다."}</li>)}</ul>
    </div>}
    {job.state==="AUTH_REQUIRED" && <p>재인증이 필요한 상태입니다. Tiger 연결 페이지에서 기존 연결 상태를 확인해 주세요.</p>}
    <small>마지막 작업 기록: {localTime(job.updatedAt)} · 자동 거래 없음 · 읽기 전용</small>
  </section>;
}
export default async function TigerSyncPage() {
  if (!await currentWorkspace()) redirect("/login");
  let result:TigerSyncStatus|null=null;
  try {result=await tigerSyncStatus();}catch {/* Do not invent account activity on outage. */}
  return <main>
    <div className="page-intro">
      <span className="breadcrumb"><Link href="/private/tiger">← Tiger 연결</Link></span>
      <h1>거래내역 동기화 현황</h1>
      <p>수집 진행과 복구가 필요한 항목을 계좌별로 확인합니다. 계좌 데이터는 Tiger 승인을 받은 뒤에만 실제로 가져올 수 있습니다.</p>
    </div>
    <div className="info-strip" role="status"><span aria-hidden="true">ⓘ</span><div>
      <strong>현재는 과거 거래내역의 전체 범위를 검증할 수 없습니다.</strong>
      <p>페이지 수집이 끝나도 모든 거래·수수료·기업행동이 포함됐다는 뜻은 아닙니다. 잔고나 손익을 추정해 표시하지 않습니다.</p>
    </div></div>
    {!result ? <section className="state-panel" role="alert">
      <h2>동기화 상태를 확인할 수 없습니다.</h2>
      <p>서버에 접근할 수 없거나 권한 검증이 실패했습니다. 진행률을 0%나 완료로 추측해 표시하지 않습니다.</p>
      <Link href="/private/tiger/sync" className="btn btn-outline">다시 확인</Link>
    </section> : <>
      {!result.syncEnabled && <div className="state-panel">
        <span className="pill pill-warning">자동 수집 미활성화</span>
        <h2 style={{marginTop:12}}>Tiger 공식 승인 및 이력 조회 규격 검증 대기</h2>
        <p>승인된 계좌 조회 권한과 페이지 누락 방지 검증이 준비되기 전에는 신규 거래내역 자동 수집을 시작하지 않습니다.</p>
      </div>}
      {result.jobs.length===0 ? <section className="state-panel">
        <h2>아직 동기화 작업이 없습니다.</h2>
        <p>실제 수집 이력이 없으며, 예시 수익률이나 가상 거래를 계좌 데이터로 표시하지 않습니다.</p>
        <Link href="/private/tiger" className="btn btn-outline">Tiger 연결 상태 확인</Link>
      </section> : <>
        <div className="dashboard-heading"><h2>최근 동기화 작업</h2><span className="pill pill-neutral">최대 25건</span></div>
        <div className="sync-jobs">{result.jobs.map(job=><Job key={job.id} job={job}/>)}</div>
      </>}
    </>}
  </main>;
}
