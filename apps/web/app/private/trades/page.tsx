import Link from "next/link";
import {redirect} from "next/navigation";
import {currentWorkspace} from "../../../lib/require-workspace";
import {tigerPersonalRead,tigerPersonalDiagnostics} from "../../../lib/tiger-api";
import {PersonalOrderHistory} from "../tiger/personal-preview";
import {TigerRefreshControl} from "./tiger-refresh-control";

export const dynamic="force-dynamic";

/** Read-only landing. Manual and broker orders never appear as one ledger. */
export default async function TradesPage({
  searchParams,
}: {searchParams:Promise<{page?:string}>}) {
  if(!await currentWorkspace()) redirect("/login");
  const query=await searchParams;
  const page=/^(?:0|[1-9][0-9]?)$/.test(query.page??"0")
    ?Math.min(20,Number(query.page??"0")):0;
  const personal=await tigerPersonalRead(page);
  const diagnosis=personal?.accounts.length ? null : await tigerPersonalDiagnostics();
  const hadTigerData=Boolean(diagnosis && (diagnosis.accountCount>0 || diagnosis.snapshotCounts.length>0));
  return <main style={{maxWidth:900,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href="/private">← 대시보드</Link></p>
    <h1>거래 기록</h1>
    <p>Tiger에서 수집한 주문 관측 정보와 사용자가 직접 입력한 체결 기록은 출처가 다르므로 별도 화면에서 관리합니다.</p>
    <p><Link className="btn btn-outline" href="/private/trades/manual">직접 입력한 거래 보기 →</Link>{" "}
       <Link className="btn btn-primary" href="/private/trades/new">+ 거래 직접 추가</Link></p>
    {personal && personal.accounts.length>0 && <TigerRefreshControl/>}
    {personal && personal.accounts.length>0
      ? <PersonalOrderHistory data={personal} page={page}/>
      : <section className="state-panel">
          <h2>Tiger 주문 관측 이력</h2>
          <p>{hadTigerData
            ? "기존 개인 Tiger 계좌의 저장 기록이 있지만 현재 주문 목록을 불러오지 못했습니다. 기존 거래 기록을 삭제하거나 재등록하지 마세요."
            : "현재 이 계정에 표시 가능한 Tiger 주문 기록이 없습니다. 승인되지 않은 계정의 주문 정보는 표시되지 않습니다."}</p>
          {hadTigerData && <p><Link href="/private/tiger/diagnostics">기존 데이터 저장 상태 점검 →</Link></p>}
          <Link href="/private/brokers">증권사 연결 상태 확인 →</Link>
        </section>}
  </main>;
}
