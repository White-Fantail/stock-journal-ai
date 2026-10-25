import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { currentWorkspace } from "../../../../lib/require-workspace";
import { fetchTradeDetail, manualTradeEnabled } from "../../../../lib/saas-trades-api";

export const dynamic = "force-dynamic";

export default async function TradeDetail({params}:{
  params:Promise<{id:string}>
}) {
  const [session,workspace,{id}] = await Promise.all([auth(),currentWorkspace(),params]);
  if(!workspace || !session?.user?.id) redirect("/login");
  if(!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if(!manualTradeEnabled()) return <main><p>체결 상세 기능은 운영 검증 후 활성화됩니다.</p></main>;
  let trade;
  try {trade=await fetchTradeDetail(session.user.id,id);}
  catch {notFound();}
  return <main style={{maxWidth:700,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href="/private/trades">← 거래 원장</Link></p>
    <h1>{trade.ticker ?? "거래 정정"} · {trade.kind === "EXECUTION" ? "체결 기록" : "취소 기록"}</h1>
    <dl>
      <dt>출처</dt><dd>사용자가 직접 확인한 기록 · 증권사 확인과 별개</dd>
      <dt>구분</dt><dd>{trade.side === "BUY" ? "매수" : trade.side === "SELL" ? "매도" : "—"}</dd>
      <dt>체결 수량</dt><dd>{trade.quantity ?? "—"}</dd>
      <dt>체결가</dt><dd>{trade.price ?? "—"} {trade.currency ?? ""}</dd>
      <dt>수수료</dt><dd>{trade.fee ?? "미확인"}</dd>
      <dt>체결 시각</dt><dd>{trade.executedAt ?? "—"}</dd>
      <dt>작성 시각</dt><dd>{trade.createdAt}</dd>
      <dt>변경 이력</dt><dd>{trade.voidsEventId ? <Link href={"/private/trades/" + trade.voidsEventId}>취소 대상 원본 보기</Link> : "원본 기록"}</dd>
      <dt>매매 이유/정정 사유</dt><dd style={{whiteSpace:"pre-wrap"}}>{trade.rationale ?? "미기록"}</dd>
    </dl>
    <p>원본 체결은 수정하지 않습니다. 정정하려면 원장 목록에서 취소 이벤트를 추가하고 정확한 체결을 다시 기록하세요.</p>
  </main>;
}
