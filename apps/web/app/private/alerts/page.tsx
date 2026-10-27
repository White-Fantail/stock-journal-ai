import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchJournal,fetchJournalPlans} from "../../../lib/saas-trades-api";
import {dueInvestmentReviews} from "../../../lib/review-schedule";
import {tigerPersonalRead,tigerPersonalHealth} from "../../../lib/tiger-api";
import {derivePersonalAlerts} from "../../../lib/notification-signals";

export const metadata={title:"투자 점검 센터 · Positionary"};
export const dynamic="force-dynamic";

function timeLabel(value:string|null){
  if(!value)return "시각 미확인";
  const date=new Date(value);
  return Number.isFinite(date.valueOf())?
    new Intl.DateTimeFormat("ko-KR",{dateStyle:"medium",timeStyle:"short",
      timeZone:"Pacific/Auckland"}).format(date):"시각 미확인";
}
export default async function NotificationsPage(){
  const [workspace,session]=await Promise.all([currentWorkspace(),auth()]);
  if(!workspace||!session?.user?.id)redirect("/login");
  const [health,personal,plans,notes]=await Promise.allSettled([
    tigerPersonalHealth(),tigerPersonalRead(),fetchJournalPlans(session.user.id),
    fetchJournal(session.user.id),
  ]);
  const accountHealth=health.status==="fulfilled"?health.value:null;
  const holdings=personal.status==="fulfilled"?personal.value:null;
  const myPlans=plans.status==="fulfilled"&&plans.value.length<200?plans.value:null;
  const alerts=derivePersonalAlerts(holdings,accountHealth,myPlans);
  const reviews=myPlans!==null&&notes.status==="fulfilled"&&notes.value.length<200
    ?dueInvestmentReviews(myPlans,notes.value):null;
  return <main className="journal-page">
    <div className="page-intro journal-page-heading">
      <div><span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
        <h1>투자 점검 센터</h1>
        <p>Tiger 수집 상태와 아직 계획을 작성하지 않은 보유 종목을 확인합니다. 가격 감시나 매매 알림은 제공하지 않습니다.</p>
      </div>
      <div className="home-actions">
        <Link className="btn btn-outline" href="/private/reports/monthly">월간 복기 보고서</Link>
        <Link className="btn btn-outline" href="/private/portfolio">포트폴리오 확인</Link>
      </div>
    </div>
    <section className="state-panel">
      <h2>자동 수집 상태</h2>
      <p>개인 Tiger 수집기는 Railway에서 하루 한 번 예약 실행됩니다. 마지막 실행 보고와 마지막 성공적인 자산 조회는 서로 다릅니다.
        부분 조회가 성공으로 간주되지 않으며, 수집 여부가 투자 원장의 정확성을 증명하지 않습니다.</p>
      {accountHealth?.accounts.length?accountHealth.accounts.map((a,i)=><div key={a.alias+":"+i}
        style={{borderTop:"1px solid var(--border, #ddd)",padding:"12px 0"}}>
        <strong>{a.alias}</strong>
        <p>마지막 자산 성공: {timeLabel(a.lastAssetsAt)} · 최근 실행: {timeLabel(a.latest?.latestRunAt??null)}</p>
        <small>자산 {a.latest?.assets??"보고 없음"} / 주문 {a.latest?.orders??"보고 없음"} /
          개별 체결 {a.latest?.fills??"보고 없음"}</small>
      </div>):<p>현재 이 계정에 수집 실행 보고가 없습니다. 새로운 보고가 저장되면 여기서 확인할 수 있습니다.</p>}
    </section>
    <section className="state-panel">
      <div className="user-panel-head">
        <h2>나의 정기 투자 점검</h2>
        <Link href="/private/journal">투자일지 →</Link>
      </div>
      {reviews===null?<p role="alert">투자 계획이나 복기 기록을 불러오지 못해 점검 일정을 계산하지 않습니다.</p>:
        reviews.length===0?<p>예약된 주기별 점검 항목이 없습니다. 투자계획에 점검 주기를 등록하면 표시됩니다.
          기업 공시·사건 발생 시 점검 계획은 날짜를 임의로 정하지 않습니다.</p>:
        <div className="user-list">
          {reviews.slice(0,12).map(task=><div key={task.ticker} className="user-list-row">
            <div>
              <strong>{task.ticker} · {task.state==="DUE"?"정기 점검 시점 도래":"다음 정기 점검"}</strong>
              <small>{timeLabel(task.nextDueAt)} 이후 · 내 마지막 계획/복기 기준</small>
            </div>
            <Link href={"/private/journal/review/new?ticker="+encodeURIComponent(task.ticker)}>
              원칙 자기평가 작성 →
            </Link>
          </div>)}
        </div>}
      <p className="journal-limit">점검 예정일은 사용자가 작성한 계획 시점과 최근 매매 복기 날짜로만 계산합니다.
        알림을 보내거나 자동 매매하지 않으며, 복기 기록은 단순히 작성 여부만 반영합니다.</p>
    </section>
    <section className="state-panel">
      <h2>현재 확인이 필요한 사항</h2>
      {alerts.length===0?<p>현재 확인된 동기화 문제나 미작성 투자 계획이 없습니다. 거래내역의 완전성이나 미래 시장 위험이 없다는 의미는 아닙니다.</p>:
        <div style={{display:"grid",gap:14}}>
          {alerts.map(alert=><article key={alert.id} className="journal-entry">
            <div className="journal-entry-content">
              <strong>{alert.title}</strong>
              <p>{alert.detail}</p>
              <small>관측 기준: {timeLabel(alert.observedAt)}</small>
            </div>
          </article>)}
        </div>}
      {myPlans===null&&<p role="alert">투자 계획을 불러오지 못했거나 조회 상한에 도달해 전략 누락 점검을 생략했습니다.</p>}
      <p className="journal-limit">이 안내는 화면을 열 때 저장된 Tiger 정보와 내 투자 계획만으로 계산합니다.
        주가 조회·가격 도달 감시·매매 알림·자동 주문·휴대폰 푸시를 하지 않습니다.
        투자 계획 미작성 안내는 최근 보유 관측에만 기반하며 매매 권고가 아닙니다.</p>
      <Link href="/private/journal" className="btn btn-outline">투자 계획 관리 →</Link>
    </section>
  </main>;
}
