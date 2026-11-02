"use client";

import {useMemo,useState} from "react";
import Link from "next/link";
import {formatMoney,formatQuantity} from "../../../lib/format-decimal";
import {activityForTicker,planBeforeTrade,type ActivitySources,type InvestmentActivity} from "../../../lib/investment-activity";
import {notesForObserved,tigerTradeHref} from "../../../lib/trade-reasons";
import {orderStatusLabel} from "../../../lib/tiger-order-display";
import type {TigerLedgerRead} from "../../../lib/tiger-api";

type Filter="ALL"|"PLAN"|"TRADE";
type Props=ActivitySources&{brokerRead:TigerLedgerRead|null;manualAvailable:boolean};

const labelTime=(at:number|null)=>at===null?"기록 시각 미확인":
  new Intl.DateTimeFormat("ko-KR",{
    timeZone:"Pacific/Auckland",dateStyle:"medium",timeStyle:"short",
  }).format(at);
const price=(v:string|null,currency:string|null)=>v===null?"미설정":
  formatMoney(v)+" "+(currency??"");

export function InvestmentActivityFeed(props:Props){
  const {ticker,plans,entries,brokerRead,manualAvailable}=props;
  const [filter,setFilter]=useState<Filter>("ALL");
  const activity=useMemo(()=>activityForTicker(props),[
    ticker,entries,plans,props.trades,props.orders,props.fills,props.verified,
  ]);
  const planCount=activity.filter(a=>a.category==="PLAN"||a.category==="NOTE").length;
  const tradeCount=activity.length-planCount;
  const visible=activity.filter(a=>filter==="ALL"||(filter==="PLAN"?
    a.category==="PLAN"||a.category==="NOTE":
    a.category!=="PLAN"&&a.category!=="NOTE"));
  const selectedPlans=plans.filter(p=>p.ticker===ticker);
  return <section className="journal-history" aria-label={ticker+" 투자 계획 및 실제 거래"}>
    <div className="journal-section-heading">
      <div><span className="journal-kicker">PLAN / EXECUTION / REVIEW</span>
        <h2>{ticker} · 계획과 실제 거래</h2></div>
      <span className="journal-history-count">현재 조회 {activity.length}건</span>
    </div>
    <p className="journal-limit">시간순으로 투자 계획, 판단 기록, 실제 거래 자료를 함께 살펴보세요.
      계획은 사용자 작성이며 주문이 아닙니다. 거래마다 출처와 검증 상태를 구분합니다.</p>
    <nav className="journal-unified-actions" aria-label="투자 기록 작업">
      <Link className="btn btn-primary" href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker)}>계획 변경</Link>
      <Link className="btn btn-outline" href={"/private/trades/new"}>+ 거래 직접 기록</Link>
      <Link className="btn btn-outline" href={"/private/journal/review/new?ticker="+encodeURIComponent(ticker)}>투자 복기</Link>
      <Link className="btn btn-outline" href="/private/trades">Tiger 거래 상세</Link>
    </nav>
    <div className="journal-tabs journal-activity-filters" role="group" aria-label="투자 활동 구분">
      {([
        ["ALL","전체 흐름",activity.length],
        ["PLAN","계획·판단",planCount],
        ["TRADE","실제 거래",tradeCount],
      ] as const).map(([key,name,count])=>
        <button type="button" key={key} className={"btn "+(filter===key?"journal-tab-active":"")}
          aria-pressed={filter===key} onClick={()=>setFilter(key)}>
          {name} <small>{count}</small>
        </button>)}
    </div>
    {!manualAvailable&&<p role="alert" className="journal-activity-warning">
      직접 입력한 거래를 불러올 수 없어 일부 거래가 누락되었습니다.</p>}
    {!brokerRead&&<p role="status" className="journal-activity-warning">
      독립 검증 체결 조회가 불가능합니다. 기존 기록이 없다는 뜻은 아닙니다.</p>}
    {visible.length===0?<div className="journal-empty">
      {filter==="TRADE"?"현재 조회한 범위에서 이 종목의 거래가 확인되지 않습니다. 거래가 없었다는 의미는 아닙니다.":
      filter==="PLAN"?"아직 작성한 투자 판단이나 계획이 없습니다.":"현재 조회한 기록이 없습니다."}
      <p><Link href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker)}>내 투자 계획 작성 →</Link></p>
    </div>:
      <div className="journal-activity-stream">
        {visible.map(item=>{
          const prior=planBeforeTrade(item,selectedPlans);
          return <article className={"journal-activity-item "+(
            item.category==="PLAN"||item.category==="NOTE"?"journal-activity-plan":"journal-activity-trade"
          )} key={item.id}>
            <div className="journal-entry-meta">
              <span className={"journal-activity-type "+(
                item.category==="PLAN"||item.category==="NOTE"?"is-plan":"is-trade"
              )}>{item.category==="PLAN"?"계획 · 개정":
                item.category==="NOTE"?"투자 판단 · 복기":
                item.category==="MANUAL"?"거래 · 직접 입력 (미검증)":
                item.category==="OBSERVED_ORDER"?"주문 · Tiger 관측 (미검증)":
                item.category==="UNLINKED_FILL"?"개별 체결 · Tiger 관측 (미검증)":
                "체결 · 독립 검증"}</span>
              <time>{labelTime(item.at)}</time>
            </div>
            <ActivityBody item={item} entries={entries}/>
            {prior&&<details className="journal-activity-context">
              <summary>거래 이전에 작성한 계획 확인 · {labelTime(Date.parse(prior.createdAt))}</summary>
              <div className="journal-plan-values">
                <span>당시 목표 <strong>{price(prior.targetPrice,prior.priceCurrency)}</strong></span>
                <span>당시 손절 <strong>{price(prior.stopPrice,prior.priceCurrency)}</strong></span>
              </div>
              <p className="journal-entry-text">{prior.rationale}</p>
              <small>거래 시각 이전의 가장 최근 작성본입니다. 거래가 이 계획을 따랐다는 증거가 아니며, 나중에 작성한 계획을 소급 적용하지 않습니다.</small>
            </details>}
          </article>;
        })}
      </div>}
    <p className="journal-limit">조회 범위 제한: 직접 입력 거래는 최근 최대 50건, Tiger 관측은 현재 불러온 주문·체결 범위, 독립 검증 체결은 공개된 원장 범위입니다.
      동일 거래가 다른 출처에 나타날 수 있어 합산하거나 자동 중복 제거하지 않습니다.
      연결되지 않은 개별 체결은 별도로 표시하고, 시각이 불명확하면 타임라인 하단에 놓습니다.
      <Link href="/private/trades"> 전체 주문·거래 기록 보기 →</Link></p>
  </section>;
}

function ActivityBody({item,entries}:{
  item:InvestmentActivity;entries:ActivitySources["entries"];
}){
  if(item.category==="PLAN"){
    const p=item.value;
    return <div>
      <div className="journal-plan-values">
        <span>목표 <strong>{price(p.targetPrice,p.priceCurrency)}</strong></span>
        <span>손절 <strong>{price(p.stopPrice,p.priceCurrency)}</strong></span>
      </div>
      <p className="journal-entry-text">{p.rationale}</p>
      {p.invalidationCondition&&<p className="journal-entry-text">무효화 기준: {p.invalidationCondition}</p>}
      {(p.priceLevels?.length??0)>0&&<small>진입·확인 가격 {p.priceLevels.length}개 · 상단 가격 계획 차트에서 확인</small>}
      <small>사용자 직접 작성 · 실제 주문 아님 · 이전 개정 이력 보존</small>
    </div>;
  }
  if(item.category==="NOTE"){
    const e=item.value;
    return <div><p className="journal-entry-text">{e.content}</p>
      <small>사용자 기록 · {e.kind==="REVIEW"?"투자 복기":e.kind==="STRATEGY"?"전략 판단":e.kind==="THESIS"?"투자 논리":"기타 판단"}</small>
    </div>;
  }
  if(item.category==="MANUAL"){
    const t=item.value;
    const linked=entries.filter(e=>e.tradeEventId===t.id);
    return <div>
      <strong>{t.side==="BUY"?"매수":"매도"} {formatQuantity(t.quantity,"?")}주 · {price(t.price,t.currency)}</strong>
      <small>사용자 입력 가격·수량 · 증권사 확인 아님{!t.executedAt?" · 체결 시각 미입력":""}</small>
      <p className="journal-entry-text"><strong>매매 이유:</strong> {t.rationale||"미기록"}</p>
      {linked.map(e=><p className="journal-entry-text" key={e.id}>{e.content}</p>)}
      <Link href={"/private/trades/"+encodeURIComponent(t.id)}>거래 상세 · 이유 관리 →</Link>
    </div>;
  }
  if(item.category==="OBSERVED_ORDER"){
    const {order:o,fills,reconciliation}=item.value;
    const reasons=notesForObserved(entries,o.sourceRef,"ORDER");
    return <div>
      <strong>{o.side==="BUY"?"매수":"매도"} 주문 · 관측 체결 {formatQuantity(o.filled,"?")}주</strong>
      <small>{orderStatusLabel(o.status)} · 주문 지정 가격 {price(o.price,o.currency)} · 개별 체결 관측 {fills.length}건</small>
      {reasons.length>0?<details className="journal-activity-context">
        <summary>내 매매 이유 {reasons.length}건 보기</summary>
        {reasons.map(e=><p className="journal-entry-text" key={e.id}>{e.content}</p>)}
      </details>:<small>이 주문에 연결한 매매 이유 미기록</small>}
      {fills.length>0&&<details className="journal-activity-context">
        <summary>연결된 개별 체결 관측 {fills.length}건 · {reconciliation==="OBSERVED_SUM_MATCH"?"관측 수량 일치":"수량 검토 필요"}</summary>
        {fills.map(f=><div className="journal-trade-row" key={f.sourceRef}>
          <div><strong>{formatQuantity(f.quantity)}주 · {price(f.price,f.currency)}</strong>
            <small>원본 시각 {f.timeRaw??"미확인"} · 시간대 미검증</small>
            {notesForObserved(entries,f.sourceRef,"FILL").map(e=>
              <p className="journal-entry-text" key={e.id}>{e.content}</p>)}</div>
          <Link href={tigerTradeHref(f.sourceRef,0,"FILL")}>상세 →</Link>
        </div>)}
      </details>}
      <Link href={tigerTradeHref(o.sourceRef,0)}>원본 주문·매매 이유 관리 →</Link>
    </div>;
  }
  if(item.category==="UNLINKED_FILL"){
    const f=item.value;
    return <div>
      <strong>{f.side==="BUY"?"매수":"매도"} {formatQuantity(f.quantity)}주 · {price(f.price,f.currency)}</strong>
      <small>주문 연결 확인 불가 · 원본 시각 {f.timeRaw??"미확인"} · 시간대 미검증</small>
      {notesForObserved(entries,f.sourceRef,"FILL").map(e=>
        <p className="journal-entry-text" key={e.id}>{e.content}</p>)}
      <Link href={tigerTradeHref(f.sourceRef,0,"FILL")}>개별 체결·이유 관리 →</Link>
    </div>;
  }
  const v=item.value;
  const reasons=entries.filter(e=>e.brokerRef?.accountId===v.accountId&&
    e.brokerRef.sourceRef===v.sourceRef&&e.brokerRef.reviewVersion===v.reviewVersion);
  return <div>
    <strong>{v.side==="BUY"?"매수":"매도"} {formatQuantity(v.quantity)}주 · {price(v.price,v.currency)}</strong>
    <small>계좌별 독립 검증 v{v.reviewVersion} · 수수료 {price(v.fee,v.currency)} · 직접 입력 거래와 별도</small>
    {reasons.map(e=><p className="journal-entry-text" key={e.id}>{e.content}</p>)}
    {reasons.length===0&&<small>이 검증 체결에 연결한 이유 미기록</small>}
    <Link href="/private/trades">검증 체결 출처 확인 →</Link>
  </div>;
}
