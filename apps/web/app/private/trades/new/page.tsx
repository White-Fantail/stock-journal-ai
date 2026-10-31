import Link from "next/link";
import {randomUUID} from "node:crypto";
import {redirect} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {submitManualTrade} from "../../../../lib/saas-trades-api";

export const dynamic="force-dynamic";

/** Next Server Action: CSRF/origin protections from Next + fresh membership. */
async function recordManualExecution(formData: FormData) {
  "use server";
  const [session, workspace] = await Promise.all([auth(), currentWorkspace()]);
  const subject = session?.user?.id;
  if (!workspace || !subject || !/^[0-9]{3,255}$/.test(subject)) redirect("/login");
  if (formData.get("confirm") !== "yes") redirect("/private/trades/new?error=confirm");
  const value = (key: string) => {
    const raw = formData.get(key);
    return typeof raw === "string" ? raw.trim() : "";
  };
  const trade = {
    kind: "EXECUTION" as const,
    confirm: true as const,
    idempotencyKey: value("idempotencyKey"),
    ticker: value("ticker").toUpperCase(),
    side: value("side"),
    quantity: value("quantity"),
    price: value("price"),
    currency: value("currency").toUpperCase(),
    fee: value("fee") || null,
    executedAt: value("executedAt"),
    rationale: value("rationale"),
  };
  let recordedId="";
  try {
    recordedId=(await submitManualTrade(subject, trade)).id;
  } catch {
    // Never embed broker/trade data or internal error details in redirect URL.
    redirect("/private/trades/new?error=unavailable");
  }
  if(formData.get("recordIndicators")==="yes")redirect("/private/indicators/record?savedTrade=1&tradeEventId="+recordedId);
  redirect("/private/trades/manual?recorded=1");
}


export default async function NewTradePage({searchParams}:{
  searchParams:Promise<{error?:string}>
}) {
  if(!await currentWorkspace()) redirect("/login");
  const query=await searchParams;
  return <main style={{maxWidth:720,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href="/private/trades/manual">← 직접 입력 거래</Link></p>
    <h1>체결 기록 직접 추가</h1>
    <p>실제 체결을 확인한 경우에만 등록하세요. 이 기록은 Tiger API에서 확인된 체결과 구분하여 보관됩니다.</p>
    {query.error && <p role="alert">입력 내용을 확인하거나 나중에 다시 시도해 주세요. 등록 여부가 불확실하면 먼저 목록을 확인하세요.</p>}
    <section className="state-panel">
      <form action={recordManualExecution} style={{display:"grid",gap:12,maxWidth:480}}>
        <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
        <label>종목 심볼 <input required name="ticker" placeholder="TSLA" maxLength={32}/></label>
        <label>매매 구분 <select required name="side"><option value="BUY">매수</option><option value="SELL">매도</option></select></label>
        <label>체결 수량 <input required name="quantity" inputMode="decimal" placeholder="1.25" pattern="[0-9]+([.][0-9]+)?"/></label>
        <label>1주 체결가 <input required name="price" inputMode="decimal" placeholder="250.50" pattern="[0-9]+([.][0-9]+)?"/></label>
        <label>통화 <input required name="currency" defaultValue="USD" maxLength={3}/></label>
        <label>수수료 (모르면 비워두기) <input name="fee" inputMode="decimal" placeholder="미확인" pattern="[0-9]+([.][0-9]+)?"/></label>
        <small>직접 입력 거래는 수수료 통화를 별도로 저장하지 않습니다. 체결가의 통화를 수수료 통화로 추정하지 않으며, 서로 다르다면 매매 이유에 원본 수수료 통화를 함께 기록하세요.</small>
        <label>체결 시각과 UTC 오프셋
          <input required name="executedAt" placeholder="2026-10-25T14:30:00-04:00" aria-describedby="timehelp"/>
        </label>
        <small id="timehelp">반드시 타임존을 포함하세요. 예: 뉴질랜드 +13:00 또는 미국 동부 -04:00 (서머타임에 따라 달라짐)</small>
        <label>매매 이유 (선택) <textarea name="rationale" rows={3} maxLength={3000}/></label>
        <label><input name="confirm" value="yes" type="checkbox" required/> 실제 체결된 거래이며 입력값을 확인했습니다.</label>
        <label><input type="checkbox" name="recordIndicators" value="yes"/> 저장 후 당시 보조지표 기록하기 (선택)</label>
        <button type="submit" className="btn btn-primary">거래 기록 저장</button>
      </form>
    </section>
  </main>;
}
