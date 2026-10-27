import Link from "next/link";
import {randomUUID} from "node:crypto";
import {redirect} from "next/navigation";
import {auth} from "../../../../../auth";
import {currentWorkspace} from "../../../../../lib/require-workspace";
import {fetchUserRiskFactors,RISK_FACTOR_LABELS,submitRiskFactors,
  type UserRiskFactor} from "../../../../../lib/saas-trades-api";

export const dynamic="force-dynamic";
export const metadata={title:"종목 위험군 분류 · Positionary"};
const SYMBOL=/^[A-Z0-9.:-]{1,32}$/;

async function save(form:FormData){
 "use server";
 const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const ticker=String(form.get("ticker")??"").trim().toUpperCase();
 if(!SYMBOL.test(ticker))redirect("/private/portfolio");
 const factors=form.getAll("factors").filter((f):f is string=>typeof f==="string") as UserRiskFactor[];
 const reason=String(form.get("rationale")??"").trim();
 const key=String(form.get("idempotencyKey")??"");
 try{
  await submitRiskFactors(session.user.id,{ticker,factors,rationale:reason,idempotencyKey:key});
 }catch{
  redirect("/private/portfolio/risk-groups/edit?ticker="+encodeURIComponent(ticker)+"&error=save");
 }
 redirect("/private/portfolio?riskGroups=saved");
}

export default async function RiskGroupEdit({searchParams}:{
 searchParams:Promise<{ticker?:string;error?:string}>
}){
 const [params,session,workspace]=await Promise.all([searchParams,auth(),currentWorkspace()]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const ticker=(params.ticker??"").toUpperCase();
 const valid=SYMBOL.test(ticker);
 const entries=valid?await fetchUserRiskFactors(session.user.id).catch(()=>null):null;
 const current=entries?.find(x=>x.ticker===ticker);
 return <main className="journal-page">
  <div className="page-intro journal-page-heading">
   <div><span className="breadcrumb"><Link href="/private/portfolio">← 포트폴리오</Link></span>
    <h1>종목 위험 요인 직접 분류</h1>
    <p>같은 위험에 여러 종목이 노출됐는지 살펴보기 위한 사용자 분류입니다.
       실제 종목의 업종·상관관계나 미래 하락 확률을 검증한 정보가 아닙니다.</p>
   </div>
  </div>
  {!valid?<section className="state-panel">
    <p>분류할 종목을 포트폴리오에서 선택하세요.</p>
    <Link href="/private/portfolio">종목 선택 →</Link>
  </section>:!entries?<section className="state-panel" role="alert">
    <p>기존 위험군 분류를 읽지 못했습니다. 이력을 확인하기 전에는 새 분류를 저장하지 않습니다.</p>
  </section>:<>
    <section className="user-panel">
     <h2>{ticker} · 내 위험 분류</h2>
     {params.error&&<p role="alert">저장 결과를 확인하지 못했습니다.
       아래에서 변경 이력을 다시 확인한 후 재입력하세요.</p>}
     <p>종목 하나에 위험 요인 최대 3개를 지정할 수 있습니다. 요인을 하나도
       선택하지 않으면 ‘미분류’로 기록합니다.</p>
     <form action={save} className="journal-compose-form">
       <input type="hidden" name="ticker" value={ticker}/>
       <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
       <fieldset><legend>내가 생각하는 공통 위험 요인 (최대 3개)</legend>
         <div className="risk-factor-options">
           {(Object.entries(RISK_FACTOR_LABELS) as [UserRiskFactor,string][]).map(([key,label])=>
             <label key={key} className="risk-factor-option">
               <input type="checkbox" name="factors" value={key}
                 defaultChecked={current?.factors.includes(key)??false}/>
               <span>{label}</span>
             </label>)}
         </div>
       </fieldset>
       <label>이 위험군으로 분류한 근거
         <textarea required name="rationale" maxLength={1500} rows={4}
           defaultValue={current?.rationale??""}
           placeholder="이 종목이 여러 위험 요인에 동시에 영향을 받을 것이라고 판단한 이유를 직접 기록하세요."/>
       </label>
       <p className="journal-limit">변경 전 분류는 지우지 않고 새 버전으로 보존합니다.
         요인별 비중은 서로 겹치므로 합산하지 않습니다. 자동 매매나 주가 감시는 하지 않습니다.</p>
       <button className="btn btn-primary" type="submit">위험 요인 분류 저장</button>
     </form>
    </section>
    <section className="user-panel">
      <h2>현재 기록</h2>
      {current?<p>작성일 {new Intl.DateTimeFormat("ko-KR",{
        dateStyle:"medium",timeZone:"Pacific/Auckland",
      }).format(new Date(current.createdAt))} · {current.factors.map(k=>RISK_FACTOR_LABELS[k]).join(", ")||"미분류"}</p>:
      <p>아직 내 위험군 분류 기록이 없습니다.</p>}
    </section>
  </>}
 </main>;
}
