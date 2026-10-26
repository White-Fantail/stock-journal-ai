import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {fetchManualTrades} from "../../../../lib/saas-trades-api";
import {formatDecimal} from "../../../../lib/format-decimal";

export const dynamic="force-dynamic";

export default async function ManualTradeList({searchParams}:{
  searchParams:Promise<{recorded?:string;voided?:string}>
}){
  const [session,workspace,query]=await Promise.all([auth(),currentWorkspace(),searchParams]);
  if(!workspace||!session?.user?.id) redirect("/login");
  let events:Awaited<ReturnType<typeof fetchManualTrades>>["events"]=[];
  let unavailable=false;
  try{events=(await fetchManualTrades(session.user.id)).events;}
  catch{unavailable=true;}
  const voidedIds=new Set(events.filter(e=>e.kind==="VOID"&&e.voidsEventId).map(e=>e.voidsEventId));
  return <main style={{maxWidth:900,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href="/private/trades">← 거래 기록</Link></p>
    <h1>직접 입력한 거래</h1>
    <p>내가 확인하여 직접 입력한 거래만 표시합니다. Tiger 주문 관측 자료와 자동으로 합치지 않습니다.</p>
    <p><Link className="btn btn-primary" href="/private/trades/new">+ 거래 추가</Link></p>
    {query.recorded==="1"&&<p role="status">사용자가 확인한 거래가 추가되었습니다.</p>}
    {query.voided==="1"&&<p role="status">원본을 보존하고 취소 기록을 추가했습니다.</p>}
    {unavailable?<p role="alert">직접 입력한 거래 기록을 불러올 수 없습니다. 기존 기록은 변경되지 않았습니다.</p>
    :<section className="state-panel">
      <h2>내가 등록한 체결과 정정 이력</h2>
      {events.length===0?<p>직접 입력한 거래가 없습니다.</p>:
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%"}}>
          <thead><tr><th>기록</th><th>종목</th><th>방향</th><th>수량</th><th>체결가</th><th>수수료</th><th>체결 시각</th><th>상세</th></tr></thead>
          <tbody>{events.map(e=><tr key={e.id}>
            <td>{e.kind==="VOID"?"정정 기록":voidedIds.has(e.id)?"취소된 기록":"직접 입력"}</td>
            <td>{e.ticker??"정정 이벤트"}</td>
            <td>{e.side==="BUY"?"매수":e.side==="SELL"?"매도":"—"}</td>
            <td>{formatDecimal(e.quantity,"—")}</td>
            <td>{formatDecimal(e.price,"—")} {e.currency??""}</td>
            <td>{formatDecimal(e.fee,"미확인")}</td>
            <td>{e.executedAt??e.createdAt}</td>
            <td><Link href={"/private/trades/"+e.id}>상세 / 정정 →</Link></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <p>현재 조회 API는 최근 50개 이벤트까지만 제공합니다. 이 화면은 전체 감사 내역이 아닙니다. 정정은 각 기록의 상세 화면에서 진행합니다.</p>
    </section>}
  </main>;
}
