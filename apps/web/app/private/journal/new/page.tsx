import Link from "next/link";
import {randomUUID} from "node:crypto";
import {redirect,notFound} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {fetchManualTrades,fetchJournal,fetchJournalPlans,submitJournal,submitJournalPlan,submitBrokerFillNote,submitTigerObservationNote,type JournalKind,type InvestmentStrategyType,type InvestmentHorizon,type ReviewCadence} from "../../../../lib/saas-trades-api";
import {tigerLedgerRead,tigerPersonalRead} from "../../../../lib/tiger-api";
import {JournalSymbolPicker} from "./symbol-picker";
import {PlanRiskCheck} from "./plan-risk-check";
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
  if(!KINDS.has(kind) || !TICKER.test(ticker))
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
  if(!TICKER.test(ticker))
    redirect("/private/journal/new?error=invalid");
  try{
    await submitBrokerFillNote(subject,{
      idempotencyKey:field(form,"idempotencyKey"),
      ticker,content:field(form,"content"),
      accountId:field(form,"fillSelection").split(":")[0]??"",
      sourceRef:field(form,"fillSelection").split(":")[1]??"",
    });
  }catch{
    redirect("/private/journal/new?error=unavailable");
  }
  redirect("/private/journal?saved=broker-note&ticker="+encodeURIComponent(ticker));
}

/** A Tiger observation note is user-authored, not a broker-verified fill. */
async function addObservationNote(form:FormData){
  "use server";
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  const subject=session?.user?.id;
  if(!workspace||!subject) redirect("/login");
  const ticker=field(form,"ticker").toUpperCase();
  const sourceRef=field(form,"sourceRef");
  const sourceKind=field(form,"sourceKind");
  const pageRaw=field(form,"page");
  if(!TICKER.test(ticker) || !/^[0-9a-f]{64}$/.test(sourceRef) ||
     !["ORDER","FILL"].includes(sourceKind) || !/^(?:0|[1-9][0-9]?)$/.test(pageRaw) ||
     Number(pageRaw)>20 || (sourceKind==="FILL" && pageRaw!=="0"))
    redirect("/private/journal/new?error=invalid");
  try{
    await submitTigerObservationNote(subject,{
      idempotencyKey:field(form,"idempotencyKey"),
      ticker,content:field(form,"content"),
      sourceRef,observationKind:sourceKind as "ORDER"|"FILL",
      page:Number(pageRaw),
    });
  }catch{
    redirect("/private/journal/new?error=unavailable");
  }
  redirect("/private/journal?saved=observed-note&ticker="+encodeURIComponent(ticker));
}

async function addPlan(form:FormData) {
  "use server";
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  const subject=session?.user?.id;
  if(!workspace||!subject) redirect("/login");
  const ticker=field(form,"ticker").toUpperCase();
  if(!TICKER.test(ticker))
    redirect("/private/journal/new?error=invalid");
  const target=field(form,"targetPrice")||null;
  const stop=field(form,"stopPrice")||null;
  try{
    await submitJournalPlan(subject,{
      idempotencyKey:field(form,"idempotencyKey"),ticker,
      targetPrice:target,stopPrice:stop,
      priceCurrency:target||stop?field(form,"priceCurrency").toUpperCase():null,
      rationale:field(form,"rationale"),
      strategyType:(field(form,"strategyType")||null) as InvestmentStrategyType|null,
      investmentHorizon:(field(form,"investmentHorizon")||null) as InvestmentHorizon|null,
      invalidationCondition:field(form,"invalidationCondition")||null,
      maxAllocationPct:field(form,"maxAllocationPct")||null,
      reviewCadence:(field(form,"reviewCadence")||null) as ReviewCadence|null,
    });
  }catch{
    redirect("/private/journal/new?error=unavailable");
  }
  redirect("/private/journal?saved=plan&ticker="+encodeURIComponent(ticker));
}


export default async function JournalNewPage({searchParams}:{
  searchParams:Promise<{ticker?:string;mode?:string;kind?:string;error?:string;
    sourceRef?:string;sourceKind?:string;page?:string}>
}){
  const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
  if(!workspace||!session?.user?.id) redirect("/login");
  const ticker=(params.ticker??"").toUpperCase();
  const safeTicker=TICKER.test(ticker)?ticker:"";
  const mode=params.mode==="plan"?"plan":params.mode==="broker"?"broker":
    params.mode==="observed"?"observed":"note";
  const sourceKind=params.sourceKind==="ORDER"?"ORDER":params.sourceKind==="FILL"?"FILL":"";
  const sourceRef=params.sourceRef??"";
  const observedPage=/^(?:0|[1-9][0-9]?)$/.test(params.page??"0") &&
    Number(params.page??"0")<=20 ? Number(params.page??"0") : -1;
  let brokerFills:Awaited<ReturnType<typeof tigerLedgerRead>>["executions"]=[];
  if(mode==="broker"){
    if(!safeTicker) notFound();
    try{
      const ledger=await tigerLedgerRead();
      if(!ledger.readEnabled) notFound();
      brokerFills=ledger.executions.filter(e=>e.symbol===safeTicker);
    }catch{notFound();}
    if(brokerFills.length===0) notFound();
  }
  // Build ticker choices solely from THIS user's scoped records, never from
  // public fixtures, hard-coded tickers or another workspace.
  const results=await Promise.allSettled([
    fetchManualTrades(session.user.id),
    fetchJournal(session.user.id),
    fetchJournalPlans(session.user.id),
    tigerPersonalRead(mode==="observed"?Math.max(0,observedPage):0),
  ]);
  const manual=results[0].status==="fulfilled"?results[0].value.events:[];
  const entries=results[1].status==="fulfilled"?results[1].value:[];
  const planHistoryAvailable=results[2].status==="fulfilled";
  const plans=results[2].status==="fulfilled"?results[2].value:[];
  const existingPlan=mode==="plan"&&safeTicker
    ?[...plans].filter(p=>p.ticker===safeTicker)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null
    :null;
  const personal=results[3].status==="fulfilled"?results[3].value:null;
  const accounts=personal?.accounts??[];
  // Missing/partial owner-only snapshots are UNKNOWN, not proof of zero holdings.
  const snapshotAvailable=!!personal && accounts.length>0 &&
    !personal.readWarnings?.length &&
    accounts.every(a=>!!a.asOf && !a.partial && !a.truncated &&
      a.positions.every(p=>!!p.currency && !!p.quantity));
  const observedHoldings=accounts.flatMap(a=>a.positions
    .filter(p=>p.symbol===safeTicker)
    .map(p=>({account:a.alias,quantity:p.quantity,averageCost:p.averageCost,
      currency:p.currency,asOf:a.asOf})));
  if(mode==="observed" && (!safeTicker || observedPage<0 || !sourceKind ||
    !/^[0-9a-f]{64}$/.test(sourceRef) ||
    (sourceKind==="FILL" && observedPage!==0))) notFound();
  const observedOrder=mode==="observed" && sourceKind==="ORDER"
    ? accounts.flatMap(a=>a.orders)
      .find(o=>o.sourceRef===sourceRef && o.symbol===safeTicker)
    : undefined;
  const observedFill=mode==="observed" && sourceKind==="FILL"
    ? accounts.flatMap(a=>a.fillObservations)
      .find(o=>o.sourceRef===sourceRef && o.symbol===safeTicker)
    : undefined;
  const observed=observedOrder??observedFill;
  if(mode==="observed" && !observed) notFound();
  const heldSymbols=new Set(accounts.flatMap(a=>a.positions.map(p=>p.symbol)));
  const symbols=new Set<string>([
    ...heldSymbols,
    ...accounts.flatMap(a=>a.orders.map(o=>o.symbol)),
    ...entries.map(e=>e.ticker),
    ...plans.map(p=>p.ticker),
    ...manual.map(e=>e.ticker).filter((v):v is string=>typeof v==="string"),
    ...brokerFills.map(e=>e.symbol),
  ]);
  if(safeTicker) symbols.add(safeTicker);
  const tickerOptions=[...symbols].filter(s=>TICKER.test(s))
    .sort((a,b)=>Number(heldSymbols.has(b))-Number(heldSymbols.has(a))||a.localeCompare(b))
    .slice(0,200);
  const cancelled=new Set(manual.filter(e=>e.kind==="VOID").map(e=>e.voidsEventId));
  const eligibleTrades=manual.filter(e=>e.kind==="EXECUTION" &&
    e.ticker && !cancelled.has(e.id)).map(e=>({
      id:e.id,ticker:e.ticker!,side:e.side,quantity:e.quantity,
      executedAt:e.executedAt??e.createdAt,
    }));
  const back="/private/journal"+(safeTicker?"?ticker="+encodeURIComponent(safeTicker):"");
  return <main className="journal-page">
    <div className="page-intro">
      <span className="breadcrumb"><Link href={back}>← {safeTicker||"투자 일지"}</Link></span>
      <h1>{mode==="plan"?"투자 전략·계획 변경":
        mode==="broker"?"체결 복기 작성":mode==="observed"?"Tiger 매매 관측 복기 작성":"투자 판단 작성"}</h1>
      <p>{mode==="observed"?"선택한 Tiger 주문 또는 개별 체결 관측값에 매매 이유를 기록합니다. 미검증 원본이며 실제 주문은 생성되지 않습니다.":
        mode==="broker"?"증권사가 확인한 체결에 내 판단을 연결합니다. 실제 주문은 생성되지 않습니다.":
        mode==="plan"?"투자 전략과 위험 기준을 기록합니다. 시세 알림과 실제 주문은 생성되지 않습니다.":
        "종목별 투자 논리, 판단 변화, 매매 복기를 직접 기록합니다."}</p>
    </div>
    {params.error&&<p role="alert">입력 내용을 확인해 주세요. 저장 여부가 불확실하면 기존 기록부터 확인하세요.</p>}
    <section className="journal-compose journal-create-page">
    {mode==="observed"&&observed ?
      <form action={addObservationNote} className="journal-compose-form">
        <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
        <input type="hidden" name="ticker" value={safeTicker}/>
        <input type="hidden" name="sourceRef" value={sourceRef}/>
        <input type="hidden" name="sourceKind" value={sourceKind}/>
        <input type="hidden" name="page" value={observedPage}/>
        <p className="journal-form-hint"><strong>{safeTicker}</strong> · Tiger {sourceKind==="FILL"?"개별 체결 관측":"주문 관측"} ·
          {observed.side==="BUY"?" 매수":" 매도"} ·
          {observedFill?formatDecimal(observedFill.quantity):formatDecimal(observedOrder?.filled)}주
        </p>
        <p className="journal-form-hint">원본 계좌·종목·체결 식별자는 서버에서 재확인합니다. 이 메모는 사용자 작성 기록이며 증권사 검증 원장은 변경되지 않습니다.</p>
        <label>매매 이유와 투자 계획·복기
          <textarea name="content" rows={7} maxLength={6000} required
            placeholder="왜 매수/매도했나요? 계획했던 목표·손절 기준과 비교해 보세요."/>
        </label>
        <button type="submit" className="btn btn-primary journal-save">관측 매매 복기 저장</button>
      </form>
    :mode==="broker"&&brokerFills.length>0 ?
      <form action={addBrokerFillNote} className="journal-compose-form">
        <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
        <input type="hidden" name="ticker" value={safeTicker}/>
        <label>복기를 연결할 검증 체결
          <select name="fillSelection" required>{brokerFills.map(e=>
            <option key={e.accountId+":"+e.sourceRef} value={e.accountId+":"+e.sourceRef}>
              {e.side==="BUY"?"매수":"매도"} · {formatDecimal(e.quantity)}주 · {formatDecimal(e.price)} {e.currency} · {e.executedAt}
            </option>)}</select>
        </label>
        <p className="journal-form-hint">독립 검증된 체결만 선택할 수 있습니다. 직접 입력 거래와 구분됩니다.</p>
        <label>이 체결의 매매 근거와 복기<textarea name="content" rows={7} maxLength={6000} required placeholder="진입·청산 근거, 잘한 점, 다음에 보완할 점"/></label>
        <button type="submit" className="btn btn-primary journal-save">복기 저장</button>
      </form>
    :mode==="plan"&&!planHistoryAvailable?
      <div className="state-panel" role="alert">
        <h2>현재 투자계획 이력을 읽을 수 없습니다.</h2>
        <p>이전에 작성한 전략이나 목표 가격을 실수로 덮어쓰지 않도록 새 계획 저장을 잠시 제한합니다.</p>
        <Link href={back} className="btn btn-outline">투자일지로 돌아가기</Link>
      </div>
    :mode==="plan"&&!safeTicker?
      <form method="get" action="/private/journal/new" className="journal-compose-form">
        <input type="hidden" name="mode" value="plan"/>
        <JournalSymbolPicker symbols={tickerOptions} initialTicker="" />
        <p className="journal-form-hint">먼저 종목을 선택하면 이 종목의 가장 최근 계획을 불러옵니다. 다른 종목의 계획을 가져오지 않습니다.</p>
        <button type="submit" className="btn btn-primary journal-save">종목 선택 후 계획 작성 →</button>
      </form>
    :mode==="plan"?
      <form action={addPlan} className="journal-compose-form">
        <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
        <input type="hidden" name="ticker" value={safeTicker}/>
        <p className="journal-form-hint"><strong>선택한 종목: {safeTicker}</strong> · 이 종목의 새 불변 계획 이력을 작성합니다.
          다른 종목을 관리하려면 <Link href="/private/journal/new?mode=plan">종목 선택</Link>으로 이동하세요.</p>
        <div className="journal-plan-first">
          <span className="breadcrumb">기본 투자 계획 · 먼저 작성할 항목</span>
          <label>계획을 새로 정하거나 변경한 이유
            <textarea name="rationale" rows={5} maxLength={3000} required
              placeholder="내가 이 종목에 관심을 갖는 이유와 이번 계획을 작성·수정하는 이유를 적어 주세요."/>
          </label>
          <label>언제 이 투자 논리를 다시 생각해야 하나요?
            <textarea name="invalidationCondition" rows={3} maxLength={1500}
              defaultValue={existingPlan?.invalidationCondition??""}
              placeholder="예: 사업 가정이 훼손되거나, 내가 확인한 기술적 진입 근거가 깨지는 경우"/>
          </label>
          <label>정기적으로 계획을 돌아볼 주기
            <select name="reviewCadence" defaultValue={existingPlan?.reviewCadence??""}>
              <option value="">미정 · 나중에 설정</option>
              <option value="WEEKLY">매주</option>
              <option value="MONTHLY">매월</option>
              <option value="QUARTERLY">분기마다</option>
              <option value="SEMIANNUAL">6개월마다</option>
              <option value="ANNUAL">매년</option>
              <option value="EVENT_DRIVEN">기업 공시·사건 발생 시</option>
            </select>
          </label>
        </div>
        <details className="data-disclosure">
          <summary>투자 유형·기간·최대 비중 (선택 사항)</summary>
        <div className="journal-form-two">
          <label>투자 전략 유형
            <select name="strategyType" defaultValue={existingPlan?.strategyType??""}>
              <option value="">미정</option>
              <option value="LONG_TERM">장기 투자</option>
              <option value="TECHNICAL">기술적 근거 진입</option>
              <option value="EVENT_DRIVEN">이벤트·실적 기반</option>
              <option value="OTHER">기타 전략</option>
            </select>
          </label>
          <label>예상 투자 기간
            <select name="investmentHorizon" defaultValue={existingPlan?.investmentHorizon??""}>
              <option value="">미정</option>
              <option value="UNDER_3_MONTHS">3개월 미만</option>
              <option value="THREE_TO_TWELVE_MONTHS">3개월~1년</option>
              <option value="ONE_TO_THREE_YEARS">1~3년</option>
              <option value="OVER_THREE_YEARS">3년 이상</option>
              <option value="OPEN_ENDED">장기·종료 시점 미정</option>
            </select>
          </label>
        </div>
        <div className="journal-form-two">
          <label>단일 종목 최대 보유 비중 (%) · 선택 사항
            <input name="maxAllocationPct" inputMode="decimal" type="text"
              defaultValue={existingPlan?.maxAllocationPct??""}
              pattern="(?:[0-9]{1,3}(?:[.][0-9]{1,2})?)"
              placeholder="예: 15"/>
          </label>
          <p className="journal-form-hint">비중은 내가 정한 전체 투자 기준일 수 있습니다. 일부 계좌의 관측 비중만으로 자동 준수 판정하지 않습니다.</p>
        </div>
        </details>
        <PlanRiskCheck ticker={safeTicker}
          initialTarget={existingPlan?.targetPrice??""}
          initialStop={existingPlan?.stopPrice??""}
          initialCurrency={existingPlan?.priceCurrency??"USD"}
          observedHoldings={observedHoldings} snapshotAvailable={snapshotAvailable}/>
        <p className="journal-form-hint">세부 항목을 펼치지 않아도 기존 저장값은 입력 요소에 유지됩니다.
          값을 직접 지우면 새 계획 변경 이력에 미설정으로 저장됩니다. 저장한 계획은 과거 기록을 수정하지 않고 새 이력으로 추가합니다.
          목표가·손절가는 가격 감시나 증권사 주문에 사용하지 않습니다. 매수 전 위험 점검 결과는 저장되지 않습니다.</p>
        <button type="submit" className="btn btn-primary journal-save">새 투자 계획 저장</button>
      </form>
    :<form action={addJournal} className="journal-compose-form">
      <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
      <div className="journal-form-two">
        <JournalSymbolPicker symbols={tickerOptions} initialTicker={safeTicker} trades={eligibleTrades} />
        <label>기록 유형<select name="kind" defaultValue={params.kind==="REVIEW"?"REVIEW":"THESIS"}>
          <option value="THESIS">투자 논리</option>
          <option value="STRATEGY">전략 변경</option>
          <option value="REVIEW">매매 복기</option>
          <option value="TRADE_NOTE">체결 메모</option>
          <option value="WATCHLIST_ADD">관심종목 추가</option>
          <option value="WATCHLIST_REMOVE">관심종목 제외</option>
        </select></label>
      </div>
      <label>내 생각 (관심종목 추가·제외는 선택)<textarea name="content" rows={7} maxLength={6000} placeholder="투자 이유, 확인할 지표, 손절·청산을 재검토할 조건 등"/></label>

      <button type="submit" className="btn btn-primary journal-save">기록 저장</button>
    </form>}
    </section>
  </main>;
}
