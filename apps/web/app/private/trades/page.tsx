import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { currentWorkspace } from "../../../lib/require-workspace";
import { fetchManualTrades, manualTradeEnabled, submitManualTrade } from "../../../lib/saas-trades-api";

export const dynamic = "force-dynamic";

/** Next Server Action: CSRF/origin protections from Next + fresh membership. */
async function recordManualExecution(formData: FormData) {
  "use server";
  if (!manualTradeEnabled()) redirect("/private/trades?error=disabled");
  const [session, workspace] = await Promise.all([auth(), currentWorkspace()]);
  const subject = session?.user?.id;
  if (!workspace || !subject || !/^[0-9]{3,255}$/.test(subject)) redirect("/login");
  if (formData.get("confirm") !== "yes") redirect("/private/trades?error=confirm");
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
  try {
    await submitManualTrade(subject, trade);
  } catch {
    // Never embed broker/trade data or internal error details in redirect URL.
    redirect("/private/trades?error=unavailable");
  }
  redirect("/private/trades?recorded=1");
}

/** Append a compensating event; originals remain immutable. */
async function correctManualExecution(formData: FormData) {
  "use server";
  if (!manualTradeEnabled()) redirect("/private/trades?error=disabled");
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
    redirect("/private/trades?error=invalid-correction");
  }
  try {
    await submitManualTrade(subject, {
      kind: "VOID", confirm: true,
      idempotencyKey: value("idempotencyKey"),
      voidsEventId: id, rationale: reason,
    });
  } catch {
    redirect("/private/trades?error=unavailable");
  }
  redirect("/private/trades?voided=1");
}

export default async function ManualTradesPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; recorded?: string; voided?: string }> }) {
  const [session, workspace, query] = await Promise.all([
    auth(), currentWorkspace(), searchParams,
  ]);
  if (!workspace || !session?.user?.id) redirect("/login");
  const active = manualTradeEnabled();
  let events: Awaited<ReturnType<typeof fetchManualTrades>>["events"] = [];
  let unavailable = false;
  if (active) {
    try {
      const response = await fetchManualTrades(session.user.id);
      events = response.events;
    } catch {
      unavailable = true;
    }
  }
  const voidedIds = new Set(events.filter(e => e.kind === "VOID" && e.voidsEventId)
    .map(e => e.voidsEventId));
  return (
    <main style={{maxWidth:900,margin:"2rem auto",padding:"0 1rem"}}>
      <p><Link href="/private">← 대시보드</Link></p>
      <h1>내 거래 기록</h1>
      <p>내가 직접 확인해 입력한 거래는 증권사에서 제공한 거래 사실과 구분됩니다. 모든 기록은 내 계정의 비공개 공간에 속합니다.</p>
      {!active ? (
        <p role="status">직접 거래 기록 입력은 현재 준비 중입니다. 사용자별 데이터 보호와 운영 보안 검증이 완료되면 사용할 수 있습니다.</p>
      ) : unavailable ? (
        <p role="alert">거래 원장 서비스를 사용할 수 없습니다. 기존 기록은 변경하지 않았습니다.</p>
      ) : (
        <>
          {query.recorded === "1" && <p role="status">사용자 확인 거래가 추가되었습니다.</p>}
          {query.voided === "1" && <p role="status">원본을 보존하고 취소 이벤트를 추가했습니다. 필요한 경우 올바른 체결을 새로 등록하세요.</p>}
          {query.error && <p role="alert">입력 내용을 확인하거나 나중에 다시 시도해 주세요. 기록 완료 여부가 불확실하면 목록을 먼저 확인하세요.</p>}
          <section>
            <h2>실제로 체결된 거래 추가</h2>
            <form action={recordManualExecution} style={{display:"grid",gap:12,maxWidth:480}}>
              <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
              <label>종목 심볼 <input required name="ticker" placeholder="TSLA" maxLength={32}/></label>
              <label>매매 구분 <select required name="side"><option value="BUY">매수</option><option value="SELL">매도</option></select></label>
              <label>체결 수량 <input required name="quantity" inputMode="decimal" placeholder="1.25" pattern="[0-9]+(\\.[0-9]+)?"/></label>
              <label>1주 체결가 <input required name="price" inputMode="decimal" placeholder="250.50" pattern="[0-9]+(\\.[0-9]+)?"/></label>
              <label>통화 <input required name="currency" defaultValue="USD" maxLength={3}/></label>
              <label>수수료 (모르면 비워두기) <input name="fee" inputMode="decimal" placeholder="미확인" pattern="[0-9]+(\\.[0-9]+)?"/></label>
              <label>체결 시각과 UTC 오프셋
                <input required name="executedAt" placeholder="2026-10-25T14:30:00-04:00" aria-describedby="timehelp"/>
              </label>
              <small id="timehelp">반드시 타임존을 포함하세요. 예: 뉴질랜드 +13:00 또는 미국 동부 -04:00 (서머타임에 따라 달라짐)</small>
              <label>매매 이유 (선택) <textarea name="rationale" rows={3} maxLength={3000}/></label>
              <label><input name="confirm" value="yes" type="checkbox" required/> 실제 체결된 거래이며 입력값을 확인했습니다.</label>
              <button type="submit">원장에 거래 추가</button>
            </form>
          </section>
          <section>
            <h2>최근 기록 (최대 50건)</h2>
            {events.length === 0 ? <p>아직 등록된 거래가 없습니다.</p> : (
              <div style={{overflowX:"auto"}}>
                <table><thead><tr><th>기록</th><th>종목</th><th>구분</th><th>수량</th><th>가격</th><th>수수료</th><th>체결 시각</th></tr></thead>
                  <tbody>{events.map(e=>(
                    <tr key={e.id}>
                      <td>{e.kind === "VOID" ? "취소 기록" : voidedIds.has(e.id) ? "취소됨" : "사용자 입력"}</td>
                      <td><Link href={`/private/trades/${e.id}`}>{e.ticker ?? "정정 이벤트"} (상세)</Link></td>
                      <td>{e.side === "BUY" ? "매수" : e.side === "SELL" ? "매도" : "—"}</td>
                      <td>{e.quantity ?? "—"}</td>
                      <td>{e.price && e.currency ? `${e.price} ${e.currency}` : "—"}</td>
                      <td>{e.fee ?? "미확인"}</td>
                      <td>{e.executedAt ?? e.createdAt}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p>정정은 해당 체결을 삭제하지 않고 별도의 취소(VOID) 이벤트를 추가합니다. 이 목록은 최근 50개 이벤트만 표시하므로 모든 과거 정정 여부를 확인하는 완전한 감사 보고서는 아닙니다.</p>
            {events.some(e => e.kind === "EXECUTION" && !voidedIds.has(e.id)) && (
              <section>
                <h3>체결 기록 정정</h3>
                <p>실제로 잘못 기록한 거래만 취소하세요. 원본 및 정정 이력은 남고, 잘못된 값을 직접 수정할 수 없습니다.</p>
                {events.filter(e => e.kind === "EXECUTION" && !voidedIds.has(e.id)).map(e => (
                  <details key={e.id} style={{marginBottom:12}}>
                    <summary>{e.ticker} {e.side === "BUY" ? "매수" : "매도"} {e.quantity}주 — {e.executedAt ?? "체결시각 미확인"}</summary>
                    <form action={correctManualExecution} style={{display:"grid",gap:8,maxWidth:480,padding:"0.75rem 0"}}>
                      <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
                      <input type="hidden" name="voidsEventId" value={e.id}/>
                      <label>정정 사유
                        <textarea name="rationale" rows={2} maxLength={3000} required placeholder="예: 중복 입력된 체결"/>
                      </label>
                      <label><input type="checkbox" name="confirmVoid" value="yes" required/> 이 거래 기록을 취소하며 원본은 보존됨을 확인했습니다.</label>
                      <button type="submit">취소 이벤트 기록</button>
                    </form>
                  </details>
                ))}
              </section>
            )}
          </section>
        </>
      )}
    </main>
  );
}
