import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { currentWorkspace } from "../../../lib/require-workspace";
import {
  fetchJournal, fetchJournalPlans, fetchManualTrades,
  submitJournal, submitJournalPlan, manualTradeEnabled,
  type JournalKind,
} from "../../../lib/saas-trades-api";
import { JournalWorkspace } from "./journal-workspace";

export const dynamic="force-dynamic";
export const metadata={title:"투자 일지 · Positionary"};
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
  if(!manualTradeEnabled()) redirect("/private/journal?error=disabled");
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  const subject=session?.user?.id;
  if(!workspace||!subject) redirect("/login");
  const kind=field(form,"kind") as JournalKind;
  const ticker=field(form,"ticker").toUpperCase();
  if(field(form,"confirmation")!=="yes" || !KINDS.has(kind) || !TICKER.test(ticker))
    redirect("/private/journal?error=invalid");
  try {
    await submitJournal(subject,{
      idempotencyKey:field(form,"idempotencyKey"),kind,ticker,
      content:field(form,"content"),
      tradeEventId:kind==="TRADE_NOTE" ? field(form,"tradeEventId")||null : null,
    });
  }catch{
    redirect("/private/journal?error=unavailable");
  }
  redirect("/private/journal?saved=journal");
}

async function addPlan(form:FormData) {
  "use server";
  if(!manualTradeEnabled()) redirect("/private/journal?error=disabled");
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  const subject=session?.user?.id;
  if(!workspace||!subject) redirect("/login");
  const ticker=field(form,"ticker").toUpperCase();
  if(field(form,"confirmation")!=="yes" || !TICKER.test(ticker))
    redirect("/private/journal?error=invalid");
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
    redirect("/private/journal?error=unavailable");
  }
  redirect("/private/journal?saved=plan");
}

export default async function JournalPage({
  searchParams,
}:{searchParams:Promise<{saved?:string;error?:string}>}) {
  const [workspace,session,params]=await Promise.all([
    currentWorkspace(),auth(),searchParams,
  ]);
  if(!workspace||!session?.user?.id) redirect("/login");
  const enabled=manualTradeEnabled();
  let entries:Awaited<ReturnType<typeof fetchJournal>>=[];
  let plans:Awaited<ReturnType<typeof fetchJournalPlans>>=[];
  let trades:Awaited<ReturnType<typeof fetchManualTrades>>["events"]=[];
  let unavailable=false;
  if(enabled){
    const [notesResult,planResult,tradeResult]=await Promise.allSettled([
      fetchJournal(session.user.id),fetchJournalPlans(session.user.id),
      fetchManualTrades(session.user.id),
    ]);
    if(notesResult.status==="fulfilled" && planResult.status==="fulfilled" &&
       tradeResult.status==="fulfilled"){
      entries=notesResult.value;
      plans=planResult.value;
      trades=tradeResult.value.events;
    }else unavailable=true;
  }
  return <main className="journal-page">
    <div className="page-intro journal-intro">
      <span className="breadcrumb"><Link href="/private">← 내 대시보드</Link></span>
      <span className="eyebrow journal-eyebrow">MY INVESTMENT JOURNAL</span>
      <h1>투자 일지</h1>
      <p>매수·매도의 결과만이 아니라 <strong>그때 왜 그렇게 판단했는지</strong> 남겨보세요. 투자 논리와 계획의 변화를 종목별 시간순으로 확인할 수 있습니다.</p>
    </div>
    {!enabled && <div className="info-strip" role="status">
      <span aria-hidden="true">◌</span><div><strong>일지 저장 기능은 운영 검증 중입니다.</strong>
      <p>종목별 기록 화면을 준비했습니다. 실제 데이터 저장은 사용자 격리·운영 백업 검증 후 활성화됩니다. 가상의 일지나 수익은 표시하지 않습니다.</p></div>
    </div>}
    {unavailable && <div className="state-panel" role="alert">
      <h2>비공개 투자일지를 불러올 수 없습니다.</h2>
      <p>기존 기록은 변경되지 않았습니다. 서버가 정상인지 확인한 뒤 다시 시도해 주세요.</p>
      <Link href="/private/journal" className="btn btn-outline">다시 확인</Link>
    </div>}
    {enabled&&!unavailable && params.saved && <p role="status">
      {params.saved==="plan"?"새 투자 계획의 변경 이력을 저장했습니다.":"새 투자일지 기록을 저장했습니다."}
    </p>}
    {enabled&&!unavailable && params.error && <p role="alert">
      입력한 내용을 확인해 주세요. 저장 결과가 불확실하다면 기록 목록을 먼저 확인해 주세요.
    </p>}
    <JournalWorkspace enabled={enabled&&!unavailable}
      entries={entries} plans={plans} trades={trades}
      noteAction={addJournal} planAction={addPlan}
      noteKey={randomUUID()} planKey={randomUUID()}/>
    <div className="journal-disclaimer">
      <strong>나의 기록과 실제 거래는 다릅니다.</strong> 목표가·손절가는 증권사 주문이 아닌 개인 투자 계획입니다.
      연결된 거래는 사용자가 직접 입력한 최근 거래만 포함하며, Tiger 공식 승인 전에는 브로커 거래 이력이 자동으로 연결되지 않습니다.
    </div>
  </main>;
}
