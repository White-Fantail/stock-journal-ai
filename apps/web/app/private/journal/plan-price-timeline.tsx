"use client";
import {useMemo,useState} from "react";
import Link from "next/link";
import type {JournalPlan,ManualTradeEvent} from "../../../lib/saas-trades-api";
import type {TigerPersonalFill,VerifiedBrokerExecution} from "../../../lib/tiger-api";

type Kind="ENTRY"|"CONFIRM"|"TARGET"|"STOP";
type Line={id:string;kind:Kind;price:number;raw:string;note:string;at:number;until:number|null;latest:boolean};
type Marker={id:string;price:number;raw:string;at:number;side:"BUY"|"SELL";source:string};
const COLORS:Record<Kind,string>={ENTRY:"#3885cd",CONFIRM:"#cb8c2b",TARGET:"#26926c",STOP:"#d35454"};
const NAMES:Record<Kind,string>={ENTRY:"진입",CONFIRM:"확인",TARGET:"목표",STOP:"손절"};
const DAY=86400000;
function number(v:string|null|undefined){
  return v&&/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/.test(v)&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
}
function date(v:string|null|undefined){const n=v?Date.parse(v):NaN;return Number.isFinite(n)?n:null;}
function label(n:number){return new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",month:"numeric",day:"numeric"}).format(n);}
export function PlanPriceTimeline({ticker,plans,trades,observedFills,verifiedFills}:{
  ticker:string;plans:readonly JournalPlan[];trades:readonly ManualTradeEvent[];
  observedFills:readonly TigerPersonalFill[];verifiedFills:readonly VerifiedBrokerExecution[];
}){
  const [history,setHistory]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const data=useMemo(()=>{
    const ordered=plans.filter(p=>p.ticker===ticker&&date(p.createdAt)!==null)
      .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    const last=ordered.at(-1),currency=last?.priceCurrency??null;
    const lines:Line[]=[],marks:Marker[]=[];
    if(!last||!currency)return {currency,lines,marks};
    ordered.forEach((p,i)=>{
      if(p.priceCurrency!==currency)return;
      const at=date(p.createdAt)!;
      const until=i<ordered.length-1?date(ordered[i+1].createdAt):null;
      const latest=p.id===last.id;
      const add=(kind:Kind,raw:string|null|undefined,note:string,key:string)=>{
        const price=number(raw);
        if(price!==null)lines.push({id:p.id+":"+key,kind,price,raw:raw!,note,at,until,latest});
      };
      add("TARGET",p.targetPrice,p.rationale,"target");
      add("STOP",p.stopPrice,p.invalidationCondition??p.rationale,"stop");
      (p.priceLevels??[]).forEach((l,i)=>{
        if(l.kind==="ENTRY"||l.kind==="CONFIRM")add(l.kind,l.price,l.note,String(i));
      });
    });
    const mark=(id:string,raw:string|null|undefined,atRaw:string|null|undefined,
      side:"BUY"|"SELL",source:string,sourceCurrency:string|null|undefined)=>{
      const price=number(raw),at=date(atRaw);
      if(sourceCurrency===currency&&price!==null&&at!==null)
        marks.push({id,price,raw:raw!,at,side,source});
    };
    trades.filter(t=>t.kind==="EXECUTION"&&(t.side==="BUY"||t.side==="SELL")).forEach(t=>
      mark("manual:"+t.id,t.price,t.executedAt,t.side!,"직접 입력 · 미검증",t.currency));
    observedFills.filter(f=>f.symbol===ticker).forEach(f=>
      mark("observed:"+f.sourceRef,f.price,f.timeRaw,f.side,"Tiger 체결 관측 · 미검증",f.currency));
    verifiedFills.filter(f=>f.symbol===ticker).forEach(f=>
      mark("verified:"+f.sourceRef,f.price,f.executedAt,f.side,"독립 검증 체결",f.currency));
    return {currency,lines,marks:marks.slice(0,100)};
  },[ticker,plans,trades,observedFills,verifiedFills]);
  const visible=history?data.lines:data.lines.filter(l=>l.latest);
  const prices=[...visible.map(l=>l.price),...data.marks.map(m=>m.price)];
  const times=[...visible.map(l=>l.at),...visible.flatMap(l=>l.until?[l.until]:[]),...data.marks.map(m=>m.at)];
  const min=prices.length?Math.min(...prices):0,max=prices.length?Math.max(...prices):1;
  const pad=Math.max((max-min)*0.12,max*.008,.01),lo=min-pad,hi=max+pad;
  const start=times.length?Math.min(...times):0;
  const observedEnd=times.length?Math.max(...times):start+30*DAY;
  const end=observedEnd+Math.max(3*DAY,(observedEnd-start)*.12);
  const x=(v:number)=>30+(v-start)/Math.max(DAY,end-start)*440;
  const y=(v:number)=>192-(v-lo)/(hi-lo)*158;
  const active=visible.find(l=>l.id===selected);
  return <section className="plan-price-chart" aria-label={ticker+" 가격 계획 타임라인"}>
    <div className="plan-price-chart-top"><div>
      <h3>가격 계획 차트</h3>
      <p className="journal-form-hint">기록한 가격선·체결 마커 (실제 주가 캔들 아님)</p>
    </div><Link className="btn btn-outline" href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker)}>가격선 변경</Link></div>
    {!data.currency||data.lines.length===0?
      <p className="journal-form-hint">표시할 계획 가격이 없습니다. 목표·손절 또는 진입·확인 가격을 기록해 주세요.</p>:<>
      <div className="plan-price-chart-meta"><span>가격 통화 {data.currency}</span>
        <label><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/> 이전 계획선</label>
      </div>
      <svg viewBox="0 0 540 224" width="100%" role="img"
        aria-label="계획 작성일과 체결 날짜에 따른 사용자 가격 기록. 시장 가격 움직임 아님.">
        {[0,1,2,3,4].map(i=><g key={i}>
          <line x1="30" y1={34+i*39.5} x2="474" y2={34+i*39.5} stroke="currentColor" opacity=".1" strokeDasharray="3 4"/>
          <text x="480" y={38+i*39.5} fill="currentColor" opacity=".7" fontSize="10">{(hi-(hi-lo)*i/4).toFixed(2)}</text>
        </g>)}
        {visible.map(l=><g key={l.id}>
          <line x1={x(l.at)} x2={x(l.until??end)} y1={y(l.price)} y2={y(l.price)}
            stroke={COLORS[l.kind]} strokeWidth={l.latest?2.5:1.5} strokeOpacity={l.latest?1:.5}
            strokeDasharray={l.kind==="ENTRY"?"0":"6 4"}/>
          <circle cx={x(l.at)} cy={y(l.price)} r="3" fill={COLORS[l.kind]}/>
          <title>{NAMES[l.kind]} {l.raw} {data.currency} · {l.note}</title>
        </g>)}
        {data.marks.map(m=><g key={m.id}>
          <circle cx={x(m.at)} cy={y(m.price)} r="5" fill={m.side==="BUY"?"#3885cd":"#d35454"}
            stroke="currentColor" strokeWidth=".7"/>
          <title>{m.side==="BUY"?"매수":"매도"} {m.raw} {data.currency} · {m.source} · {label(m.at)}</title>
        </g>)}
        <text x="30" y="214" fill="currentColor" opacity=".7" fontSize="11">{label(start)}</text>
        <text x="470" y="214" fill="currentColor" opacity=".7" fontSize="11" textAnchor="end">{label(end)}</text>
      </svg>
      <div className="plan-price-legend">
        {(["ENTRY","CONFIRM","TARGET","STOP"] as const).map(k=>
          <span key={k}><i style={{backgroundColor:COLORS[k]}}/>{NAMES[k]}</span>)}
        <span>● 매수·매도</span>
      </div>
      <div className="plan-price-level-list">
        {visible.map(l=><button type="button" key={l.id} aria-pressed={selected===l.id}
          onClick={()=>setSelected(l.id)} className="plan-price-level">
          <strong><i style={{backgroundColor:COLORS[l.kind]}}/>{NAMES[l.kind]} {l.raw} {data.currency}</strong>
          <small>{l.latest?"현재":"이전"} · {label(l.at)} · {l.note||"별도 메모 없음"}</small>
        </button>)}
      </div>
      {active&&<p role="status" className="journal-form-hint">{NAMES[active.kind]} {active.raw} {data.currency} · {active.note||"별도 메모 없음"}</p>}
      {data.marks.length>0&&<details className="data-disclosure">
        <summary>거래 마커 {data.marks.length}건</summary>
        <ul>{data.marks.map(m=><li key={m.id}>{label(m.at)} · {m.side==="BUY"?"매수":"매도"} {m.raw} {data.currency} · {m.source}</li>)}</ul>
      </details>}
      <p className="journal-form-hint">가로축은 계획 작성·체결 날짜이며 선은 사용자 계획입니다. 실제 주가 흐름을 의미하지 않습니다. 다른 통화나 날짜가 없는 거래는 제외합니다. 거래 이유는 거래 기록에서 확인하세요.</p>
    </>}
  </section>;
}
