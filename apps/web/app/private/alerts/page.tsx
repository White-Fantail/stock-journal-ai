import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchJournalPlans} from "../../../lib/saas-trades-api";
import {tigerPersonalRead,tigerPersonalHealth} from "../../../lib/tiger-api";
import {derivePersonalAlerts} from "../../../lib/notification-signals";

export const metadata={title:"알림 센터 · Positionary"};
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
  const [health,personal,plans]=await Promise.allSettled([
    tigerPersonalHealth(),tigerPersonalRead(),fetchJournalPlans(session.user.id),
  ]);
  const accountHealth=health.status==="fulfilled"?health.value:null;
  const holdings=personal.status==="fulfilled"?personal.value:null;
  const myPlans=plans.status==="fulfilled"?plans.value:[];
  const alerts=derivePersonalAlerts(holdings,accountHealth,myPlans);
  return <main className="journal-page">
    <div className="page-intro journal-page-heading">
      <div><span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
        <h1>알림 센터</h1>
        <p>내 Tiger 데이터의 마지막 수집 상태와, 투자 계획에 도달한 시세 관측을 확인합니다.</p>
      </div>
      <Link className="btn btn-outline" href="/private/portfolio">포트폴리오 확인</Link>
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
      <h2>현재 확인이 필요한 사항</h2>
      {alerts.length===0?<p>현재 확인된 수집 실패·지연 또는 최근 관측 가격 도달 조건이 없습니다.
        실제 문제가 없거나 앞으로 가격이 도달하지 않는다는 뜻은 아닙니다.</p>:
        <div style={{display:"grid",gap:14}}>
          {alerts.map(alert=><article key={alert.id} className="journal-entry">
            <div className="journal-entry-content">
              <strong>{alert.title}</strong>
              <p>{alert.detail}</p>
              <small>관측 기준: {timeLabel(alert.observedAt)}</small>
            </div>
          </article>)}
        </div>}
      {plans.status!=="fulfilled"&&<p role="alert">투자 계획을 가져오지 못해 목표가·손절가 판단을 생략했습니다.</p>}
      <p className="journal-limit">이 알림은 페이지 조회 시 생성되는 앱 내부 안내이며, 휴대폰 푸시나 이메일로 자동 전송되지 않습니다.
        계획 가격 알림은 동일 USD 통화·최근 보유 정보·45분 이내 시세 관측일 때만 표시합니다.
        하루 한 번 수집으로는 장중 가격 변화를 지속 감시할 수 없습니다. 가격 조건은 실제 주문이 아닙니다.</p>
      <Link href="/private/journal" className="btn btn-outline">목표가·손절가 계획 확인 →</Link>
    </section>
  </main>;
}
