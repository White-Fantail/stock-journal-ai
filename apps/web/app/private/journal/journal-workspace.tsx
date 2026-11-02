"use client";

import {IndicatorRecordList} from "../indicators/record-list";
import type {IndicatorRecord} from "../../../lib/indicators";
import { useEffect, useMemo, useState } from "react";
import { formatMoney,formatPercent } from "../../../lib/format-decimal";
import {tradeLinked} from "../../../lib/trade-reasons";
import {orderJournalSymbols,journalLastRecordedAt} from "../../../lib/journal-symbol-order";
import Link from "next/link";
import {decisionGuide} from "../../../lib/journal-decision-guide";
import {PlanPriceTimeline} from "./plan-price-timeline";
import {InvestmentActivityFeed} from "./investment-activity-feed";
import type { TigerLedgerRead, TigerPersonalPosition, TigerPersonalOrder, TigerPersonalFill } from "../../../lib/tiger-api";
import type {
  JournalEntry, JournalPlan, ManualTradeEvent,
} from "../../../lib/saas-trades-api";

const STRATEGY_LABEL:Record<string,string>={
  LONG_TERM:"장기 투자",TECHNICAL:"기술적 근거 진입",
  EVENT_DRIVEN:"이벤트·실적 기반",OTHER:"기타 전략",
};
const HORIZON_LABEL:Record<string,string>={
  UNDER_3_MONTHS:"3개월 미만",THREE_TO_TWELVE_MONTHS:"3개월~1년",
  ONE_TO_THREE_YEARS:"1~3년",OVER_THREE_YEARS:"3년 이상",
  OPEN_ENDED:"장기·종료 시점 미정",
};
const CADENCE_LABEL:Record<string,string>={
  WEEKLY:"매주",MONTHLY:"매월",QUARTERLY:"분기마다",
  SEMIANNUAL:"6개월마다",ANNUAL:"매년",EVENT_DRIVEN:"기업 공시·사건 발생 시",
};
type Summary={
  ticker:string;latest:JournalEntry|null;thesis:JournalEntry|null;
  plan:JournalPlan|null;review:JournalEntry|null;
  watched:boolean;count:number;lastRecordedAt:number|null;
};
type Props={
  enabled:boolean;
  manualAvailable:boolean;
  indicatorHistory:{records:IndicatorRecord[];hasMore:boolean}|null;
  entries:readonly JournalEntry[];
  plans:readonly JournalPlan[];
  trades:readonly ManualTradeEvent[];
  brokerRead:TigerLedgerRead|null;
  personalPositions:readonly TigerPersonalPosition[];
  personalOrders:readonly TigerPersonalOrder[];
  personalFills:readonly TigerPersonalFill[];
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
  return `${formatMoney(compact)} ${currency??""}`;
}
function contentPreview(value:string,max=115){
  return value.length>max?value.slice(0,max)+"…":value;
}
function latest<T extends {createdAt:string}>(rows:readonly T[]):T|null{
  return [...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null;
}

export function JournalWorkspace({
  enabled,manualAvailable,indicatorHistory,entries,plans,trades,brokerRead,personalPositions,personalOrders,personalFills,initialTicker,
}:Props){
  // A trade-linked TRADE_NOTE is part of that transaction, not a second thesis.
  const investmentEntries=useMemo(()=>entries.filter(e=>!tradeLinked(e)),[entries]);
  const symbols=useMemo(()=>{
    const names=new Set<string>();
    for(const item of indicatorHistory?.records??[]) names.add(item.ticker);
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
    for(const p of personalOrders) names.add(p.symbol);
    for(const p of personalFills) names.add(p.symbol);
    return orderJournalSymbols([...names],entries,plans,personalPositions.map(p=>p.symbol));
  },[entries,plans,trades,brokerRead,personalPositions,personalOrders,personalFills,indicatorHistory]);
  const [selected,setSelected]=useState(initialTicker&&symbols.includes(initialTicker)?initialTicker:symbols[0]??"");
  useEffect(()=>{if(initialTicker&&symbols.includes(initialTicker))setSelected(initialTicker);},[initialTicker,symbols]);
  const [search,setSearch]=useState("");

  const summaries=useMemo(()=>{
    return symbols.map(ticker=>{
      const per=investmentEntries.filter(e=>e.ticker===ticker)
        .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      const p=latest(plans.filter(p=>p.ticker===ticker));
      const mark=per.find(e=>e.kind==="WATCHLIST_ADD"||e.kind==="WATCHLIST_REMOVE");
      return {
        ticker,latest:per[0]??null,thesis:per.find(e=>e.kind==="THESIS")??null,
        review:per.find(e=>e.kind==="REVIEW")??null,plan:p,
        watched:mark?.kind==="WATCHLIST_ADD",count:per.length+plans.filter(x=>x.ticker===ticker).length,
        lastRecordedAt:journalLastRecordedAt(ticker,investmentEntries,plans),
      };
    });
  },[symbols,investmentEntries,plans]);
  const active:Summary|undefined=summaries.find(s=>s.ticker===selected);
  const guide=active?decisionGuide(active.ticker,plans,investmentEntries):null;
  const authoredReason=active?.plan?.rationale.trim()||active?.thesis?.content.trim()||null;
  const authoredReasonAt=active?.plan?.rationale.trim()?active?.plan?.createdAt:active?.thesis?.createdAt;
  const shownSymbols=summaries.filter(s=>s.ticker.toUpperCase().includes(search.trim().toUpperCase()));
  const activeTrades=trades.filter(t=>t.ticker===selected&&t.kind==="EXECUTION");
  const voided=new Set(trades.filter(t=>t.kind==="VOID").map(t=>t.voidsEventId));
  const connectedTrades=activeTrades.filter(t=>!voided.has(t.id));
  const totalEntries=investmentEntries.length+plans.length;
  const listedPlans=summaries.filter(s=>s.plan!==null).length;
  const missingThesis=summaries.filter(s=>!s.thesis).length;

  function choose(ticker:string){
    setSelected(ticker);
  }

  return <div className="journal-root">
    <details className="journal-metrics-details">
      <summary>내 투자 기록 현황 보기</summary>
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
    </details>

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
          <div><span className="journal-kicker">MY SYMBOLS</span><h2>종목별 일지</h2><small className="user-muted">최근 투자 기록순</small></div>
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
                <small>{personalPositions.some(p=>p.symbol===s.ticker)?"보유 관측 · ":""}{s.watched?"관심 · ":""}{s.count}건 기록{s.lastRecordedAt!==null?` · 최근 ${new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",year:"2-digit",month:"2-digit",day:"2-digit"}).format(s.lastRecordedAt)}`:""}
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
              {!active&&<p>첫 종목 계획은 거래 없이도 작성할 수 있습니다.</p>}
            </div>
            {active&&<div className="journal-current-actions">
               <Link className="btn btn-outline" href={"/private/journal/new?ticker="+encodeURIComponent(active.ticker)}>+ 투자 판단 작성</Link>
               {active.plan&&<Link className="btn btn-outline" href={"/private/journal/review/new?ticker="+encodeURIComponent(active.ticker)}>투자 원칙 복기</Link>}
               <Link className="btn btn-primary" href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(active.ticker)}>투자 전략·계획 관리</Link>
             </div>}
             {active?.watched&&<span className="pill">관심종목</span>}
          </div>
          {active&&authoredReason&&<div className="journal-primary-reason">
            <h3>내가 기록한 투자 논리</h3>
            <p>{authoredReason}</p>
            {authoredReasonAt&&<small>직접 작성 · {displayTime(authoredReasonAt)} · {active.plan?.rationale.trim()?"현재 투자계획의 근거":"별도 판단 메모"}</small>}
          </div>}
          {active?.plan&&<div className="journal-plan-snapshot" aria-label="현재 작성한 투자계획">
            <div><span>목표가</span><strong>{planPrice(active.plan.targetPrice,active.plan.priceCurrency)}</strong></div>
            <div><span>손절가</span><strong>{planPrice(active.plan.stopPrice,active.plan.priceCurrency)}</strong></div>
            <div><span>투자 전략</span><strong>{active.plan.strategyType?STRATEGY_LABEL[active.plan.strategyType]??"확인 필요":"미설정"}</strong></div>
            <div><span>최대 보유 비중</span><strong>{active.plan.maxAllocationPct?formatPercent(active.plan.maxAllocationPct)+"%":"미설정"}</strong></div>
          </div>}
          {active&&<PlanPriceTimeline ticker={selected} plans={plans}
            trades={connectedTrades} observedFills={observedFills}
            verifiedFills={brokerRead?.readEnabled?brokerRead.executions.filter(e=>e.symbol===selected):[]}/>}
          {!active&&<div className="journal-actions">
             <p className="journal-instruction">첫 종목을 선택하거나 새 기록을 작성하세요.</p>
             <Link className="btn btn-primary" href="/private/journal/new">+ 새 투자 기록</Link>
             <Link className="btn btn-outline" href="/private/journal/new?mode=plan">+ 투자 계획</Link>
           </div>}
        </section>

        {active&&<InvestmentActivityFeed key={selected} ticker={selected}
          entries={entries} plans={plans} trades={trades} orders={personalOrders}
          fills={personalFills} verified={brokerRead?.readEnabled?brokerRead.executions:[]}
          brokerRead={brokerRead} manualAvailable={manualAvailable}/>}
        {active?.plan&&<details className="journal-investment-details">
            <summary>투자계획 상세 조건 보기 (선택 사항)</summary>
          <div className="journal-current-grid" aria-label="투자 전략과 위험 계획">
            <div><span>투자 전략</span>
              <strong>{active.plan?.strategyType?STRATEGY_LABEL[active.plan.strategyType]??"확인 필요":"미설정"}</strong>
              <small>{active.plan?.investmentHorizon?HORIZON_LABEL[active.plan.investmentHorizon]??"기간 확인 필요":"투자 기간 미설정"}</small>
            </div>
            <div><span>최대 보유 비중 (나의 기준)</span>
              <strong>{active.plan?.maxAllocationPct?formatPercent(active.plan.maxAllocationPct)+"%":"미설정"}</strong>
              <small>계좌 스냅샷과 직접 비교한 매매 신호가 아닙니다.</small>
            </div>
            <div><span>정기 투자 점검</span>
              <strong>{active.plan?.reviewCadence?CADENCE_LABEL[active.plan.reviewCadence]??"확인 필요":"미설정"}</strong>
              <small>가격 감시 없이 스스로 검토하는 주기입니다.</small>
            </div>
          </div>
          {active?.plan?.riskDecisionNote&&<p className="journal-form-hint">
            <strong>당시 내가 확인한 매수 가정 · 사용자 작성:</strong> {active.plan.riskDecisionNote}
          </p>}
          {active?.plan?.invalidationCondition&&<p className="journal-form-hint">
            <strong>투자 논리 무효화 조건:</strong> {active.plan.invalidationCondition}
          </p>}
          </details>}
          
        {active&&<details className="user-panel">
          <summary>{selected} 보조지표 기록 보기</summary>
          <p><a href={"/private/indicators/record?ticker="+encodeURIComponent(selected)}>당시 값 기록 →</a>{" · "}
            <a href={"/private/indicators?ticker="+encodeURIComponent(selected)}>이 종목의 지표 기록 더 보기 →</a></p>
          {indicatorHistory?<IndicatorRecordList records={indicatorHistory.records.filter(r=>r.ticker===selected)} hasMore={indicatorHistory.hasMore}/>:
            <p role="alert">보조지표 기록을 불러올 수 없습니다.</p>}
        </details>}
        
        {active&&guide&&<details className="user-panel journal-guidance-details"><summary>투자 관리 가이드 보기 (선택 사항)</summary><div className="journal-guided-workflow" aria-label="종목별 투자 관리 흐름">
            <article className="journal-guided-step">
              <small>1 · 현재 계획</small>
              <strong>{guide.plan==="EXISTS"?"투자계획 기록됨":"투자계획 작성 필요"}</strong>
              <p>{active.plan?.invalidationCondition
                ?"재검토 조건: "+contentPreview(active.plan.invalidationCondition,150):
                "어떤 조건에서 투자 논리를 재검토할지 기록해 두세요."}</p>
              <Link href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(active.ticker)}>
                {guide.plan==="EXISTS"?"계획 확인·변경":"내 계획 세우기"} →</Link>
            </article>
            <article className="journal-guided-step">
              <small>2 · 판단 기록</small>
              <strong>{guide.thesis==="EXISTS"?"투자 논리 기록됨":"투자 논리 기록 필요"}</strong>
              <p>{authoredReason?contentPreview(authoredReason,150):
                "왜 이 종목을 선택했는지, 어떤 가정을 믿고 있는지 기록하세요."}</p>
              <Link href={"/private/journal/new?ticker="+encodeURIComponent(active.ticker)}>
                {authoredReason?"추가 판단 메모 작성":"판단 기록 작성"} →</Link>
            </article>
            <article className="journal-guided-step">
              <small>3 · 정기 복기</small>
              <strong>{guide.coverageIncomplete?"일지 일부 조회 · 일정 미확인":
                !active.plan?"먼저 투자계획을 세우세요":
                guide.due?"내가 정한 점검 시점 도래":
                guide.nextReview?"다음 점검 "+displayTime(guide.nextReview):
                guide.cadenceKnown?"점검 예정일 확인 필요":"정기 점검 주기 미설정"}</strong>
              <p>{guide.reviewDate?"최근 사용자 복기 "+displayTime(guide.reviewDate)+" · 자동 준수 판정 아님":
                "투자 이후에도 판단이 유효한지 스스로 점검해 보세요."}</p>
              {active.plan?<Link href={"/private/journal/review/new?ticker="+encodeURIComponent(active.ticker)}>원칙 자기평가 →</Link>:
                <Link href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(active.ticker)}>점검 주기 설정 →</Link>}
            </article>
          </div></details>}

        {active&&<p className="journal-coaching-link"><Link
            href={"/private/analysis?mode=COACHING&ticker="+encodeURIComponent(active.ticker)}>
              이 종목의 판단 습관을 AI와 돌아보기 →</Link>
            <small> 선택한 기록 일부 전송은 다음 화면에서 별도로 동의합니다.</small></p>}
          
      </div>
    </div>}
  </div>;
}
