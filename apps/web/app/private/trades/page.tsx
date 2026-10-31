import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../auth";
import {fetchJournal} from "../../../lib/saas-trades-api";
import {currentWorkspace} from "../../../lib/require-workspace";
import {tigerPersonalRead,tigerPersonalDiagnostics} from "../../../lib/tiger-api";
import {PersonalOrderHistory} from "../tiger/personal-preview";
import {TigerRefreshControl} from "./tiger-refresh-control";

export const dynamic="force-dynamic";

/** Read-only landing. Manual and broker orders never appear as one ledger. */
export default async function TradesPage({
  searchParams,
}: {searchParams:Promise<{page?:string}>}) {
  const [workspace,session]=await Promise.all([currentWorkspace(),auth()]);
  if(!workspace||!session?.user?.id) redirect("/login");
  const query=await searchParams;
  const page=/^(?:0|[1-9][0-9]?)$/.test(query.page??"0")
    ?Math.min(20,Number(query.page??"0")):0;
  const [personal,notesResult]=await Promise.all([tigerPersonalRead(page),fetchJournal(session.user.id).then(value=>({available:true as const,value})).catch(()=>({available:false as const,value:[]}))]);
  const diagnosis=personal?.accounts.length ? null : await tigerPersonalDiagnostics();
  const hadTigerData=Boolean(diagnosis && (diagnosis.accountCount>0 || diagnosis.snapshotCounts.length>0));
  return <main style={{maxWidth:900,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href="/private">← 대시보드</Link></p>
    <h1>거래 기록</h1>
    <p>주문과 체결, 그때의 매매 이유를 거래별로 확인합니다. 투자 논리와 목표·손절 계획은 투자일지에서 별도로 관리합니다.</p>
    <nav aria-label="거래 기록 메뉴" style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"center",margin:"1rem 0 1.5rem"}}>
      <Link className="btn btn-outline" href="/private/trades/manual">직접 입력 거래</Link>
      <Link className="btn btn-outline" href="/private/journal">투자일지·계획</Link>
      <Link className="btn btn-primary" href="/private/trades/new">+ 거래 직접 추가</Link>
    </nav>
    <p className="user-muted" style={{fontSize:"0.9rem"}}>Tiger 주문은 증권사에서 관측한 자료입니다. 직접 입력 거래와 합산하지 않으며, 부분체결과 수수료는 확인된 범위에서만 표시합니다.</p>
    {personal && personal.accounts.length>0 && <TigerRefreshControl/>}
    {personal && personal.accounts.length>0
      ? <PersonalOrderHistory data={personal} page={page} reasons={notesResult.value} reasonsAvailable={notesResult.available}/>
      : <section className="state-panel">
          <h2>Tiger 주문 관측 이력</h2>
          <p>{personal===null
            ? hadTigerData
              ? "기존 개인 Tiger 계좌의 저장 기록이 있지만 현재 주문 목록을 불러오지 못했습니다. 기존 거래 기록을 삭제하거나 재등록하지 마세요."
              : "Tiger 주문 조회 상태를 확인할 수 없습니다. 계좌가 연결되지 않았거나 서비스가 일시적으로 응답하지 않을 수 있습니다. 기록이 없거나 삭제되었다는 뜻은 아닙니다."
            : "현재 이 계정에 표시 가능한 Tiger 주문 기록이 없습니다. 승인되지 않은 계정의 주문 정보는 표시되지 않습니다."}</p>
          {hadTigerData && <p><Link href="/private/tiger/diagnostics">기존 데이터 저장 상태 점검 →</Link></p>}
          <Link href="/private/brokers">증권사 연결 상태 확인 →</Link>
        </section>}
  </main>;
}
