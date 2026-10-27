import Link from "next/link";
import {randomUUID} from "node:crypto";
import {redirect} from "next/navigation";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchInvestorPrinciples,submitInvestorPrinciples} from "../../../lib/saas-trades-api";
export const dynamic="force-dynamic";
export const metadata={title:"나의 투자 원칙 · Positionary"};
const read=(f:FormData,k:string)=>{const value=f.get(k);return typeof value==="string"?value.trim():"";};
const nullable=(f:FormData,k:string)=>read(f,k)||null;
async function save(form:FormData){
  "use server";
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  if(!workspace||!session?.user?.id)redirect("/login");
  const payload={
    idempotencyKey:read(form,"idempotencyKey"),
    objective:nullable(form,"objective"),horizon:nullable(form,"horizon"),
    baseCurrency:nullable(form,"baseCurrency")?.toUpperCase()??null,
    maxSinglePct:nullable(form,"maxSinglePct"),riskLimitPct:nullable(form,"riskLimitPct"),
    reviewCadence:nullable(form,"reviewCadence"),note:nullable(form,"note"),
  };
  const back=read(form,"origin")==="setup"
    ? "/private/getting-started" : "/private/principles";
  if(Object.entries(payload).filter(([k])=>k!=="idempotencyKey").every(([,v])=>v===null))
    redirect("/private/principles?error=empty");
  try{await submitInvestorPrinciples(session.user.id,payload);}
  catch{redirect("/private/principles?error=save");}
  redirect(back+"?saved=1");
}
export default async function PrinciplesPage({searchParams}:{
  searchParams:Promise<{saved?:string;error?:string;origin?:string}>;
}){
  const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
  if(!workspace||!session?.user?.id)redirect("/login");
  const result=await fetchInvestorPrinciples(session.user.id)
    .then(x=>({ok:true as const,value:x})).catch(()=>({ok:false as const,value:null}));
  const p=result.value;
  return <main className="journal-page principles-page">
    <div className="page-intro">
      <span className="breadcrumb"><Link href="/private">← 내 투자 홈</Link></span>
      <h1>나의 투자 원칙</h1>
      <p>다른 사람의 투자 방법이 아닌 내가 지키고 싶은 기준을 기록합니다. 증권사 연결이나 실제 거래가 없어도 작성할 수 있습니다.</p>
    </div>
    {!result.ok?<section className="state-panel" role="alert">
      <h2>저장된 원칙을 확인할 수 없습니다</h2>
      <p>기존 기록이 있는지 확인하지 못했습니다. 이전 내용을 덮어쓰지 않도록 지금은 작성 기능을 표시하지 않습니다.</p>
      <Link className="btn btn-outline" href="/private/principles">다시 확인</Link>
    </section>:<>
      {params.saved==="1"&&<p role="status">내 투자 원칙을 저장했습니다. 이전 원칙도 변경 이력으로 보존됩니다.</p>}
      {params.error&&<p role="alert">입력값 또는 저장 상태를 확인할 수 없습니다. 작성 내용을 확인한 후 다시 시도해 주세요.</p>}
      <section className="user-panel">
        <h2>{p?"현재 원칙 점검·수정":"첫 투자 원칙 작성"}</h2>
        <p className="user-footnote">입력은 모두 선택 사항입니다. 목표나 위험 한도는 투자 자문이나 자동 손절 주문이 아니라 스스로 적은 기준입니다. 가격 감시도 하지 않습니다.</p>
        <form className="journal-compose-form" action={save}>
          <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
          <input type="hidden" name="origin" value={params.origin==="setup"?"setup":"manage"}/>
          <div className="journal-form-two">
            <label>가장 중요한 투자 목적
              <select name="objective" defaultValue={p?.objective??""}>
                <option value="">아직 정하지 않았어요</option>
                <option value="GROWTH">장기 자산 성장</option>
                <option value="INCOME">꾸준한 현금흐름</option>
                <option value="PRESERVATION">원금 변동을 줄이는 데 중점</option>
                <option value="LEARNING">투자 경험과 학습</option>
                <option value="OTHER">기타</option>
              </select>
            </label>
            <label>생각하는 투자 기간
              <select name="horizon" defaultValue={p?.horizon??""}>
                <option value="">미정</option>
                <option value="UNDER_3_YEARS">3년 미만</option>
                <option value="THREE_TO_TEN_YEARS">3~10년</option>
                <option value="OVER_TEN_YEARS">10년 이상</option>
                <option value="UNDECIDED">기한 없이 수시로 검토</option>
              </select>
            </label>
          </div>
          <div className="journal-form-two">
            <label>기록에 사용할 기준 통화
              <select name="baseCurrency" defaultValue={p?.baseCurrency??""}>
                <option value="">미정</option><option value="NZD">NZD</option>
                <option value="USD">USD</option><option value="AUD">AUD</option>
                <option value="KRW">KRW</option><option value="EUR">EUR</option>
              </select>
            </label>
            <label>내 투자 원칙을 점검할 주기
              <select name="reviewCadence" defaultValue={p?.reviewCadence??""}>
                <option value="">미정</option>
                <option value="MONTHLY">매월</option>
                <option value="QUARTERLY">분기마다</option>
                <option value="SEMIANNUAL">6개월마다</option>
                <option value="ANNUAL">매년</option>
              </select>
            </label>
          </div>
          <details className="data-disclosure">
            <summary>나의 위험 한도 생각해 보기 (선택)</summary>
            <div className="journal-form-two">
              <label>단일 종목 최대 보유 비중 (%)<input name="maxSinglePct" inputMode="decimal"
                type="text" pattern="(?:[0-9]{1,3}(?:[.][0-9]{1,2})?)"
                defaultValue={p?.maxSinglePct??""} placeholder="예: 15"/></label>
              <label>스스로 감당할 수 있다고 생각하는 손실 범위 (%)<input name="riskLimitPct" inputMode="decimal"
                type="text" pattern="(?:[0-9]{1,3}(?:[.][0-9]{1,2})?)"
                defaultValue={p?.riskLimitPct??""} placeholder="예: 10"/></label>
            </div>
            <p>내가 정한 목표치일 뿐 실제 투자 위험이나 손실 상한을 보장하지 않습니다.
              이 기준을 불완전한 증권사 계좌 평가액과 비교해 준수 여부를 자동 판정하지 않습니다.</p>
          </details>
          <label>내가 지키고 싶은 원칙
            <textarea name="note" rows={4} maxLength={1500}
              defaultValue={p?.note??""}
              placeholder="예: 큰 가격 변동이 있어도 계획을 검토한 다음 판단한다. 분기마다 투자 논리를 확인한다."/>
          </label>
          <div className="principles-actions">
            <button className="btn btn-primary" type="submit">나의 원칙 저장</button>
            <Link href="/private/getting-started">첫 시작 가이드 →</Link>
            <Link href="/private/journal/new?mode=plan">종목별 계획 작성 →</Link>
          </div>
        </form>
        {p&&<p className="user-footnote">마지막 작성: {new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",
          dateStyle:"medium",timeStyle:"short"}).format(new Date(p.createdAt))}
          {" · "}개인 작성 내용으로, 증권사 확인 기록과 별도입니다.</p>}
      </section>
    </>}
  </main>;
}
