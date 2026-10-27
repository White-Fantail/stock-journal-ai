import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {fetchWeeklyProcessReport} from "../../../../lib/saas-trades-api";
import {nzRecentWeeks,selectRecentWeek} from "../../../../lib/weekly-periods";

export const dynamic="force-dynamic";
export const metadata={title:"주간 투자 점검 · Positionary"};
const statusLabels:Record<string,string>={FOLLOWED:"지켰다고 기록",
  PARTIAL:"일부만 지켰다고 기록",DEVIATED:"벗어났다고 기록",UNCERTAIN:"판단 유보"};
const time=(input:string)=>new Intl.DateTimeFormat("ko-KR",{
  timeZone:"Pacific/Auckland",dateStyle:"medium",
}).format(new Date(input));

export default async function WeeklyReviewPage({searchParams}:{
 searchParams:Promise<{week?:string}>
}){
 const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const allowed=nzRecentWeeks();
 const selected=selectRecentWeek(allowed,params.week);
 const report=selected?await fetchWeeklyProcessReport(session.user.id,selected).catch(()=>null):null;
 return <main className="journal-page">
   <div className="page-intro journal-page-heading">
     <div><span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
       <h1>주간 투자 점검</h1>
       <p>이번 주의 투자 기록과 점검할 계획을 정리합니다.
         투자 원칙을 지켰는지는 직접 작성한 자기평가로만 표시합니다.</p>
     </div>
     <Link className="btn btn-outline" href="/private/reports/monthly">월간 복기 →</Link>
   </div>
   <section className="user-panel">
     <h2>점검 주 선택</h2>
     <div className="performance-period-links" role="group" aria-label="주간 보고서 주 선택">
       {allowed.map(w=><Link key={w} className={"performance-period-link"+(w===selected?" is-active":"")}
         aria-current={w===selected?"page":undefined}
         href={"/private/reports/weekly?week="+encodeURIComponent(w)}>{w}</Link>)}
     </div>
   </section>
   {!report?<section className="state-panel" role="alert">
     <h2>주간 전체 기록 조회를 완료하지 못했습니다.</h2>
     <p>일부 기록만으로 주간 활동 건수나 점검 완료 여부를 추정하지 않습니다.
       이후 다시 확인하거나 투자일지에서 개별 기록을 볼 수 있습니다.</p>
     <Link href="/private/journal">투자일지 →</Link>
   </section>:<>
     <section className="user-panel">
       <div className="user-panel-head"><h2>{report.week} · {report.partial?"진행 중인 주":"완료된 주"}</h2>
         <Link href="/private/alerts">점검 센터 →</Link></div>
       <p className="user-footnote">{time(report.start)}부터 {time(report.end)} 직전까지 ·
         집계 기준: {time(report.checkedAsOf)} · Pacific/Auckland</p>
       <div className="account-summary-values portfolio-account-values">
         <div><small>작성한 투자 기록</small><strong>{report.noteCount}건</strong></div>
         <div><small>일반 복기 메모</small><strong>{report.reviewCount}건</strong></div>
         <div><small>명시적 자기평가</small><strong>{report.selfReviewCount}건</strong></div>
         <div><small>투자계획 변경</small><strong>{report.planRevisionCount}건</strong></div>
         <div><small>점검 시점 도래</small><strong>{report.duePlans}종목</strong></div>
       </div>
       <p className="journal-limit">명시적 자기평가는 일반 복기 메모에 포함됩니다.
         두 건수를 합산하지 않습니다. 이번 주는 아직 진행 중일 수 있으며
         매매 횟수나 투자 성과를 측정한 결과가 아닙니다.</p>
     </section>
     <section className="user-panel">
       <div className="user-panel-head"><h2>투자계획 점검 목록</h2>
         <Link href="/private/journal">전체 종목 →</Link></div>
       {!report.tasks.length?<p>점검 주기를 설정한 투자계획이 없습니다.
         계획이 없다는 것이 실제 투자 위험이 낮다는 의미는 아닙니다.</p>:
       <div className="user-list">{report.tasks.map(task=>
         <div className="user-list-row" key={task.ticker}>
           <div><strong>{task.ticker} · {task.state==="DUE"?"점검 시점 도래":"예정"}</strong>
             <small>다음 점검 기준: {time(task.nextDueAt)} · {task.cadence}</small>
             <small>이전 자기평가: {task.lastAssessment?
               statusLabels[task.lastAssessment]??"사용자 기록": "기록 없음"}</small>
             {task.lastNextAction&&<p>지난번에 적은 다음 행동: {task.lastNextAction}</p>}
             <small>이전 행동을 실제로 완료했는지는 별도 확인이 필요합니다.</small></div>
           <Link className="btn btn-outline" href={
             "/private/journal/review/new?ticker="+encodeURIComponent(task.ticker)}>
              원칙 복기 →
           </Link>
         </div>)}</div>}
     </section>
     <section className="user-panel">
       <h2>이번 주 종목별 기록</h2>
       {!report.symbols.length?<p>해당 주에 작성한 투자 기록이 없습니다.</p>:
       <div className="user-list">{report.symbols.map(s=>
         <Link className="user-list-row" href={"/private/journal?ticker="+encodeURIComponent(s.ticker)}
           key={s.ticker}>
           <strong>{s.ticker}</strong>
           <small>메모 {s.notes} · 복기 {s.reviews} · 자기평가 {s.selfReviews} · 계획 변경 {s.plans}</small>
         </Link>)}</div>}
       <p className="journal-limit">전체 기간 DB 집계이지만, 과거 매매의 실제 체결이나 수익률을 검증한 기록은 아닙니다.
         장기 성과 검증은 별도 과정에서 진행합니다.</p>
     </section>
   </>}
 </main>;
}
