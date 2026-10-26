"use client";

import { useMemo, useState } from "react";
import type { TigerLedgerRead } from "../../../lib/tiger-api";
import type {
  JournalEntry, JournalKind, JournalPlan, ManualTradeEvent,
} from "../../../lib/saas-trades-api";

const KIND_LABEL:Record<JournalKind,string>={
  THESIS:"투자 논리",STRATEGY:"전략 변경",REVIEW:"매매 복기",
  TRADE_NOTE:"체결 메모",WATCHLIST_ADD:"관심종목 등록",
  WATCHLIST_REMOVE:"관심종목 해제",
};
type View="activity"|"plans"|"trades"|"broker";
type Summary={
  ticker:string;latest:JournalEntry|null;thesis:JournalEntry|null;
  plan:JournalPlan|null;review:JournalEntry|null;
  watched:boolean;count:number;
};
type Props={
  enabled:boolean;
  entries:readonly JournalEntry[];
  plans:readonly JournalPlan[];
  trades:readonly ManualTradeEvent[];
  brokerRead:TigerLedgerRead|null;
  initialTicker?:string;
  brokerNoteAction:(data:FormData)=>Promise<void>;
  brokerNoteKeys:Readonly<Record<string,string>>;
  noteAction:(data:FormData)=>Promise<void>;
  planAction:(data:FormData)=>Promise<void>;
  noteKey:string;planKey:string;
};

function displayTime(value:string):string{
  const date=new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR",{
        dateStyle:"medium",timeStyle:"short",timeZone:"Pacific/Auckland",
      }).format(date)
    : "날짜 확인 필요";
}
function planPrice(value:string|null,currency:string|null){
  if(value===null) return "미설정";
  const compact=value.replace(/(\.\d*?[1-9])0+$/,"$1").replace(/\.0+$/,"");
  return `${compact} ${currency??""}`;
}
function contentPreview(value:string,max=115){
  return value.length>max?value.slice(0,max)+"…":value;
}
function latest<T extends {createdAt:string}>(rows:readonly T[]):T|null{
  return [...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null;
}

export function JournalWorkspace({
  enabled,entries,plans,trades,brokerRead,initialTicker,brokerNoteAction,brokerNoteKeys,
  noteAction,planAction,noteKey,planKey,
}:Props){
  const symbols=useMemo(()=>{
    const names=new Set<string>();
    for(const item of entries) names.add(item.ticker);
    for(const item of plans) names.add(item.ticker);
    for(const item of trades) if(item.ticker&&item.kind==="EXECUTION") names.add(item.ticker);
    // Only signed, revalidated broker facts; never infer a ticker from a
    // pending or PARTIAL Tiger source snapshot.
    if(brokerRead?.readEnabled){
      for(const item of brokerRead.executions) names.add(item.symbol);
      for(const item of brokerRead.positions) names.add(item.symbol);
    }
    return [...names].sort();
  },[entries,plans,trades,brokerRead]);
  const [selected,setSelected]=useState(initialTicker&&symbols.includes(initialTicker)?initialTicker:symbols[0]??"");
  const [draftTicker,setDraftTicker]=useState(initialTicker&&symbols.includes(initialTicker)?initialTicker:symbols[0]??"");
  const [search,setSearch]=useState("");
  const [view,setView]=useState<View>("activity");
  const [composer,setComposer]=useState<"note"|"plan">("note");
  const [kind,setKind]=useState<JournalKind>("THESIS");
  const [annotate,setAnnotate]=useState<string|null>(null);

  const summaries=useMemo(()=>{
    return symbols.map(ticker=>{
      const per=entries.filter(e=>e.ticker===ticker)
        .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      const p=latest(plans.filter(p=>p.ticker===ticker));
      const mark=per.find(e=>e.kind==="WATCHLIST_ADD"||e.kind==="WATCHLIST_REMOVE");
      return {
        ticker,latest:per[0]??null,thesis:per.find(e=>e.kind==="THESIS")??null,
        review:per.find(e=>e.kind==="REVIEW")??null,plan:p,
        watched:mark?.kind==="WATCHLIST_ADD",count:per.length+plans.filter(x=>x.ticker===ticker).length,
      };
    });
  },[symbols,entries,plans]);
  const active:Summary|undefined=summaries.find(s=>s.ticker===selected);
  const shownSymbols=summaries.filter(s=>s.ticker.toUpperCase().includes(search.trim().toUpperCase()));
  const activeTrades=trades.filter(t=>t.ticker===selected&&t.kind==="EXECUTION");
  const voided=new Set(trades.filter(t=>t.kind==="VOID").map(t=>t.voidsEventId));
  const connectedTrades=activeTrades.filter(t=>!voided.has(t.id));
  const brokerTrades=brokerRead?.readEnabled
    ? brokerRead.executions.filter(t=>t.symbol===selected) : [];
  const brokerAccountNames=new Map(brokerRead?.accounts.map(a=>[a.accountId,a.alias])??[]);
  const history=useMemo(()=>[
    ...entries.filter(e=>e.ticker===selected).map(e=>({
      type:"note" as const,id:e.id,timestamp:e.createdAt,value:e,
    })),
    ...plans.filter(p=>p.ticker===selected).map(p=>({
      type:"plan" as const,id:p.id,timestamp:p.createdAt,value:p,
    })),
  ].sort((a,b)=>b.timestamp.localeCompare(a.timestamp)),[entries,plans,selected]);
  const totalEntries=entries.length+plans.length;
  const listedPlans=summaries.filter(s=>s.plan!==null).length;

  function choose(ticker:string){
    setSelected(ticker);
    setDraftTicker(ticker);
    setView("activity");
    setAnnotate(null);
  }
  function createNew(){
    setSelected("");
    setDraftTicker("");
    setView("activity");
    setComposer("note");
  }

  return <div className="journal-root">
    <div className="journal-metrics" aria-label="최근 조회한 투자 기록 현황">
      <div><span className="journal-metric-mark">▦</span>
        <small>기록된 종목</small><strong>{enabled?symbols.length:"—"}</strong>
        <span>내 기록과 승인된 증권사 체결 기준 · 전체 이력 아님</span></div>
      <div><span className="journal-metric-mark">✎</span>
        <small>불러온 변경 기록</small><strong>{enabled?totalEntries:"—"}</strong>
        <span>일지 최대 200건 · 계획 최대 200건</span></div>
      <div><span className="journal-metric-mark">◎</span>
        <small>투자 계획이 있는 종목</small><strong>{enabled?listedPlans:"—"}</strong>
        <span>목표가·손절가는 개인 메모</span></div>
    </div>

    {!enabled ? <section className="journal-disabled">
      <div className="journal-disabled-icon">✎</div>
      <h2>나의 투자 판단을 쌓아가는 공간</h2>
      <p>기록과 전략 변경이 준비되면 종목별 타임라인, 목표가·손절가 변경 이력, 매매 복기가 여기에 나타납니다.</p>
      <div className="journal-preview-grid">
        <span>종목별 투자 논리</span><span>목표·손절 계획</span><span>매매 기록 연결</span>
      </div>
    </section> : <div className="journal-layout">
      <aside className="journal-sidebar" aria-label="종목별 투자일지">
        <div className="journal-sidebar-top">
          <div><span className="journal-kicker">WATCH & JOURNAL</span><h2>종목 모아보기</h2></div>
          <button className="journal-new-btn btn btn-primary" type="button" onClick={createNew}>
            + 새 종목
          </button>
        </div>
        <label className="journal-search-label" htmlFor="journal-stock-search">종목 검색</label>
        <input id="journal-stock-search" className="journal-search" value={search}
          onChange={e=>setSearch(e.target.value)} placeholder="심볼 검색 (예: TSLA)"/>
        <div className="journal-symbol-list">
          {shownSymbols.length===0 ?
            <p className="journal-list-empty">{symbols.length===0?
              "아직 등록된 종목이 없습니다. 새 기록을 작성해 보세요.":
              "검색 결과가 없습니다."}</p> :
            shownSymbols.map(s=><button key={s.ticker} type="button"
              aria-pressed={selected===s.ticker}
              onClick={()=>choose(s.ticker)}
              className={`btn journal-symbol ${selected===s.ticker?"journal-symbol-active":""}`}>
              <span className="journal-symbol-avatar">{s.ticker.slice(0,2)}</span>
              <span className="journal-symbol-main">
                <strong>{s.ticker}</strong>
                <small>{s.watched?"관심종목 · ":""}{s.count}건 내 기록
                  {brokerRead?.readEnabled ? ` · 확인된 체결 ${brokerRead.executions.filter(e=>e.symbol===s.ticker).length}건` : ""}</small>
              </span><span aria-hidden="true" className="journal-symbol-arrow">›</span>
            </button>)
          }
        </div>
        <p className="journal-limit">이 목록은 불러온 최근 기록만 기준으로 합니다. 모든 과거 거래 또는 실제 보유종목을 의미하지 않습니다.</p>
      </aside>

      <div className="journal-workspace">
        <section className="journal-current">
          <div className="journal-current-top">
            <div><span className="journal-kicker">{active?"STOCK JOURNAL":"NEW STOCK JOURNAL"}</span>
              <h2>{active?.ticker??"새 종목 기록 시작"}</h2>
              <p>{active?"이 종목에 남긴 투자 판단과 변경 사항":"처음 기록할 종목의 티커를 입력하고 나만의 투자 일지를 시작하세요."}</p>
            </div>
            {active?.watched&&<span className="pill">관심종목</span>}
          </div>
          {active&&<div className="journal-current-grid">
            <div><span>최근 투자 논리</span><strong>{active.thesis?
              contentPreview(active.thesis.content,105):"기록 없음"}</strong>
              {active.thesis&&<small>{displayTime(active.thesis.createdAt)} 기준</small>}
            </div>
            <div><span>목표가</span><strong>{active.plan?
              planPrice(active.plan.targetPrice,active.plan.priceCurrency):"미설정"}</strong>
              <small>나의 계획 · 주문 아님</small>
            </div>
            <div><span>손절가</span><strong>{active.plan?
              planPrice(active.plan.stopPrice,active.plan.priceCurrency):"미설정"}</strong>
              <small>나의 계획 · 주문 아님</small>
            </div>
          </div>}
          {!active&&<p className="journal-instruction">일지는 실제 체결 없이도 작성할 수 있습니다. 계획 가격은 실시간 시세 또는 자동 주문으로 사용되지 않습니다.</p>}
        </section>

        <section className="journal-compose" aria-label="투자일지 작성">
          <div className="journal-section-heading">
            <div><span className="journal-kicker">WRITE AN UPDATE</span><h2>새로운 판단 남기기</h2></div>
            <div className="journal-mode" role="group" aria-label="기록 유형">
              <button type="button" className={`btn ${composer==="note"?"journal-mode-active":""}`}
                onClick={()=>setComposer("note")}>투자일지</button>
              <button type="button" className={`btn ${composer==="plan"?"journal-mode-active":""}`}
                onClick={()=>setComposer("plan")}>목표·손절 계획</button>
            </div>
          </div>
          {composer==="note" ? <form action={noteAction} className="journal-compose-form">
            <input type="hidden" name="idempotencyKey" value={noteKey}/>
            <div className="journal-form-two">
              <label>종목 심볼
                <input name="ticker" value={draftTicker} onChange={e=>setDraftTicker(e.target.value.toUpperCase())}
                  placeholder="예: TSLA" required maxLength={32} pattern="[A-Z0-9.:-]{1,32}"/>
              </label>
              <label>기록 유형
                <select name="kind" value={kind} onChange={e=>setKind(e.target.value as JournalKind)}>
                  <option value="THESIS">투자 논리 · 왜 투자하나?</option>
                  <option value="STRATEGY">전략 변경 · 무엇이 달라졌나?</option>
                  <option value="REVIEW">매매 복기 · 무엇을 배웠나?</option>
                  <option value="TRADE_NOTE">체결 메모 · 왜 매매했나?</option>
                  <option value="WATCHLIST_ADD">관심종목에 추가</option>
                  <option value="WATCHLIST_REMOVE">관심종목에서 제외</option>
                </select>
              </label>
            </div>
            {kind!=="WATCHLIST_ADD"&&kind!=="WATCHLIST_REMOVE" ?
              <label>나의 생각
                <textarea name="content" rows={5} maxLength={6000} required
                  placeholder={kind==="THESIS"?"투자한 이유와 가설, 확인할 핵심 지표를 기록해 보세요.":kind==="REVIEW"?
                    "잘한 판단, 아쉬웠던 부분, 다음에는 어떻게 할지 기록해 보세요.":
                    kind==="STRATEGY"?"계획이 왜 바뀌었고 어떤 조건에서 다시 검토할지 기록해 보세요.":
                    "이 거래를 하게 된 상황과 의도를 기록해 보세요."}/>
              </label> : <p className="journal-form-hint">관심종목 추가·제외는 별도의 본문 없이 변경 이력으로 기록됩니다.</p>}
            {kind==="TRADE_NOTE" && <label>관련 직접 입력 거래 (선택)
              <select name="tradeEventId" defaultValue="" key={draftTicker}>
                <option value="">연결하지 않고 기록</option>
                {trades.filter(t=>t.kind==="EXECUTION"&&t.ticker===draftTicker&&
                  !voided.has(t.id)).map(t=>
                  <option key={t.id} value={t.id}>{t.side==="BUY"?"매수":"매도"} {t.quantity??"?"}주 · {displayTime(t.executedAt??t.createdAt)}</option>)}
              </select>
              <small>최근 직접 입력한 거래만 선택할 수 있습니다. 서버가 종목과 소유권을 다시 확인합니다.</small>
            </label>}
            <label className="journal-confirm">
              <input type="checkbox" name="confirmation" value="yes" required/>
              이 기록은 내가 직접 작성한 투자 판단입니다.
            </label>
            <button type="submit" className="btn btn-primary journal-save">기록 남기기</button>
          </form> : <form action={planAction} className="journal-compose-form">
            <input type="hidden" name="idempotencyKey" value={planKey}/>
            <label>종목 심볼
              <input name="ticker" value={draftTicker} onChange={e=>setDraftTicker(e.target.value.toUpperCase())}
                placeholder="예: TSLA" required maxLength={32} pattern="[A-Z0-9.:-]{1,32}"/>
            </label>
            <div className="journal-form-three">
              <label>목표가 (선택)
                <input name="targetPrice" type="text" inputMode="decimal"
                  pattern="(0|[1-9][0-9]{0,23})(\.[0-9]{1,12})?" placeholder="미설정"/>
              </label>
              <label>손절가 (선택)
                <input name="stopPrice" type="text" inputMode="decimal"
                  pattern="(0|[1-9][0-9]{0,23})(\.[0-9]{1,12})?" placeholder="미설정"/>
              </label>
              <label>가격 통화
                <input name="priceCurrency" defaultValue="USD"
                  maxLength={3} required pattern="[A-Za-z]{3}"/>
              </label>
            </div>
            <p className="journal-form-hint">두 가격 중 하나만 기록해도 됩니다. 두 칸을 모두 비우면 기존 계획을 해제하는 새 이력을 남깁니다. 가격은 실시간 시세가 아닙니다.</p>
            <label>계획을 새로 정하거나 바꾸는 이유
              <textarea name="rationale" rows={3} maxLength={3000} required
                placeholder="변경 근거와 다시 점검할 조건을 남겨보세요."/>
            </label>
            <label className="journal-confirm">
              <input type="checkbox" name="confirmation" value="yes" required/>
              실제 주문이 아닌 나의 투자 계획임을 확인합니다.
            </label>
            <button type="submit" className="btn btn-primary journal-save">새 계획 이력 저장</button>
          </form>}
        </section>

        {active&&<section className="journal-history">
          <div className="journal-section-heading">
            <div><span className="journal-kicker">DECISIONS OVER TIME</span><h2>{selected}의 기록</h2></div>
            <span className="journal-history-count">최근 {history.length}개 기록</span>
          </div>
          <div className="journal-tabs" role="group" aria-label="기록 필터">
            <button type="button" aria-pressed={view==="activity"} onClick={()=>setView("activity")}
              className={`btn ${view==="activity"?"journal-tab-active":""}`}>전체 변경 이력</button>
            <button type="button" aria-pressed={view==="plans"} onClick={()=>setView("plans")}
              className={`btn ${view==="plans"?"journal-tab-active":""}`}>투자 계획</button>
            <button type="button" aria-pressed={view==="trades"} onClick={()=>setView("trades")}
              className={`btn ${view==="trades"?"journal-tab-active":""}`}>직접 입력 거래</button>
            <button type="button" aria-pressed={view==="broker"} onClick={()=>setView("broker")}
              className={`btn ${view==="broker"?"journal-tab-active":""}`}>Tiger 검증 체결</button>
          </div>

          {view!=="trades" && view!=="broker" ? <div className="journal-timeline">
            {(view==="plans"?history.filter(e=>e.type==="plan"):history).length===0 ?
              <div className="journal-empty">아직 이 유형의 기록이 없습니다. 위에서 첫 판단을 남겨보세요.</div>:
              (view==="plans"?history.filter(e=>e.type==="plan"):history).map(e=>
                <article key={e.type+e.id} className="journal-entry">
                  <div className="journal-entry-dot" aria-hidden="true"/>
                  <div className="journal-entry-content">
                    <div className="journal-entry-meta">
                      <span className="journal-entry-kind">{e.type==="plan"?"목표·손절 계획 변경":KIND_LABEL[e.value.kind]}</span>
                      <time dateTime={e.timestamp}>{displayTime(e.timestamp)}</time>
                    </div>
                    {e.type==="plan" ? <>
                      <div className="journal-plan-values">
                        <span>목표 <strong>{planPrice(e.value.targetPrice,e.value.priceCurrency)}</strong></span>
                        <span>손절 <strong>{planPrice(e.value.stopPrice,e.value.priceCurrency)}</strong></span>
                      </div>
                      <p className="journal-entry-text">{e.value.rationale}</p>
                    </> : <>
                      {e.value.content && <p className="journal-entry-text">{e.value.content}</p>}
                      {e.value.brokerRef && <p className="journal-form-hint">
                        {brokerRead?.readEnabled && brokerRead.executions.some(f=>
                          f.accountId===e.value.brokerRef?.accountId &&
                          f.sourceRef===e.value.brokerRef?.sourceRef &&
                          f.reviewVersion===e.value.brokerRef?.reviewVersion)
                          ?"✓ 연결된 Tiger 체결 · 현재 독립 검증 유효"
                          :"당시 Tiger 체결에 연결한 메모 · 현재 원본 검증을 재확인할 수 없음"}
                        {" · "}메모 원문은 보존됩니다.
                      </p>}
                      {e.value.tradeEventId&&<a href={`/private/trades/${e.value.tradeEventId}`}
                        className="journal-trade-link">직접 입력 거래 상세 보기 ↗</a>}
                    </>}
                    <small>사용자 직접 작성 · 변경 이력 보존</small>
                  </div>
                </article>)}
          </div> : view==="trades" ? <div className="journal-trades">
            {connectedTrades.length===0 ?
              <p className="journal-empty">현재 목록에서 이 종목의 유효한 직접 입력 거래가 확인되지 않았습니다.</p>:
              connectedTrades.map(t=><div className="journal-trade-row" key={t.id}>
                <div><strong>{t.side==="BUY"?"매수":"매도"} {t.quantity??"?"}주</strong>
                  <small>{displayTime(t.executedAt??t.createdAt)} · 사용자 직접 입력</small>
                </div>
                <a href={`/private/trades/${t.id}`}>상세 보기 ↗</a>
              </div>)}
            <p className="journal-limit">최근 최대 50건의 직접 입력 거래 중 일부입니다. 전체 과거 매매 내역 또는 증권사 검증 데이터가 아닙니다.</p>
          </div> : <div className="journal-trades" aria-label="검증된 Tiger 체결">
            {!brokerRead ? <p className="journal-empty" role="status">
              Tiger 검증 원장 조회에 연결하지 못했습니다. 내 기록은 그대로 보존됩니다.
            </p> : !brokerRead.readEnabled ? <p className="journal-empty" role="status">
              Tiger 공식 승인과 독립 원장 검증 전에는 증권사 거래를 표시하지 않습니다.
            </p> : brokerTrades.length===0 ? <p className="journal-empty">
              현재 조회한 검증 원장에서 이 종목의 체결이 확인되지 않았습니다. 이것이 거래가 없었다는 뜻은 아닙니다.
            </p> : brokerTrades.map(t=><article className="journal-trade-row" key={t.accountId+":"+t.sourceRef}>
              <div>
                <strong>{t.side==="BUY"?"매수":"매도"} {t.quantity}주 · {t.price} {t.currency}</strong>
                <small>{displayTime(t.executedAt)} · {brokerAccountNames.get(t.accountId)??"Tiger 계좌"} ·
                  증권사 원본 검증 v{t.reviewVersion}</small>
                <small>수수료 {t.fee} {t.currency} · {t.provenance} · 이 체결은 직접 입력 거래와 별도입니다.</small>
                {entries.filter(e=>e.brokerRef?.accountId===t.accountId &&
                     e.brokerRef?.sourceRef===t.sourceRef &&
                     e.brokerRef?.reviewVersion===t.reviewVersion).map(e=>
                  <div key={e.id} className="journal-entry-content">
                    <small>연결된 내 투자 메모 · {displayTime(e.createdAt)}</small>
                    <p className="journal-entry-text">{e.content}</p>
                  </div>)}
                {brokerNoteKeys[t.accountId+":"+t.sourceRef] &&
                  <button type="button" className="btn btn-outline"
                    aria-expanded={annotate===t.accountId+":"+t.sourceRef}
                    onClick={()=>setAnnotate(old=>old===t.accountId+":"+t.sourceRef?null:t.accountId+":"+t.sourceRef)}>
                    {annotate===t.accountId+":"+t.sourceRef?"메모 접기":"이 체결에 투자일지 남기기"}
                  </button>}
                {annotate===t.accountId+":"+t.sourceRef && brokerNoteKeys[t.accountId+":"+t.sourceRef] &&
                  <form action={brokerNoteAction} className="journal-compose-form">
                    <input type="hidden" name="idempotencyKey" value={brokerNoteKeys[t.accountId+":"+t.sourceRef]}/>
                    <input type="hidden" name="accountId" value={t.accountId}/>
                    <input type="hidden" name="sourceRef" value={t.sourceRef}/>
                    <input type="hidden" name="ticker" value={t.symbol}/>
                    <label>이 체결을 한 이유와 복기
                      <textarea name="content" rows={3} maxLength={6000} required
                        placeholder="진입·청산 판단, 감정, 배운 점을 직접 남겨보세요."/>
                    </label>
                    <label className="journal-confirm">
                      <input type="checkbox" name="confirmation" value="yes" required/>
                      내가 직접 작성한 메모이며, 증권사 주문을 생성하지 않음을 확인합니다.
                    </label>
                    <button type="submit" className="btn btn-primary journal-save">연결 메모 저장</button>
                  </form>}
              </div>
            </article>)}
            {brokerRead.readEnabled && <p className="journal-limit">
              독립 검증 후 공개된 최근 체결만 표시합니다.
              {brokerRead.truncated?" 100건 상한에 도달해 일부 거래가 목록에 없을 수 있습니다.":""}
              메모는 사용자가 직접 해당 체결을 선택하여 연결할 때만 귀속됩니다.
            </p>}
          </div>}
        </section>}
      </div>
    </div>}
  </div>;
}
