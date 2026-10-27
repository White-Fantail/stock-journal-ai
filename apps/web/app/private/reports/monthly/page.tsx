import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {fetchMonthlyProcessReport} from "../../../../lib/saas-trades-api";
import {tigerLedgerRead} from "../../../../lib/tiger-api";
import {assessPerformanceReadiness} from "../../../../lib/performance-readiness";
import {currentNzMonth,stepMonth} from "../../../../lib/monthly-process";

export const metadata={title:"월간 투자 복기 · Positionary"};
export const dynamic="force-dynamic";
const label=(s:string)=>new Intl.DateTimeFormat("ko-KR",{
  timeZone:"Pacific/Auckland",dateStyle:"medium",timeStyle:"short",
}).format(new Date(s));
export default async function MonthlyReviewReport({searchParams}:{
  searchParams:Promise<{month?:string}>
}){
  const [workspace,session,params]=await Promise.all([
    currentWorkspace(),auth(),searchParams,
  ]);
  if(!workspace||!session?.user?.id)redirect("/login");
  const now=new Date();
  const current=currentNzMonth(now);
  const requested=typeof params.month==="string"?params.month:current;
  const month=/^20[2-9][0-9]-(?:0[1-9]|1[0-2])$/.test(requested)&&requested<=current
    ?requested:current;
  const [summary,broker]=await Promise.allSettled([
    fetchMonthlyProcessReport(session.user.id,month),tigerLedgerRead(),
  ]);
  const report=summary.status==="fulfilled"?summary.value:null;
  const readiness=assessPerformanceReadiness(broker.status==="fulfilled"?broker.value:null,null);
  const prev=stepMonth(month,-1);
  const next=stepMonth(month,1);
  return <main className="journal-page">
    <div className="page-intro journal-page-heading">
      <div>
        <span className="breadcrumb"><Link href="/private/alerts">← 투자 점검 센터</Link></span>
        <h1>월간 투자 복기</h1>
        <p>매월 어떤 판단을 기록했고 계획을 얼마나 점검했는지 확인합니다.
          수익률 예측이나 실시간 매매 분석이 아닙니다.</p>
      </div>
      <Link className="btn btn-outline" href="/private/journal">새 복기 작성</Link>
    </div>
    <nav className="user-panel-head" aria-label="보고서 월 이동">
      <div><strong>{month}</strong> <small>뉴질랜드 시간 기준</small></div>
      <div className="home-actions">
        {prev&&<Link className="btn btn-outline" href={"/private/reports/monthly?month="+prev}>← 이전 달</Link>}
        {next&&next<=current&&<Link className="btn btn-outline" href={"/private/reports/monthly?month="+next}>다음 달 →</Link>}
      </div>
    </nav>
    {!report?<section className="state-panel" role="alert">
      <h2>이 달의 기록을 완전하게 계산할 수 없습니다.</h2>
      <p>인증된 투자 기록 집계가 실패했거나 종목 수가 안전한 집계 한도를 넘어섰습니다.
        일부 기록을 전체 월간 활동으로 제시하지 않습니다. 종목별 일지는 계속 확인할 수 있습니다.</p>
      <Link href="/private/journal" className="btn btn-outline">투자일지 확인 →</Link>
    </section>:<>
      <div className="user-summary-grid">
        <section className="user-summary-card">
          <small>작성한 투자 판단</small>
          <strong>{report.noteCount}건</strong>
          <span>이 중 직접 작성한 복기 {report.reviewCount}건</span>
        </section>
        <section className="user-summary-card">
          <small>투자계획 변경 이력</small>
          <strong>{report.planRevisionCount}건</strong>
          <span>변경하지 않은 계획도 기존 상태로 유지</span>
        </section>
        <section className="user-summary-card">
          <small>직접 기록한 거래</small>
          <strong>{report.userTradeRecordCount}건</strong>
          <span>직접 정정 {report.voidCount}건 · 실제 증권사 체결 검증과 별도</span>
        </section>
      </div>
      <section className="user-panel">
        <div className="user-panel-head">
          <h2>투자계획과 정기 복기 현황</h2>
          <Link href="/private/analysis?mode=COACHING">지난달 기록 AI 코칭 →</Link>
        </div>
        <div className="account-summary-values portfolio-account-values">
          <div><small>보고서 기준일까지 작성된 종목별 계획</small><strong>{report.plannedSymbols}개</strong></div>
          <div><small>전략 핵심 항목 작성 완료</small><strong>{report.completeStrategySymbols}개</strong></div>
          <div><small>보고서 기준 시점 점검 기한 도래</small><strong>{report.dueAsOfCutoff}개</strong></div>
        </div>
        <p className="user-footnote">점검 기준: {label(report.checkedAsOf)} (NZ). 전략 핵심 항목은 전략 유형, 기간, 논리 무효화 조건, 개인 최대 비중,
          정기 점검 주기의 작성 여부만 확인합니다. 수익률이나 판단의 옳고 그름을 평가하지 않습니다.
          이벤트 기반 점검은 날짜를 임의로 부여하지 않습니다.</p>
      </section>
      <section className="user-panel">
        <div className="user-panel-head">
          <h2>투자 원칙 자기평가 · 이번 달</h2>
          <Link href="/private/journal">종목 선택 후 자기평가 →</Link>
        </div>
        <p>계획에 연결하여 직접 평가한 복기 <strong>{report.selfReviewCount}건</strong>입니다.
          전체 REVIEW 메모 {report.reviewCount}건에 포함되며, 이 중 자기평가를 명시한 기록만 별도로 집계합니다.</p>
        <div className="account-summary-values portfolio-account-values">
          <div><small>원칙을 지켰다고 기록</small><strong>{report.selfReviewBreakdown.FOLLOWED}건</strong></div>
          <div><small>일부만 지켰다고 기록</small><strong>{report.selfReviewBreakdown.PARTIAL}건</strong></div>
          <div><small>원칙에서 벗어났다고 기록</small><strong>{report.selfReviewBreakdown.DEVIATED}건</strong></div>
          <div><small>판단 유보</small><strong>{report.selfReviewBreakdown.UNCERTAIN}건</strong></div>
        </div>
        <p className="user-footnote">모든 수치는 사용자가 직접 표시한 자기평가 건수입니다.
          자동 계산한 준수율이나 실제 매매 계획 준수 증명은 아닙니다.
          일반 복기 메모는 별도의 자기평가를 하지 않는 한 준수 판정에서 제외합니다.</p>
      </section>
      <section className="user-panel">
        <div className="user-panel-head">
          <h2>종목별 기록 활동</h2>
          <Link href="/private/journal">전체 투자일지 →</Link>
        </div>
        {report.symbols.length===0?
          <p className="user-empty">해당 월에 작성한 투자 판단·계획·직접 거래 기록이 없습니다.</p>:
          <div className="user-list">
            {report.symbols.map(item=><Link className="user-list-row" key={item.ticker}
              href={"/private/journal?ticker="+encodeURIComponent(item.ticker)}>
              <div><strong>{item.ticker}</strong>
                <small>투자 판단 {item.notes} · 그중 복기 {item.reviews}</small></div>
              <div className="user-list-value">
                <strong>계획 변경 {item.plans}</strong>
                <small>직접 거래 기록 {item.manualRecords}</small>
              </div>
            </Link>)}
          </div>}
      </section>
      <p className="journal-limit">집계 기간: {label(report.start)}부터 {label(report.end)} 직전까지 (NZ).
        사용자별 DB에서 해당 월의 작성 기록·계획 변경·직접 입력 거래를 전체 기간 기준으로 집계했습니다. 최신 50·200건 목록 제한을 적용하지 않았습니다.
        증권사 원장 전체 이력이나 손익, 배당, 세금, 환율, 수익률 검증에 사용할 수 없습니다.
        생성 결과를 DB에 저장하거나 외부 AI로 전송하지 않습니다.</p>
    </>}
      <section className="user-panel">
        <div className="user-panel-head">
          <h2>검증된 투자 성과 계산 준비 상태</h2>
          <Link href="/private/performance">장기 성과 준비 상태 →</Link>
        </div>
        <p>현재는 <strong>{readiness.label}</strong> 상태입니다. 일부 Tiger 주문이나 계좌 평가액만으로
          확정 수익률을 계산하지 않습니다. 이 상태는 실제 투자 성과가 나쁘거나 좋다는 뜻이 아닙니다.</p>
        <p className="user-footnote">공개된 검증 원장 계좌 수: {readiness.verifiedAccounts}개.
          데이터 확인 기준: {readiness.asOf?label(readiness.asOf):"검증 원장 기준 시각 없음"}.</p>
        <div className="user-list" aria-label="투자 성과 데이터 검증 조건">
          {readiness.gates.map(gate=><div key={gate.kind} className="user-list-row">
            <div>
              <strong>{gate.label}</strong>
              <small>{gate.detail}</small>
            </div>
            <small>{gate.state==="VERIFIED"?"부분 확인":
              gate.state==="UNAVAILABLE"?"조회 불가":"추가 검증 필요"}</small>
          </div>)}
        </div>
        <p className="journal-limit">이 표는 매매 알림이나 투자 조언이 아닌 데이터 품질 점검입니다.
          현금 흐름·기간별 평가액·환율 등의 근거가 검증되기 전까지 수익률을 만들지 않습니다.</p>
      </section>
  </main>;
}
