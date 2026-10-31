import Link from "next/link";
import {randomUUID} from "node:crypto";
import {redirect} from "next/navigation";
import {auth} from "../../../../../auth";
import {currentWorkspace} from "../../../../../lib/require-workspace";
import {fetchPlanCheckinContext,submitPlanCheckin,type PlanSelfAssessment} from "../../../../../lib/saas-trades-api";

export const dynamic="force-dynamic";
export const metadata={title:"투자 원칙 자기평가 · Positionary"};
const TICKER=/^[A-Z0-9.:-]{1,32}$/;
const CHOICES=new Set<PlanSelfAssessment>(["FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"]);
const val=(f:FormData,k:string)=>{const v=f.get(k);return typeof v==="string"?v.trim():"";};

async function submit(form:FormData){
  "use server";
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  if(!workspace||!session?.user?.id)redirect("/login");
  const ticker=val(form,"ticker").toUpperCase();
  if(!TICKER.test(ticker))redirect("/private/journal");
  const status=val(form,"selfAssessment") as PlanSelfAssessment;
  if(!CHOICES.has(status)){
    redirect("/private/journal/review/new?ticker="+encodeURIComponent(ticker)+"&error=invalid");
  }
  try{
    await submitPlanCheckin(session.user.id,{
      idempotencyKey:val(form,"idempotencyKey"),
      ticker,expectedPlanRevisionId:val(form,"expectedPlanRevisionId"),
      selfAssessment:status,content:val(form,"content"),
      nextAction:val(form,"nextAction"),
    });
  }catch{
    // Includes a plan changed since render: don't attach review to newer plan.
    redirect("/private/journal/review/new?ticker="+encodeURIComponent(ticker)+"&error=stale");
  }
  redirect("/private/journal?ticker="+encodeURIComponent(ticker)+"&saved=checkin");
}

const judgement:Record<PlanSelfAssessment,string>={
  FOLLOWED:"원칙을 지켰음",PARTIAL:"일부만 지켰음",
  DEVIATED:"원칙에서 벗어남",UNCERTAIN:"판단 유보 · 근거 부족",
};
function stamp(s:string){
 const d=new Date(s);
 return new Intl.DateTimeFormat("ko-KR",{
   dateStyle:"medium",timeStyle:"short",timeZone:"Pacific/Auckland",
 }).format(d);
}
export default async function PlanCheckinPage({searchParams}:{
  searchParams:Promise<{ticker?:string;error?:string}>
}){
 const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const ticker=(params.ticker??"").toUpperCase();
 const valid=TICKER.test(ticker);
 const context=valid?await fetchPlanCheckinContext(session.user.id,ticker).catch(()=>null):null;
 const plan=context?.currentPlan??null;
 return <main className="journal-page">
  <div className="page-intro journal-page-heading">
    <div><span className="breadcrumb"><Link href="/private/journal">← 투자일지</Link></span>
      <h1>투자 원칙 자기평가</h1>
      <p>당시의 투자계획과 지금의 판단을 비교해 기록합니다. 사용자가 평가한 결과이며
        증권사 체결이나 수익률을 근거로 자동 채점하지 않습니다.</p>
      {valid&&<p><Link href={"/private/trades"}>거래 기록에서 당시 매매 이유 확인 →</Link></p>}
    </div>
  </div>
  {!valid?<section className="state-panel">
    <h2>복기할 종목을 선택하세요.</h2>
    <p>투자일지에서 종목을 선택한 뒤 원칙 자기평가를 시작할 수 있습니다.</p>
    <Link className="btn btn-primary" href="/private/journal">종목 선택 →</Link>
  </section>:!context?<section className="state-panel" role="alert">
    <h2>현재 투자 계획을 확인할 수 없습니다.</h2>
    <p>데이터 조회에 실패했습니다. 미확인 계획에 대한 자기평가를 저장하지 않습니다.</p>
    <Link href={"/private/journal?ticker="+encodeURIComponent(ticker)}>종목 기록 확인 →</Link>
  </section>:!plan?<section className="state-panel">
    <h2>{ticker}의 투자 계획이 아직 없습니다.</h2>
    <p>원칙을 평가하려면 먼저 현재 투자 논리와 계획을 작성해야 합니다.</p>
    <Link className="btn btn-primary" href={"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker)}>
      투자 계획 작성 →
    </Link>
  </section>:<>
    {params.error&&<p role="alert">저장하지 못했습니다. 입력을 확인하거나 투자계획이 변경됐는지 확인하세요.
      저장 여부가 불분명하면 아래 최근 자기평가부터 확인하세요.</p>}
    <section className="user-panel">
      <h2>{ticker} · 평가 대상 투자계획</h2>
      <p><strong>계획 작성:</strong> {stamp(plan.createdAt)} · <strong>전략:</strong> {plan.strategyType??"미설정"} ·
        <strong>점검 주기:</strong> {plan.reviewCadence??"미설정"}</p>
      <p><strong>계획 당시 판단:</strong> {plan.rationale}</p>
      {plan.invalidationCondition&&<p><strong>논리 무효화 조건:</strong> {plan.invalidationCondition}</p>}
      <p className="user-footnote">이번 평가는 이 계획 버전에 고정하여 보존됩니다.
        이후 계획을 변경해도 과거 평가가 새 계획으로 바뀌지 않습니다.</p>
    </section>
    <section className="journal-compose journal-create-page">
      <form action={submit} className="journal-compose-form">
        <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
        <input type="hidden" name="ticker" value={ticker}/>
        <input type="hidden" name="expectedPlanRevisionId" value={plan.id}/>
        <label>내가 세운 투자 원칙을 얼마나 지켰나요?
          <select name="selfAssessment" required defaultValue="">
            <option value="" disabled>자기평가 선택</option>
            {Object.entries(judgement).map(([key,text])=>
              <option key={key} value={key}>{text}</option>)}
          </select>
        </label>
        <label>이번에 확인한 사실과 판단 근거
          <textarea name="content" required minLength={1} maxLength={6000} rows={6}
            placeholder="처음 계획과 실제 판단을 비교해 기록하세요. 원칙을 지켰다는 근거가 없다면 판단 유보를 선택할 수 있습니다."/>
        </label>
        <label>다음 점검까지의 구체적인 행동
          <textarea name="nextAction" required minLength={1} maxLength={1500} rows={3}
            placeholder="다음에는 어떤 자료를 확인하고 어떤 기준을 다시 살펴볼까요?"/>
        </label>
        <p className="journal-form-hint">복기는 투자일지의 REVIEW 기록에도 함께 남습니다.
          매수·매도 지시나 가격 알림을 생성하지 않습니다. 자기평가를 객관적인 준수율로 해석하지 않습니다.</p>
        <button type="submit" className="btn btn-primary journal-save">원칙 자기평가 저장</button>
      </form>
    </section>
    <section className="user-panel">
      <h2>최근 내 자기평가 기록</h2>
      {context.recent.length===0?<p>아직 구조화된 자기평가가 없습니다.
        기존의 일반 복기 메모는 원칙 준수 여부를 자동 판단하지 않습니다.</p>:
        <div className="user-list">{context.recent.map(item=>
          <div key={item.id} className="user-list-row">
            <div><strong>{judgement[item.selfAssessment]}</strong>
              <small>{stamp(item.createdAt)} · {item.planRevisionId===plan.id?"현 계획":"이전 계획"} 기준 · 계획 개정 ID {item.planRevisionId.slice(0,8)}</small>
              {item.planRevisionId!==plan.id&&<p className="user-footnote">현재 계획과 다른 개정 버전에 연결된 평가입니다. <Link href={"/private/journal?ticker="+encodeURIComponent(ticker)}>종목별 계획 변경 이력 확인 →</Link></p>}
              <p>{item.content}</p>
              <small>다음 행동: {item.nextAction}</small>
            </div>
          </div>)}</div>}
      {context.recent.length===10&&<p className="journal-limit">최신 10건만 표시합니다.
        전체 기간의 자기평가 건수는 월간 복기 보고서에서 확인하세요.</p>}
    </section>
  </>}
 </main>;
}
