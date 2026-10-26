"use client";

import { useMemo, useState } from "react";
import { formatDecimal } from "../../../lib/format-decimal";
import Link from "next/link";
import type { TigerLedgerRead, TigerPersonalPosition } from "../../../lib/tiger-api";
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
  personalPositions:readonly TigerPersonalPosition[];
  initialTicker?:string;
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
  return `${formatDecimal(compact)} ${currency??""}`;
}
function contentPreview(value:string,max=115){
  return value.length>max?value.slice(0,max)+"…":value;
}
function latest<T extends {createdAt:string}>(rows:readonly T[]):T|null{
  return [...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null;
}

export function JournalWorkspace({
  enabled,entries,plans,trades,brokerRead,personalPositions,initialTicker,
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
    for(const p of personalPositions) names.add(p.symbol);
    return [...names].sort((a,b)=>
      Number(personalPositions.some(p=>p.symbol===b))-
      Number(personalPositions.some(p=>p.symbol===a))||a.localeCompare(b));
  },[entries,plans,trades,brokerRead,personalPositions]);
  const [selected,setSelected]=useState(initialTicker&&symbols.includes(initialTicker)?initialTicker:symbols[0]??"");
  const [search,setSearch]=useState("");
  const [view,setView]=useState<View>("activity");

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
  const missingThesis=summaries.filter(s=>!s.thesis).length;

  function choose(ticker:string){
    setSelected(ticker);
    setView("activity");
  }

  return <div className="journal-root">
    <div className="journal-metrics" aria-label="최근 조회한 투자 기록 현황">
      <div><span className="journal-metric-mark">▦</span>
        <small>내 관심·보유 종목</small><strong>{enabled?symbols.length:"—"}</strong>
        <span>현재 조회 가능한 종목만 집계</span></div>
      <div><span className="journal-metric-mark">✎</span>
        <small>내가 작성한 기록</small><strong>{enabled?totalEntries:"—"}</strong>
        <span>조회된 일지와 계획 변경 이력</span></div>
      <div><span className="journal-metric-mark">◎</span>
        <small>투자 논리 미기록</small><strong>{enabled?missingThesis:"—"}</strong>
        <span>투자 계획이 있는 종목  {listedPlans}개</span></div>
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
          <div><span className="journal-kicker">MY SYMBOLS</span><h2>종목별 일지</h2></div>
          <Link className="journal-new-btn btn btn-outline" href="/private/journal/new">+ 새 기록</Link>
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
                <small>{personalPositions.some(p=>p.symbol===s.ticker)?"보유 관측 · ":""}{s.watched?"관심 · ":""}{s.count}건 기록
                  {brokerRead?.readEnabled ? ` · 확인된 체결 ${brokerRead.executions.filter(e=>e.symbol===s.ticker).length}건` : ""}</small>
              </span><span aria-hidden="true" className="journal-symbol-arrow">›</span>
            </button>)
          }
        </div>
        <p className="journal-limit">현재 조회된 계좌 보유 종목과 내 기록 기준입니다. <Link href="/private/trades">전체 거래 보기</Link></p>
      </aside>

      <div className="journal-workspace">
        <section className="journal-current">
          <div className="journal-current-top">
            <div><span className="journal-kicker">{active?"INVESTMENT NOTES":"MY JOURNAL"}</span>
              <h2>{active?.ticker??"기록할 종목을 선택하세요"}</h2>
              <p>{active?"투자 근거와 가장 최근 계획":"일지 작성 버튼으로 새로운 종목을 등록할 수 있습니다."}</p>
            </div>
            {active&&<div className="journal-current-actions">
               <Link className="btn btn-outline" href={"/private/journal/new?ticker="+encodeURIComponent(active.ticker)}>+ 투자 판단 작성</Link>
               <Link className="btn btn-primary" href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(active.ticker)}>목표·손절 설정</Link>
             </div>}
             {active?.watched&&<span className="pill">관심종목</span>}
          </div>
          {active&&<div className="journal-current-grid">
            <div><span>최근 투자 논리</span><strong>{active.thesis?
              contentPreview(active.thesis.content,105):"기록 없음"}</strong>
              {active.thesis&&<small>{displayTime(active.thesis.createdAt)} 기준</small>}
            </div>
            <div><span>목표가</span><strong>{active.plan?
              planPrice(active.plan.targetPrice,active.plan.priceCurrency):"미설정"}</strong>
              <small>계획 가격 · 주문 아님</small>
               <Link className="journal-plan-edit-link" href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(active.ticker)}>목표가 {active.plan?"변경":"입력"} →</Link>
            </div>
            <div><span>손절가</span><strong>{active.plan?
              planPrice(active.plan.stopPrice,active.plan.priceCurrency):"미설정"}</strong>
              <small>나의 계획 · 주문 아님</small>
               <Link className="journal-plan-edit-link" href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(active.ticker)}>손절가 {active.plan?"변경":"입력"} →</Link>
            </div>
          </div>}
          {!active&&<div className="journal-actions">
             <p className="journal-instruction">첫 종목을 선택하거나 새 기록을 작성하세요.</p>
             <Link className="btn btn-primary" href="/private/journal/new">+ 새 투자 기록</Link>
             <Link className="btn btn-outline" href="/private/journal/new?mode=plan">+ 투자 계획</Link>
           </div>}
        </section>

        {active&&<section className="journal-history">
          <div className="journal-section-heading">
            <div><span className="journal-kicker">DECISIONS OVER TIME</span><h2>{selected}의 기록</h2></div>
            <span className="journal-history-count">최근 {history.length}개 기록</span>
          </div>
          <div className="journal-tabs" role="group" aria-label="기록 필터">
            <button type="button" aria-pressed={view==="activity"} onClick={()=>setView("activity")}
              className={`btn ${view==="activity"?"journal-tab-active":""}`}>내 투자 기록</button>
            <button type="button" aria-pressed={view==="plans"} onClick={()=>setView("plans")}
              className={`btn ${view==="plans"?"journal-tab-active":""}`}>투자 계획</button>
            <button type="button" aria-pressed={view==="trades"} onClick={()=>setView("trades")}
              className={`btn ${view==="trades"?"journal-tab-active":""}`}>직접 입력 거래</button>
            <button type="button" aria-pressed={view==="broker"} onClick={()=>setView("broker")}
              className={`btn ${view==="broker"?"journal-tab-active":""}`}>Tiger 검증 체결</button>
          </div>

          {view!=="trades" && view!=="broker" ? <div className="journal-timeline">
            {(view==="plans"?history.filter(e=>e.type==="plan"):history).length===0 ?
              <div className="journal-empty">아직 작성한 기록이 없습니다. <Link href={view==="plans"?"/private/journal/new?mode=plan&ticker="+encodeURIComponent(selected):"/private/journal/new?ticker="+encodeURIComponent(selected)}>{view==="plans"?"첫 목표·손절 계획 작성 →":"새 투자 기록 작성 →"}</Link></div>:
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
                <div><strong>{t.side==="BUY"?"매수":"매도"} {formatDecimal(t.quantity,"?")}주</strong>
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
                <strong>{t.side==="BUY"?"매수":"매도"} {formatDecimal(t.quantity)}주 · {formatDecimal(t.price)} {t.currency}</strong>
                <small>{displayTime(t.executedAt)} · {brokerAccountNames.get(t.accountId)??"Tiger 계좌"} ·
                  증권사 원본 검증 v{t.reviewVersion}</small>
                <small>수수료 {formatDecimal(t.fee)} {t.currency} · {t.provenance} · 이 체결은 직접 입력 거래와 별도입니다.</small>
                {entries.filter(e=>e.brokerRef?.accountId===t.accountId &&
                     e.brokerRef?.sourceRef===t.sourceRef &&
                     e.brokerRef?.reviewVersion===t.reviewVersion).map(e=>
                  <div key={e.id} className="journal-entry-content">
                    <small>연결된 내 투자 메모 · {displayTime(e.createdAt)}</small>
                    <p className="journal-entry-text">{e.content}</p>
                  </div>)}
                <Link className="btn btn-outline"
                  href={"/private/journal/new?mode=broker&ticker="+encodeURIComponent(t.symbol)}>
                  체결 복기 작성 →
                </Link>
              </div>
            </article>)}
            {brokerRead?.readEnabled && <p className="journal-limit">
              독립 검증 후 공개된 최근 체결만 표시합니다.
              {brokerRead?.truncated?" 100건 상한에 도달해 일부 거래가 목록에 없을 수 있습니다.":""}
              메모는 사용자가 직접 해당 체결을 선택하여 연결할 때만 귀속됩니다.
            </p>}
          </div>}
        </section>}
      </div>
    </div>}
  </div>;
}
