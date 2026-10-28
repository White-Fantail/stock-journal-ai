import {fetchIndicatorRecords} from "../../../lib/saas-trades-api";
import {indicatorCriterion,SIDE_LABELS,STAGE_LABELS,ASSESSMENT_LABELS,type IndicatorFilter} from "../../../lib/indicators";
export async function IndicatorHistory({subject,filter}:{subject:string;filter:IndicatorFilter}){
 const result=await fetchIndicatorRecords(subject,filter).catch(()=>null);
 if(!result)return <p role="alert">보조지표 기록을 불러올 수 없습니다.</p>;
 return <section aria-label="보조지표 기록" className="indicator-history">
   <h2>매매 당시 보조지표</h2>
   {result.records.length===0?<p>아직 기록한 보조지표가 없습니다.</p>:result.records.map(r=><article className="user-panel" key={r.id}>
     <h3>{r.ticker} · {SIDE_LABELS[r.side]}</h3>
     <p>관측 시각: {r.observedAt}</p>
     <ul>{r.observations.map(o=><li key={o.rule.id}>
       <strong>{o.rule.name} {o.rule.parameters} · {o.rule.timeframe}</strong> ({STAGE_LABELS[o.rule.stage]})<br/>
       당시 기준: {indicatorCriterion(o.rule)} · 입력값: {o.value??"미기록"}<br/>
       {ASSESSMENT_LABELS[o.assessment]} · {o.basis==="ENTERED_VALUE_COMPARISON"?"입력값과 비교":o.basis==="USER_ASSESSED"?"직접 판단":"값 미기록"}
     </li>)}</ul>
     {r.note&&<p style={{whiteSpace:"pre-wrap"}}>{r.note}</p>}
     {r.tradeEventId&&<a href={`/private/trades/${r.tradeEventId}`}>연결된 거래 보기 →</a>}
     {r.journalId&&<a href={`/private/journal?ticker=${encodeURIComponent(r.ticker)}`}>연결된 종목 일지 보기 →</a>}
     <p className="user-footnote">직접 작성 · 당시 기준 보존 · 작성 시각 {r.createdAt}</p>
   </article>)}
   {result.hasMore&&<p>최근 200개 기록입니다. 전체 기록은 내 데이터 내보내기에 포함됩니다.</p>}
 </section>;
}
