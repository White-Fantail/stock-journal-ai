import Link from "next/link";
import {randomUUID} from "node:crypto";
import {notFound,redirect} from "next/navigation";
import {auth} from "../../../../../auth";
import {currentWorkspace} from "../../../../../lib/require-workspace";
import {fetchTradeDetail,submitManualTrade} from "../../../../../lib/saas-trades-api";
import {formatDecimal} from "../../../../../lib/format-decimal";

export const dynamic="force-dynamic";

/** Append a compensating event; originals remain immutable. */
async function correctManualExecution(formData: FormData) {
  "use server";
  const [session, workspace] = await Promise.all([auth(), currentWorkspace()]);
  const subject = session?.user?.id;
  if (!workspace || !subject || !/^[0-9]{3,255}$/.test(subject)) redirect("/login");
  const value = (key: string) => {
    const raw = formData.get(key);
    return typeof raw === "string" ? raw.trim() : "";
  };
  const id = value("voidsEventId");
  const reason = value("rationale");
  if (formData.get("confirmVoid") !== "yes" || !/^[0-9a-f-]{36}$/i.test(id) ||
      reason.length < 1 || reason.length > 3000) {
    redirect("/private/trades/manual?error=invalid-correction");
  }
  try {
    await submitManualTrade(subject, {
      kind: "VOID", confirm: true,
      idempotencyKey: value("idempotencyKey"),
      voidsEventId: id, rationale: reason,
    });
  } catch {
    redirect("/private/trades/manual?error=unavailable");
  }
  redirect("/private/trades/manual?voided=1");
}


export default async function CorrectTradePage({params}:{
  params:Promise<{id:string}>
}){
  const [session,workspace,{id}]=await Promise.all([auth(),currentWorkspace(),params]);
  if(!workspace||!session?.user?.id) redirect("/login");
  if(!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let trade;
  try{trade=await fetchTradeDetail(session.user.id,id);}
  catch{notFound();}
  if(trade.kind!=="EXECUTION") notFound();
  return <main style={{maxWidth:720,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href={"/private/trades/"+trade.id}>← 거래 상세</Link></p>
    <h1>직접 입력 거래 정정</h1>
    <p>{trade.ticker} · {trade.side==="BUY"?"매수":"매도"} · {formatDecimal(trade.quantity)}주</p>
    <p>원본을 직접 변경하지 않고 취소(VOID) 기록을 추가합니다. 이후 올바른 거래는 별도로 새로 입력해야 합니다.</p>
    <section className="state-panel">
      <form action={correctManualExecution} style={{display:"grid",gap:12,maxWidth:480}}>
        <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
        <input type="hidden" name="voidsEventId" value={trade.id}/>
        <label>정정 사유
          <textarea name="rationale" rows={3} maxLength={3000} required placeholder="예: 중복으로 입력한 거래"/>
        </label>
        <label><input type="checkbox" name="confirmVoid" value="yes" required/> 원본이 보존되며 취소 이력이 남는 것을 확인했습니다.</label>
        <button type="submit" className="btn btn-primary">이 거래 취소 기록 저장</button>
      </form>
    </section>
  </main>;
}
