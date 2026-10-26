import Link from "next/link";
import {randomUUID} from "node:crypto";
import {redirect,notFound} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {fetchManualTrades,submitJournal,submitJournalPlan,submitBrokerFillNote,type JournalKind} from "../../../../lib/saas-trades-api";
import {tigerLedgerRead} from "../../../../lib/tiger-api";
import {formatDecimal} from "../../../../lib/format-decimal";

export const dynamic="force-dynamic";
export const metadata={title:"투자 기록 작성 · Positionary"};

const TICKER=/^[A-Z0-9.:-]{1,32}$/;
const KINDS=new Set<JournalKind>([
  "THESIS","STRATEGY","REVIEW","TRADE_NOTE","WATCHLIST_ADD","WATCHLIST_REMOVE",
]);
const field=(form:FormData,name:string)=>{
  const value=form.get(name);
  return typeof value==="string"?value.trim():"";
};

/** CSRF, membership, provider access and tenant writes are checked server-side. */
async function addJournal(form:FormData) {
  "use server";
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  const subject=session?.user?.id;
  if(!workspace||!subject) redirect("/login");
  const kind=field(form,"kind") as JournalKind;
  const ticker=field(form,"ticker").toUpperCase();
  if(field(form,"confirmation")!=="yes" || !KINDS.has(kind) || !TICKER.test(ticker))
    redirect("/private/journal/new?error=invalid");
  try {
    await submitJournal(subject,{
      idempotencyKey:field(form,"idempotencyKey"),kind,ticker,
      content:field(form,"content"),
      tradeEventId:kind==="TRADE_NOTE" ? field(form,"tradeEventId")||null : null,
    });
  }catch{
    redirect("/private/journal/new?error=unavailable");
  }
  redirect("/private/journal?saved=journal&ticker="+encodeURIComponent(ticker));
}

async function addBrokerFillNote(form:FormData){
  "use server";
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  const subject=session?.user?.id;
  if(!workspace||!subject) redirect("/login");
  const ticker=field(form,"ticker").toUpperCase();
  if(field(form,"confirmation")!=="yes" || !TICKER.test(ticker))
    redirect("/private/journal/new?error=invalid");
  try{
    await submitBrokerFillNote(subject,{
      idempotencyKey:field(form,"idempotencyKey"),
      ticker,content:field(form,"content"),
      accountId:field(form,"accountId"),sourceRef:field(form,"sourceRef"),
    });
  }catch{
    redirect("/private/journal/new?error=unavailable");
  }
  redirect("/private/journal?saved=broker-note&ticker="+encodeURIComponent(ticker));
}

async function addPlan(form:FormData) {
  "use server";
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  const subject=session?.user?.id;
  if(!workspace||!subject) redirect("/login");
  const ticker=field(form,"ticker").toUpperCase();
  if(field(form,"confirmation")!=="yes" || !TICKER.test(ticker))
    redirect("/private/journal/new?error=invalid");
  const target=field(form,"targetPrice")||null;
  const stop=field(form,"stopPrice")||null;
  try{
    await submitJournalPlan(subject,{
      idempotencyKey:field(form,"idempotencyKey"),ticker,
      targetPrice:target,stopPrice:stop,
      priceCurrency:target||stop?field(form,"priceCurrency").toUpperCase():null,
      rationale:field(form,"rationale"),
    });
  }catch{
    redirect("/private/journal/new?error=unavailable");
  }
  redirect("/private/journal?saved=plan&ticker="+encodeURIComponent(ticker));
}


export default async function JournalNewPage({searchParams}:{
  searchParams:Promise<{ticker?:string;mode?:string;accountId?:string;sourceRef?:string;error?:string}>
}){
  const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
  if(!workspace||!session?.user?.id) redirect("/login");
  const ticker=(params.ticker??"").toUpperCase();
  const safeTicker=TICKER.test(ticker)?ticker:"";
  const mode=params.mode==="plan"?"plan":params.mode==="broker"?"broker":"note";
  let brokerFill:Awaited<ReturnType<typeof tigerLedgerRead>>["executions"][number]|undefined;
  if(mode==="broker"){
    if(!safeTicker||!params.accountId||!params.sourceRef) notFound();
    try{
      const ledger=await tigerLedgerRead();
      if(!ledger.readEnabled) notFound();
      brokerFill=ledger.executions.find(e=>e.symbol===safeTicker &&
        e.accountId===params.accountId && e.sourceRef===params.sourceRef);
    }catch{notFound();}
    if(!brokerFill) notFound();
  }
  let manual:Awaited<ReturnType<typeof fetchManualTrades>>["events"]=[];
  if(mode==="note"&&safeTicker){
    try{manual=(await fetchManualTrades(session.user.id)).events;}catch{ /* No optional association. */ }
  }
  const activeManual=manual.filter(e=>e.kind==="EXECUTION"&&e.ticker===safeTicker);
  const back="/private/journal"+(safeTicker?"?ticker="+encodeURIComponent(safeTicker):"");
  return <main className="journal-page">
    <div className="page-intro">
      <span className="breadcrumb"><Link href={back}>← {safeTicker||"투자 일지"}</Link></span>
      <h1>{mode==="plan"?"목표·손절 계획 변경":mode==="broker"?"체결 복기 작성":"투자 판단 작성"}</h1>
      <p>{mode==="broker"?"증권사가 확인한 체결에 내 판단을 연결합니다. 실제 주문은 생성되지 않습니다.":
        mode==="plan"?"투자 계획과 변경 근거를 기록합니다. 실제 주문은 생성되지 않습니다.":
        "종목별 투자 논리, 판단 변화, 매매 복기를 직접 기록합니다."}</p>
    </div>
    {params.error&&<p role="alert">입력 내용을 확인해 주세요. 저장 여부가 불확실하면 기존 기록부터 확인하세요.</p>}
    <section className="journal-compose journal-create-page">
    {mode==="broker"&&brokerFill ?
      <form action={addBrokerFillNote} className="journal-compose-form">
        <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
        <input type="hidden" name="ticker" value={brokerFill.symbol}/>
        <input type="hidden" name="accountId" value={brokerFill.accountId}/>
        <input type="hidden" name="sourceRef" value={brokerFill.sourceRef}/>
        <p className="journal-form-hint">독립 검증 체결 · {brokerFill.symbol} · {formatDecimal(brokerFill.quantity)}주 · {formatDecimal(brokerFill.price)} {brokerFill.currency}</p>
        <label>이 체결의 매매 근거와 복기<textarea name="content" rows={7} maxLength={6000} required placeholder="진입·청산 근거, 잘한 점, 다음에 보완할 점"/></label>
        <label className="journal-confirm"><input type="checkbox" name="confirmation" value="yes" required/> 직접 작성한 판단이며 주문이 아닙니다.</label>
        <button type="submit" className="btn btn-primary journal-save">복기 저장</button>
      </form>
    :mode==="plan"?
      <form action={addPlan} className="journal-compose-form">
        <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
        <label>종목 심볼<input name="ticker" defaultValue={safeTicker} required maxLength={32} pattern="[A-Za-z0-9.:-]{1,32}" placeholder="TSLA"/></label>
        <div className="journal-form-three">
          <label>목표가<input name="targetPrice" inputMode="decimal" pattern="(0|[1-9][0-9]{0,23})([.][0-9]{1,12})?" placeholder="미설정"/></label>
          <label>손절가<input name="stopPrice" inputMode="decimal" pattern="(0|[1-9][0-9]{0,23})([.][0-9]{1,12})?" placeholder="미설정"/></label>
          <label>통화<input name="priceCurrency" defaultValue="USD" required maxLength={3} pattern="[A-Za-z]{3}"/></label>
        </div>
        <p className="journal-form-hint">두 가격을 모두 비우면 기존 계획을 해제하는 이력을 남깁니다.</p>
        <label>계획을 정하거나 변경하는 이유<textarea name="rationale" rows={6} maxLength={3000} required/></label>
        <label className="journal-confirm"><input type="checkbox" name="confirmation" value="yes" required/> 개인 계획이며 실제 주문이 아닙니다.</label>
        <button type="submit" className="btn btn-primary journal-save">계획 저장</button>
      </form>
    :<form action={addJournal} className="journal-compose-form">
      <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
      <div className="journal-form-two">
        <label>종목 심볼<input name="ticker" defaultValue={safeTicker} required maxLength={32} pattern="[A-Za-z0-9.:-]{1,32}" placeholder="TSLA"/></label>
        <label>기록 유형<select name="kind" defaultValue="THESIS">
          <option value="THESIS">투자 논리</option>
          <option value="STRATEGY">전략 변경</option>
          <option value="REVIEW">매매 복기</option>
          <option value="TRADE_NOTE">체결 메모</option>
          <option value="WATCHLIST_ADD">관심종목 추가</option>
          <option value="WATCHLIST_REMOVE">관심종목 제외</option>
        </select></label>
      </div>
      <label>내 생각 (관심종목 추가·제외는 선택)<textarea name="content" rows={7} maxLength={6000} placeholder="투자 이유, 확인할 지표, 손절·청산을 재검토할 조건 등"/></label>
      {activeManual.length>0&&<label>관련 직접 입력 체결 (체결 메모인 경우에만 연결)
        <select name="tradeEventId" defaultValue=""><option value="">연결하지 않음</option>
          {activeManual.map(e=><option key={e.id} value={e.id}>{e.side==="BUY"?"매수":"매도"} {formatDecimal(e.quantity)}주 · {e.executedAt??e.createdAt}</option>)}
        </select></label>}
      <label className="journal-confirm"><input type="checkbox" name="confirmation" value="yes" required/> 내가 직접 작성한 판단입니다.</label>
      <button type="submit" className="btn btn-primary journal-save">기록 저장</button>
    </form>}
    </section>
  </main>;
}
