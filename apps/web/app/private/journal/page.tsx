import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { currentWorkspace } from "../../../lib/require-workspace";
import { fetchJournal, submitJournal, manualTradeEnabled, type JournalKind } from "../../../lib/saas-trades-api";

export const dynamic = "force-dynamic";

async function addJournal(form: FormData) {
  "use server";
  if (!manualTradeEnabled()) redirect("/private/journal?error=disabled");
  const [session, workspace] = await Promise.all([auth(),currentWorkspace()]);
  const subject = session?.user?.id;
  if (!workspace || !subject) redirect("/login");
  const field = (name: string) => typeof form.get(name) === "string" ? String(form.get(name)).trim() : "";
  if (field("confirmation") !== "yes") redirect("/private/journal?error=confirmation");
  const kind = field("kind") as JournalKind;
  try {
    await submitJournal(subject,{
      idempotencyKey: field("idempotencyKey"), kind,
      ticker: field("ticker").toUpperCase(), content: field("content"),
      tradeEventId: field("tradeEventId") || null,
    });
  } catch {
    redirect("/private/journal?error=unavailable");
  }
  redirect("/private/journal?saved=1");
}

export default async function JournalPage({
  searchParams,
}: {searchParams:Promise<{saved?:string;error?:string}>}) {
  const [workspace,session,params] = await Promise.all([currentWorkspace(),auth(),searchParams]);
  if (!workspace || !session?.user?.id) redirect("/login");
  const enabled=manualTradeEnabled();
  let entries: Awaited<ReturnType<typeof fetchJournal>> = [];
  let unavailable=false;
  if(enabled) {
    try { entries=await fetchJournal(session.user.id); } catch { unavailable=true; }
  }
  return <main style={{maxWidth:880,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href="/private">← 워크스페이스</Link> · <Link href="/private/trades">체결 기록</Link></p>
    <h1>투자 일지</h1>
    <p>투자 이유·분석·전략·복기와 관심종목은 사용자 작성 기록이며, 브로커 체결 사실이나 AI 추론과 구분됩니다. 수정은 새 이력으로 남깁니다.</p>
    {!enabled ? <p role="status">투자 일지 기능은 운영 검증 후 활성화됩니다.</p> :
     unavailable ? <p role="alert">투자 일지 서버를 사용할 수 없습니다.</p> :
     <>
      {params.saved && <p role="status">새로운 일지 이력이 저장됐습니다.</p>}
      {params.error && <p role="alert">입력값을 확인해 주세요. 저장 상태가 불확실하면 먼저 목록을 확인하세요.</p>}
      <section><h2>새 기록 / 변경 이력</h2>
        <form action={addJournal} style={{display:"grid",gap:12,maxWidth:570}}>
          <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
          <label>종목 <input name="ticker" placeholder="TSLA" required maxLength={32}/></label>
          <label>기록 종류 <select name="kind" required>
            <option value="THESIS">투자 논리</option>
            <option value="STRATEGY">전략 및 목표 변경</option>
            <option value="REVIEW">매매 복기</option>
            <option value="TRADE_NOTE">체결 설명</option>
            <option value="WATCHLIST_ADD">관심종목 추가</option>
            <option value="WATCHLIST_REMOVE">관심종목 제외</option>
          </select></label>
          <label>내용 (관심종목 추가/제외에서는 비워두기)
            <textarea name="content" rows={5} maxLength={6000}/></label>
          <label>체결 ID (체결 설명에만 사용, 선택사항)
            <input name="tradeEventId" placeholder="연결할 내 체결 이벤트 UUID"/></label>
          <label><input name="confirmation" value="yes" type="checkbox" required/> 내가 작성한 정보임을 확인합니다.</label>
          <button type="submit">일지 이력 저장</button>
        </form>
      </section>
      <section><h2>최근 작성 기록 (최대 200건)</h2>
      {entries.length===0 ? <p>등록된 기록이 없습니다.</p> :
        entries.map(e=><article key={e.id} style={{borderBottom:"1px solid #aaa",padding:"0.75rem 0"}}>
          <strong>{e.ticker} · {e.kind}</strong> <small>{e.createdAt}</small>
          {e.content && <p style={{whiteSpace:"pre-wrap"}}>{e.content}</p>}
          <small>출처: 직접 작성 · {e.tradeEventId ? `연결 체결: ${e.tradeEventId}`:"독립 기록"}</small>
        </article>)}
      </section>
     </>}
  </main>;
}
