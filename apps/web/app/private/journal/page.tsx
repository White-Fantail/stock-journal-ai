import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { currentWorkspace } from "../../../lib/require-workspace";
import {
  fetchJournal, fetchJournalPlans, fetchManualTrades, fetchIndicatorRecords,
} from "../../../lib/saas-trades-api";
import { JournalWorkspace } from "./journal-workspace";
import { tigerLedgerRead, tigerPersonalRead, type TigerLedgerRead } from "../../../lib/tiger-api";

export const dynamic="force-dynamic";
export const metadata={title:"투자 일지 · Positionary"};
export default async function JournalPage({
  searchParams,
}:{searchParams:Promise<{saved?:string;error?:string;ticker?:string}>}) {
  const [workspace,session,params]=await Promise.all([
    currentWorkspace(),auth(),searchParams,
  ]);
  if(!workspace||!session?.user?.id) redirect("/login");
  const [personal,indicatorHistory]=await Promise.all([tigerPersonalRead(),
    fetchIndicatorRecords(session.user.id,{ticker:null,tradeEventId:null,journalId:null}).catch(()=>null),
  ]);
  let entries:Awaited<ReturnType<typeof fetchJournal>>=[];
  let plans:Awaited<ReturnType<typeof fetchJournalPlans>>=[];
  let trades:Awaited<ReturnType<typeof fetchManualTrades>>["events"]=[];
  let unavailable=false;
  let tradesUnavailable=false;
  let brokerRead:TigerLedgerRead|null=null;
  {
    const [notesResult,planResult,tradeResult]=await Promise.allSettled([
      fetchJournal(session.user.id),fetchJournalPlans(session.user.id),
      fetchManualTrades(session.user.id),
    ]);
    // A manual-trade outage must not erase otherwise readable investment notes.
    // Keep notes and plans together so missing investment records are never shown
    // as a genuine empty history.
    if(notesResult.status==="fulfilled" && planResult.status==="fulfilled"){
      entries=notesResult.value;
      plans=planResult.value;
    }else unavailable=true;
    if(tradeResult.status==="fulfilled") trades=tradeResult.value.events;
    else tradesUnavailable=true;
  }
  // Broker readability is independent: an unavailable Tiger service must never
  // hide the user-authored journal, nor supply example trades.
  if(!unavailable){
    try{ brokerRead=await tigerLedgerRead(); }
    catch{ brokerRead=null; }
  }
  return <main className="journal-page">
    <div className="page-intro journal-intro journal-page-heading">
      <div><span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
        <h1>투자 일지</h1>
        <p>각 종목의 현재 계획과 판단 근거를 먼저 확인하고, 필요할 때 복기하거나 변경 이력을 살펴보세요.</p></div>
      <Link className="btn btn-primary" href="/private/journal/new">+ 일지 작성</Link>
    </div>
    {unavailable && <div className="state-panel" role="alert">
      <h2>비공개 투자일지를 불러올 수 없습니다.</h2>
      <p>기존 기록은 변경되지 않았습니다. 서버가 정상인지 확인한 뒤 다시 시도해 주세요.</p>
      <Link href="/private/journal" className="btn btn-outline">다시 확인</Link>
    </div>}
    {!unavailable && personal===null && <div className="state-panel" role="status">
      <p>Tiger 보유·주문 자료를 현재 확인할 수 없습니다. 계좌 미연결 또는 일시적 조회 오류일 수 있으며, 내 투자일지와 계획 기록은 계속 표시됩니다.</p>
    </div>}
    {!unavailable && tradesUnavailable && <div className="state-panel" role="alert">
      <p>직접 입력한 거래 기록을 현재 불러올 수 없습니다. 투자일지와 투자계획은 정상적으로 표시하며, 거래 연결 목록만 일부 누락될 수 있습니다.</p>
      <Link href="/private/trades/manual">직접 입력 거래 다시 확인</Link>
    </div>}
    {!unavailable && params.saved && <p role="status">
      {params.saved==="plan"?"새 투자 계획의 변경 이력을 저장했습니다.":
       params.saved==="checkin"?"현재 계획에 연결된 자기평가와 투자 복기를 저장했습니다.":
       params.saved==="broker-note"?"검증 체결에 연결한 투자일지 메모를 저장했습니다.":
       params.saved==="observed-note"?"Tiger 관측 주문·체결에 연결한 나의 매매 복기를 저장했습니다.":"새 투자일지 기록을 저장했습니다."}
    </p>}
    {!unavailable && params.error && <p role="alert">
      입력한 내용을 확인해 주세요. 저장 결과가 불확실하다면 기록 목록을 먼저 확인해 주세요.
    </p>}
    <p><a href="/private/indicators">나의 보조지표 · 기준 관리와 당시 값 기록 →</a></p>
    <JournalWorkspace enabled={!unavailable} initialTicker={params.ticker}
      indicatorHistory={indicatorHistory} entries={entries} plans={plans} trades={trades} brokerRead={brokerRead}
      personalPositions={personal?.accounts.flatMap(a=>a.positions)??[]}
      personalOrders={personal?.accounts.flatMap(a=>a.orders)??[]}
      personalFills={personal?.accounts.flatMap(a=>a.fillObservations)??[]}/>
    <p className="journal-limit">목표·손절은 직접 작성한 투자 계획이며 실제 증권사 주문이 아닙니다. 거래 관측 및 검증 체결은 각각의 출처를 구분하여 표시합니다.</p>
  </main>;
}
