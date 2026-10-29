import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchReviewActions,fetchWeeklyProcessReport} from "../../../lib/saas-trades-api";
import {nzRecentWeeks} from "../../../lib/weekly-periods";
import type {Metadata} from "next";
export const metadata:Metadata={title:"투자 점검 · Positionary"};
export const dynamic="force-dynamic";
const fmt=(date:string)=>new Intl.DateTimeFormat("ko-KR",{
 timeZone:"Pacific/Auckland",dateStyle:"medium",
}).format(new Date(date));
const done=(s:string|null)=>s==="DONE"||s==="NOT_APPLICABLE";
const desc:Record<string,string>={
 DONE:"완료했다고 기록",NOT_DONE:"아직 하지 못함",
 NOT_APPLICABLE:"현재는 해당 없음",UNCERTAIN:"판단 유보",
};
export default async function ReviewHub({searchParams}:{
 searchParams:Promise<{saved?:string}>;
}){
 const [workspace,session,params]=await Promise.all([currentWorkspace(),auth(),searchParams]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const week=nzRecentWeeks()[0];
 const [actionsResult,weekResult]=await Promise.allSettled([
  fetchReviewActions(session.user.id),fetchWeeklyProcessReport(session.user.id,week),
 ]);
 const actions=actionsResult.status==="fulfilled"?actionsResult.value:null;
 const report=weekResult.status==="fulfilled"?weekResult.value:null;
 const open=actions?.filter(a=>!done(a.state))??[];
 const closed=actions?.filter(a=>done(a.state))??[];
 return <main className="journal-page review-hub">
   <div className="page-intro journal-page-heading">
     <div><span className="breadcrumb"><Link href="/private">← 홈</Link></span>
       <h1>투자 점검</h1>
       <p>지난번에 스스로 약속한 행동을 확인하고, 오늘의 투자 논리도 돌아보세요.
         매매 추천·가격 감시·자동 완료 판정은 하지 않습니다.</p>
     </div>
     <Link href="/private/journal" className="btn btn-primary">내 투자 계획 →</Link>
   </div>
   {params.saved==="action"&&<p role="status">이번 행동 상태를 기록했습니다. 과거 자기평가와 다음 행동 원문은 유지됩니다.</p>}
   <section className="user-panel">
     <div className="user-panel-head"><h2>지난 점검에서 정한 다음 행동</h2>
       <Link href="/private/reports/weekly">주간 기록 →</Link></div>
     {actions===null?<p role="alert">이전에 적어둔 행동과 처리 상태를 완전하게 확인하지 못했습니다.
       미완료가 없다고 표시하지 않습니다. 다시 조회해 주세요.</p>:
       actions.length===0?<p>구조화된 투자 자기평가에서 아직 다음 행동을 기록하지 않았습니다.
         종목별 계획을 작성하고 자기평가를 남기면 이곳에서 다시 확인할 수 있습니다.</p>:<>
         {open.length>0?<div className="review-action-list">
           {open.map(a=><article className="review-action-item" key={a.checkinId}>
             <div><strong>{a.ticker} · {a.state?desc[a.state]:"실행 여부 미확인"}</strong>
               <p>{a.nextAction}</p>
               <small>내가 작성한 행동 · {fmt(a.checkinAt)} ·
                 {a.resolvedAt?" 마지막 상태 기록 "+fmt(a.resolvedAt):" 아직 완료 확인 없음"}</small></div>
             <Link className="btn btn-primary" href={"/private/review/action/new?checkin="+encodeURIComponent(a.checkinId)}>
               {a.state?"상태 다시 기록":"실행 여부 기록"} →
             </Link>
           </article>)}
         </div>:<p>현재 조회된 최신 자기평가에서 확인이 필요한 행동이 없습니다.
            다른 종목이나 투자 위험이 없다는 뜻은 아닙니다.</p>}
         {closed.length>0&&<details className="data-disclosure">
           <summary>완료 또는 해당 없음으로 기록한 행동 {closed.length}개 보기</summary>
           <div className="review-action-list">{closed.map(a=><article className="review-action-item" key={a.checkinId}>
             <div><strong>{a.ticker} · {desc[a.state!]}</strong><p>{a.nextAction}</p>
               <small>본인 확인: {a.resolvedAt?fmt(a.resolvedAt):"시간 확인 필요"} · 자동 검증 아님</small></div>
             <Link href={"/private/review/action/new?checkin="+encodeURIComponent(a.checkinId)}>
               기록 정정·추가 →</Link>
           </article>)}</div>
         </details>}
       </>}
     <p className="user-footnote">종목마다 가장 최근 자기평가의 '다음 행동'을 표시합니다. 이전 자기평가는 삭제되지 않습니다.
       완료 상태는 본인 확인으로만 기록하며, 실제 투자 원칙 준수나 거래 체결을 증명하지 않습니다.</p>
   </section>
   <section className="user-panel">
     <div className="user-panel-head"><h2>이번 주 계획 점검</h2>
       <Link href="/private/alerts">전체 점검 항목 →</Link></div>
     {report===null?<p role="alert">이번 주의 기록을 모두 확인하지 못했습니다. 점검 완료 여부를 추정하지 않습니다.</p>:
      <><p>기준 {report.week} · {report.partial?"이번 주 진행 중":"완료된 주"} ·
        점검 시점 도래 <strong>{report.duePlans}종목</strong></p>
       {report.tasks.length?<div className="user-list">{report.tasks.slice(0,8).map(task=>
        <div className="user-list-row" key={task.ticker}>
          <div><strong>{task.ticker} · {task.state==="DUE"?"점검 시점 도래":"예정"}</strong>
            <small>내가 정한 검토 주기 {task.cadence} · 다음 기준 {fmt(task.nextDueAt)}</small></div>
          <Link href={"/private/journal/review/new?ticker="+encodeURIComponent(task.ticker)}>새 복기 작성 →</Link>
        </div>)}</div>:
        <p>조회된 계획 가운데 날짜가 정해진 정기 점검이 없습니다. 사건 발생 시 점검하는 원칙에는 날짜를 임의로 만들지 않습니다.</p>}</>}
   </section>
   <div className="review-entry-grid">
     <section className="user-panel"><h2>주간 투자 점검</h2>
       <p>점검할 계획과 자기평가 기록을 한 주 단위로 돌아봅니다.</p>
       <Link className="btn btn-outline" href="/private/reports/weekly">주간 점검 →</Link></section>
     <section className="user-panel"><h2>월간 복기</h2>
       <p>계획 변경과 자기평가 습관을 월별로 확인합니다.</p>
       <Link className="btn btn-outline" href="/private/reports/monthly">월간 복기 →</Link></section>
     <section className="user-panel"><h2>AI 투자 복기</h2>
       <p>사용자의 별도 동의를 받은 뒤 일부 기록을 외부 AI로 보내 근거를 확인합니다.</p>
       <Link className="btn btn-outline" href="/private/analysis?mode=COACHING">지난 행동과 개선 추적 →</Link></section>
     <section className="user-panel"><h2>나의 투자 원칙</h2>
       <p>목표와 위험 기준은 필요할 때 직접 수정할 수 있습니다.</p>
       <Link className="btn btn-outline" href="/private/principles">원칙 다시 보기 →</Link></section>
   </div>
 </main>;
}
