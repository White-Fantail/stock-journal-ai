import {redirect} from "next/navigation";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchIndicatorRules} from "../../../lib/saas-trades-api";
import {indicatorCriterion,SIDE_LABELS,STAGE_LABELS} from "../../../lib/indicators";
import {IndicatorHistory} from "./history";
export const dynamic="force-dynamic";
export const metadata={title:"나의 보조지표 · Positionary"};
export default async function IndicatorsPage({searchParams}:{searchParams:Promise<{ticker?:string;saved?:string}>}){
 const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const rules=await fetchIndicatorRules(session.user.id).catch(()=>null);
 const candidate=(params.ticker??"").trim().toUpperCase();
 const ticker=/^[A-Z0-9.:-]{1,32}$/.test(candidate)?candidate:null;
 return <main className="journal-page"><div className="page-intro">
   <p><a href="/private/journal">← 투자 일지</a></p><h1>나의 보조지표</h1>
   <p>내가 보는 지표와 기준을 등록하고 매매 당시 값을 직접 남깁니다. 지표 값은 자동 수집하지 않습니다.</p>
   <div className="principles-actions"><a className="btn btn-primary" href="/private/indicators/edit">+ 지표 등록</a>
     <a className="btn btn-outline" href={`/private/indicators/record${ticker?`?ticker=${encodeURIComponent(ticker)}`:""}`}>당시 값 기록</a></div>
 </div>
 {params.saved&&<p role="status">{params.saved==="rule"?"지표 기준을 저장했습니다. 과거 매매 기준은 그대로 보존됩니다.":"당시 지표 값과 기준을 저장했습니다."}</p>}
 <section className="user-panel"><h2>등록한 지표와 기준</h2>
 {rules===null?<p role="alert">지표 기준을 불러올 수 없습니다.</p>:rules.length===0?<p>RSI 등의 지표를 시간봉별로 등록해 보세요. 매수·매도 기준은 직접 정합니다.</p>:
 <div className="indicator-rule-list">{rules.map(r=><article className="indicator-card" key={r.ruleId}>
   <h3>{r.name} {r.parameters} · {r.timeframe}</h3>
   <p>{SIDE_LABELS[r.side]} · {STAGE_LABELS[r.stage]} · {r.active?"사용 중":"사용 중지"}</p>
   <p>나의 기준: {indicatorCriterion(r)}</p>
   {r.operator!=="MANUAL"&&r.condition&&<p>{r.condition}</p>}
   <a href={`/private/indicators/edit?ruleId=${r.ruleId}`}>기준 수정 / 사용 설정 →</a>
 </article>)}</div>}
 </section>
 <form method="get" className="indicator-filter"><label>종목별 기록 찾기 <input name="ticker" defaultValue={ticker??""} maxLength={32} placeholder="예: TSLA" style={{textTransform:"uppercase"}}/></label><button type="submit" className="btn btn-outline">조회</button>{ticker&&<a href="/private/indicators">전체 기록</a>}</form>
 <IndicatorHistory subject={session.user.id} filter={{ticker,tradeEventId:null,journalId:null}}/>
 </main>;
}
