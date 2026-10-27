import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../auth";
import type {Metadata} from "next";
import {currentWorkspace} from "../../lib/require-workspace";
import {formatDecimal} from "../../lib/format-decimal";
import {fetchJournal,fetchJournalPlans} from "../../lib/saas-trades-api";
import {tigerStatus,tigerPersonalRead,type TigerStatus} from "../../lib/tiger-api";

export const metadata:Metadata={title:"내 대시보드 · Positionary"};
export const dynamic="force-dynamic";

function observedAt(raw:string|null){
  if(!raw)return "동기화 시각 미확인";
  const date=new Date(raw);
  return Number.isFinite(date.getTime())
    ?new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",dateStyle:"medium",timeStyle:"short"}).format(date)
    :"동기화 시각 미확인";
}
function orderAt(raw:string|null){
  if(!raw)return "시각 미확인";
  const d=new Date(Number(raw));
  return Number.isFinite(d.getTime())
    ?new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d)
    :"시각 미확인";
}
const noteLabels:Record<string,string>={THESIS:"투자 논리",STRATEGY:"전략 변경",
  REVIEW:"매매 복기",TRADE_NOTE:"체결 메모",WATCHLIST_ADD:"관심 추가",WATCHLIST_REMOVE:"관심 제외"};

export default async function WorkspaceHome(){
  const [workspace,session]=await Promise.all([currentWorkspace(),auth()]);
  if(!workspace||!session?.user?.id) redirect("/login");
  const results=await Promise.allSettled([
    tigerPersonalRead(),tigerStatus(),
    fetchJournal(session.user.id),fetchJournalPlans(session.user.id),
  ]);
  const personal=results[0].status==="fulfilled"?results[0].value:null;
  const tiger: TigerStatus|null=results[1].status==="fulfilled"?results[1].value:null;
  const notes=results[2].status==="fulfilled"?results[2].value:null;
  const plans=results[3].status==="fulfilled"?results[3].value:null;
  const accounts=personal?.accounts??[];
  const allPositions=accounts.flatMap(a=>a.positions.map(p=>({alias:a.alias,...p,
    quote:a.marketObservations.find(q=>q.symbol===p.symbol && q.currency===p.currency)})));
  const orders=accounts.flatMap(a=>a.orders.map(o=>({alias:a.alias,...o})))
    .sort((a,b)=>Number(b.at??0)-Number(a.at??0)).slice(0,4);
  const recent=[
    ...(notes??[]).map(n=>({ticker:n.ticker,type:noteLabels[n.kind]??"투자 기록",
      title:n.content||noteLabels[n.kind]||"변경 이력",at:n.createdAt})),
    ...(plans??[]).map(p=>({ticker:p.ticker,type:"투자 계획",
      title:p.rationale,at:p.createdAt})),
  ].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,4);
  const journalAvailable=notes!==null&&plans!==null;
  const status=accounts.length>0?"Tiger 개인 조회 연결":tiger===null?"연결 확인 필요":
    tiger.connections.some(c=>c.status==="CONNECTED")?"계좌 연결됨":"연결 대기";
  return <main className="home-data">
    <div className="page-intro home-data-heading">
      <div>
        <h1>대시보드</h1>
        <p>내 투자 현황과 최근 기록을 확인하세요.</p>
      </div>
      <div className="home-actions">
        <Link className="btn btn-outline" href="/private/alerts">투자 점검</Link>
        <Link className="btn btn-outline" href="/private/reports/weekly">주간 점검</Link>
        <Link className="btn btn-outline" href="/private/reports/monthly">월간 복기</Link>
        <Link className="btn btn-outline" href="/private/analysis?mode=COACHING">AI 코칭</Link>
        <Link className="btn btn-outline" href="/private/performance">장기 성과 검증</Link>
        <Link className="btn btn-outline" href="/private/risk">위험 계산기</Link>
        <Link className="btn btn-primary" href="/private/journal/new">+ 투자 일지 작성</Link>
      </div>
    </div>

    <div className="user-summary-grid">
      <section className="user-summary-card">
        <small>연결 상태</small>
        <strong>{status}</strong>
        <span>{accounts.length>0?accounts.length+"개 계좌 · 최근 보유 관측 기준":"증권사 데이터 수집 상태 확인"}</span>
        <Link href="/private/brokers">계좌 관리 →</Link>
      </section>
      <section className="user-summary-card">
        <small>관측된 보유 종목</small>
        <strong>{accounts.length>0?allPositions.length:"—"}</strong>
        <span>{accounts.length>0?"계좌별·통화별 원본 보유 수량":"계좌 조회 연결 후 표시"}</span>
        <Link href="/private/portfolio">포트폴리오 →</Link>
      </section>
      <section className="user-summary-card">
        <small>작성한 투자 기록</small>
        <strong>{journalAvailable?(notes.length+plans.length):"—"}</strong>
        <span>{journalAvailable?"현재 불러온 일지·계획 이력":"투자 기록 조회 불가"}</span>
        <Link href="/private/journal">투자 일지 →</Link>
      </section>
    </div>

    {accounts.length>0?<section className="user-panel">
      <div className="user-panel-head">
        <h2>계좌 요약</h2>
        <Link href="/private/portfolio">전체 포트폴리오 →</Link>
      </div>
      <div className="account-summary-list">
        {accounts.map(a=><article key={a.alias} className="account-summary-item">
          <div className="account-summary-head"><strong>{a.alias}</strong><small>{observedAt(a.asOf)} (NZ)</small></div>
          <div className="account-summary-values">
            <div><small>순자산</small><strong>{formatDecimal(a.assets?.netLiquidation)} <span className="account-currency">{a.assets?.currency??"통화 미확인"}</span></strong></div>
            <div><small>현금</small><strong>{formatDecimal(a.assets?.cashBalance)} <span className="account-currency">{a.assets?.currency??"통화 미확인"}</span></strong></div>
            <div><small>보유 종목</small><strong>{a.positions.length}</strong></div>
          </div>
        </article>)}
      </div>
      <p className="user-footnote">Tiger 조회 시점의 계좌 자산입니다. 서로 다른 통화나 통화 미확인 금액은 합산하지 않습니다.</p>
    </section>:<section className="user-panel">
      <div className="user-panel-head"><h2>연결된 계좌</h2><Link href="/private/brokers">연결 관리 →</Link></div>
      <p>{tiger===null?"계좌 상태를 확인하지 못했습니다. 다시 확인해 주세요.":"조회 가능한 계좌가 아직 없습니다."}</p>
    </section>}

    <div className="home-two-columns">
      <section className="user-panel">
        <div className="user-panel-head"><h2>보유 종목</h2><Link href="/private/portfolio">전체 보기 →</Link></div>
        {allPositions.length===0?<p className="user-empty">현재 조회된 보유 종목이 없습니다.</p>:
          <div className="user-list">{allPositions.slice(0,6).map((p,i)=>
            <Link className="user-list-row" href={"/private/journal?ticker="+encodeURIComponent(p.symbol)} key={p.alias+":"+p.symbol+":"+p.currency+":"+i}>
              <div><strong>{p.symbol}</strong><small>{p.alias} · {p.currency}</small></div>
              <div className="user-list-value"><strong>{formatDecimal(p.quantity)}주</strong>
                <small>{p.quote?.estimatedValue!==null && p.quote
                  ? "시세 기준 참고 평가액 "+formatDecimal(p.quote.estimatedValue)+" USD"
                  : "Tiger 조회 평가액 "+formatDecimal(p.marketValue)+" "+p.currency}</small>
                {p.quote && <small>{p.quote.mode==="US_DELAYED_15M"?"15분 지연":"시세 권한"}
                  {p.quote.stale?" · 과거 마지막 가격":""} · {formatDecimal(p.quote.price)} USD</small>}</div>
            </Link>)}</div>}
      </section>
      <section className="user-panel">
        <div className="user-panel-head"><h2>최근 투자 판단</h2><Link href="/private/journal">전체 일지 →</Link></div>
        {!journalAvailable?<p className="user-empty">일지 조회 상태를 확인하지 못했습니다.</p>:
          recent.length===0?<p className="user-empty">작성한 투자 기록이 없습니다. <Link href="/private/journal/new">첫 일지 작성 →</Link></p>:
          <div className="user-list">{recent.map((n,i)=>
            <Link className="user-list-row" href={"/private/journal?ticker="+encodeURIComponent(n.ticker)} key={n.ticker+":"+n.at+":"+i}>
              <div><strong>{n.ticker} <span className="user-list-kind">{n.type}</span></strong><small>{n.title.length>75?n.title.slice(0,75)+"…":n.title}</small></div>
              <time>{observedAt(n.at)}</time>
            </Link>)}</div>}
      </section>
    </div>

    {accounts.length>0&&<section className="user-panel">
      <div className="user-panel-head"><h2>최근 Tiger 주문 관측</h2><Link href="/private/trades">주문 이력 전체 →</Link></div>
      {orders.length===0?<p className="user-empty">현재 수집된 주문이 없습니다.</p>:
      <div className="user-list">{orders.map((o,i)=><div className="user-list-row" key={o.sourceRef+":"+i}>
        <div><strong>{o.symbol} · {o.side==="BUY"?"매수":"매도"}</strong><small>{orderAt(o.at)} · {o.status}</small></div>
        <div className="user-list-value"><strong>{o.filled===null?"수량 재수집 필요":formatDecimal(o.filled)+"주"}</strong><small>{formatDecimal(o.price)} {o.currency}</small></div>
      </div>)}</div>}
      <p className="user-footnote">주문 단위 기록이며 개별 체결이나 전체 거래이력을 확정한 자료는 아닙니다.</p>
    </section>}
  </main>;
}
