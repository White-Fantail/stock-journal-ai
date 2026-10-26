import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentWorkspace } from "../../../../lib/require-workspace";
import { tigerCall, type TigerAction } from "../../../../lib/tiger-api";

export const metadata: Metadata = { title: "개인 Tiger 테스트" };
export const dynamic = "force-dynamic";

type Position = {
  symbol: string; currency: string; quantity: string;
  averageCost: string | null; marketValue: string | null;
  unrealizedPnl: string | null;
};
type PilotAccount = {
  alias: string; asOf: string | null;
  assets: {netLiquidation: string | null; cashBalance: string | null} | null;
  positions: Position[];
};
type PilotView = {
  coverage: "SNAPSHOT_ONLY"; verified: false; accounts: PilotAccount[];
};

function valid(value: unknown): value is PilotView {
  if (!value || typeof value !== "object") return false;
  const o=value as Record<string,unknown>;
  return o.coverage==="SNAPSHOT_ONLY" && o.verified===false &&
    Array.isArray(o.accounts) && o.accounts.length<=5 &&
    o.accounts.every((a: PilotAccount) => a && typeof a.alias==="string" &&
      Array.isArray(a.positions) && a.positions.length<=100 &&
      a.positions.every((p:Position) => p && typeof p.symbol==="string" &&
        typeof p.currency==="string" && typeof p.quantity==="string"));
}

export default async function PersonalTiger() {
  if (!await currentWorkspace()) redirect("/login");
  let snapshot:PilotView|null=null;
  try {
    // The backend independently verifies the immutable Google subject and RLS.
    const result=await tigerCall("personal-view" as TigerAction);
    if (valid(result)) snapshot=result;
  } catch { /* Do not reveal to other users whether this test exists. */ }
  if (!snapshot) return <main className="state-panel">
    <h1>개인 Tiger 테스트</h1>
    <p>이 기능을 사용할 수 없거나 아직 연결이 준비되지 않았습니다.</p>
    <Link href="/private/tiger">증권사 연결로 돌아가기</Link>
  </main>;

  return <main>
    <div className="page-intro">
      <span className="breadcrumb"><Link href="/private/tiger">← Tiger Brokers</Link></span>
      <h1>개인 Tiger 연결 · 임시 테스트</h1>
      <p>개인 API에서 가져온 시점별 조회 자료입니다. 정식 OAuth 인증이나 검증된 투자 원장이 아니며, 거래내역 전체를 의미하지 않습니다.</p>
    </div>
    <section className="state-panel">
      <span className="pill pill-warning">개인 조회 · 검증 전</span>
      <p>포지션 정보는 Tiger에서 확인된 시점의 참고 자료로만 표시합니다. 거래 체결·수수료·현금 흐름은 아직 검증하거나 가져오지 않았습니다.</p>
    </section>
    {snapshot.accounts.length===0 && <section className="state-panel">
      <h2>아직 수집된 계좌 정보가 없습니다.</h2>
      <p>격리된 Tiger 수집기가 연결되면 여기에서 첫 스냅샷을 확인할 수 있습니다.</p>
    </section>}
    {snapshot.accounts.map((a,i)=><section className="state-panel" key={i}>
      <h2>{a.alias}</h2>
      <p>마지막 수집: {a.asOf ? new Date(a.asOf).toLocaleString("ko-KR",{timeZone:"Pacific/Auckland"}) : "확인되지 않음"}</p>
      {a.assets && <p>순자산(기준 통화 미확인): {a.assets.netLiquidation ?? "미확인"} · 현금 잔고: {a.assets.cashBalance ?? "미확인"}</p>}
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",textAlign:"left",borderCollapse:"collapse"}}>
          <thead><tr><th>종목</th><th>수량</th><th>평균단가</th><th>시장가치</th><th>미실현손익</th></tr></thead>
          <tbody>{a.positions.map(p=><tr key={p.symbol+":"+p.currency}>
            <td>{p.symbol}</td><td>{p.quantity}</td>
            <td>{p.averageCost ?? "미확인"}</td><td>{p.marketValue ?? "미확인"}</td>
            <td>{p.unrealizedPnl ?? "미확인"} {p.currency}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>)}
  </main>;
}
