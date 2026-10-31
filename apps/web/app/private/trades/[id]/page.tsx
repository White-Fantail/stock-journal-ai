import {IndicatorHistory} from "../../indicators/history";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { currentWorkspace } from "../../../../lib/require-workspace";
import { fetchTradeDetail } from "../../../../lib/saas-trades-api";
import { formatQuantity,formatMoney } from "../../../../lib/format-decimal";

export const dynamic = "force-dynamic";

export default async function TradeDetail({params}:{
  params:Promise<{id:string}>
}) {
  const [session,workspace,{id}] = await Promise.all([auth(),currentWorkspace(),params]);
  if(!workspace || !session?.user?.id) redirect("/login");
  if(!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let trade;
  try {trade=await fetchTradeDetail(session.user.id,id);}
  catch {notFound();}
  return <main style={{maxWidth:700,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href="/private/trades/manual">← 직접 입력 거래</Link></p>
    <h1>{trade.ticker ?? "거래 정정"} · {trade.kind === "EXECUTION" ? "체결 기록" : "취소 기록"}</h1>
    <dl>
      <dt>출처</dt><dd>사용자가 직접 확인한 기록 · 증권사 확인과 별개</dd>
      <dt>구분</dt><dd>{trade.side === "BUY" ? "매수" : trade.side === "SELL" ? "매도" : "—"}</dd>
      <dt>체결 수량</dt><dd>{formatQuantity(trade.quantity,"—")}</dd>
      <dt>체결가</dt><dd>{formatMoney(trade.price,"—")} {trade.currency ?? ""}</dd>
      <dt>수수료</dt><dd>{trade.fee===null?"미확인":formatMoney(trade.fee)+" (수수료 통화 별도 미기록)"}</dd>
      <dt>체결 시각</dt><dd>{trade.executedAt ?? "—"}</dd>
      <dt>작성 시각</dt><dd>{trade.createdAt}</dd>
      <dt>변경 이력</dt><dd>{trade.voidsEventId ? <Link href={"/private/trades/" + trade.voidsEventId}>취소 대상 원본 보기</Link> : "원본 기록"}</dd>
      <dt>매매 이유/정정 사유</dt><dd style={{whiteSpace:"pre-wrap"}}>{trade.rationale ?? "미기록"}</dd>
    </dl>
    {trade.kind==="EXECUTION" && <p><Link className="btn btn-outline" href={"/private/journal?ticker="+encodeURIComponent(trade.ticker??"")}>투자 일지에서 종목 전략과 계획 보기 →</Link></p>}
    {trade.kind==="EXECUTION"&&<p><Link className="btn btn-outline" href={"/private/trades/"+trade.id+"/correct"}>이 체결 정정하기 →</Link></p>}
    {trade.kind==="EXECUTION"&&<>
      <p><a className="btn btn-outline" href={"/private/indicators/record?tradeEventId="+trade.id}>당시 보조지표 기록 →</a></p>
      <IndicatorHistory subject={session.user.id} filter={{ticker:null,tradeEventId:trade.id,journalId:null}}/>
    </>}
    <p>원본 체결은 수정하지 않습니다. 잘못된 경우 별도 정정 페이지에서 취소 이벤트를 추가한 후 정확한 체결을 다시 등록하세요.</p>
  </main>;
}
