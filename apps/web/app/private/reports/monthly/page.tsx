import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {fetchJournal,fetchJournalPlans,fetchManualTrades} from "../../../../lib/saas-trades-api";
import {buildMonthlyProcessReport,currentNzMonth,stepMonth} from "../../../../lib/monthly-process";

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
  const [notes,plans,trades]=await Promise.allSettled([
    fetchJournal(session.user.id),fetchJournalPlans(session.user.id),
    fetchManualTrades(session.user.id),
  ]);
  const complete=notes.status==="fulfilled"&&plans.status==="fulfilled"&&trades.status==="fulfilled";
  const report=complete?buildMonthlyProcessReport(month,notes.value,plans.value,trades.value.events,now):null;
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
      <Link className="btn btn-outline" href="/private/journal/new?kind=REVIEW">새 복기 작성</Link>
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
      <p>투자 기록 조회가 실패했거나 안전한 조회 상한을 넘어섰습니다.
        일부 기록으로 완전한 월간 활동을 단정하지 않습니다. 종목별 일지는 별도로 계속 볼 수 있습니다.</p>
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
          <Link href="/private/alerts">점검 센터 →</Link>
        </div>
        <div className="account-summary-values portfolio-account-values">
          <div><small>해당 월말까지 작성된 종목별 계획</small><strong>{report.plannedSymbols}개</strong></div>
          <div><small>전략 핵심 항목 작성 완료</small><strong>{report.completeStrategySymbols}개</strong></div>
          <div><small>해당 월말 기준 점검 시점 도래</small><strong>{report.dueAsOfMonthEnd}개</strong></div>
        </div>
        <p className="user-footnote">전략 핵심 항목은 전략 유형, 기간, 논리 무효화 조건, 개인 최대 비중,
          정기 점검 주기의 작성 여부만 확인합니다. 수익률이나 판단의 옳고 그름을 평가하지 않습니다.
          이벤트 기반 점검은 날짜를 임의로 부여하지 않습니다.</p>
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
        사용자 작성 기록·투자계획·직접 입력 거래를 읽어 화면에서 계산했습니다.
        증권사 원장 전체 이력이나 손익, 배당, 세금, 환율, 수익률 검증에 사용할 수 없습니다.
        생성 결과를 DB에 저장하거나 외부 AI로 전송하지 않습니다.</p>
    </>}
  </main>;
}
