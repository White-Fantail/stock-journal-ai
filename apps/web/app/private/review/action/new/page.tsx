import Link from "next/link";
import {randomUUID} from "node:crypto";
import {redirect} from "next/navigation";
import {auth} from "../../../../../auth";
import {currentWorkspace} from "../../../../../lib/require-workspace";
import {fetchReviewActions,submitReviewAction,type ReviewActionState} from "../../../../../lib/saas-trades-api";

export const dynamic="force-dynamic";
export const metadata={title:"지난 투자 행동 확인 · Positionary"};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const status=new Set<ReviewActionState>(["DONE","NOT_DONE","NOT_APPLICABLE","UNCERTAIN"]);
const v=(f:FormData,k:string)=>{const x=f.get(k);return typeof x==="string"?x.trim():"";};
async function submit(form:FormData){
 "use server";
 const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
 if(!session?.user?.id||!workspace)redirect("/login");
 const state=v(form,"state") as ReviewActionState;
 if(!uuid.test(v(form,"checkinId"))||!status.has(state)||v(form,"note").length>1000)
   redirect("/private/review?error=invalid");
 try{
  await submitReviewAction(session.user.id,{
   idempotencyKey:v(form,"idempotencyKey"),
   checkinId:v(form,"checkinId"),state,note:v(form,"note")||null,
  });
 }catch{
  redirect("/private/review/action/new?checkin="+encodeURIComponent(v(form,"checkinId"))+"&error=stale");
 }
 redirect("/private/review?saved=action");
}
export default async function ActionFollowupPage({searchParams}:{
 searchParams:Promise<{checkin?:string;error?:string}>
}){
 const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
 if(!session?.user?.id||!workspace)redirect("/login");
 const result=await fetchReviewActions(session.user.id).then(x=>({ok:true as const,items:x}))
  .catch(()=>({ok:false as const,items:[]}));
 const current=result.ok&&uuid.test(params.checkin??"")
  ?result.items.find(a=>a.checkinId===params.checkin):null;
 return <main className="journal-page journal-create-page">
  <div className="page-intro"><span className="breadcrumb"><Link href="/private/review">← 투자 점검</Link></span>
   <h1>지난 행동의 실행 여부 기록</h1>
   <p>내가 지난 투자 복기에서 정한 행동을 실제로 했는지 스스로 확인합니다.
     체크만으로 증권사 거래나 투자 원칙 준수를 검증하지 않습니다.</p></div>
  {!result.ok?<div role="alert" className="state-panel">
    <h2>기존 행동 기록을 읽을 수 없습니다</h2>
    <p>조회에 실패했습니다. 이전 상태를 모르는 채 새 기록을 작성하지 않습니다.</p>
    <Link href="/private/review">점검 센터로 돌아가기 →</Link>
  </div>:!current?<div role="alert" className="state-panel">
    <h2>선택한 행동을 확인할 수 없습니다</h2>
    <p>최근 자기평가가 변경됐거나 현재 계정의 행동이 아닙니다. 점검 센터에서 다시 선택하세요.</p>
    <Link href="/private/review">점검 센터로 돌아가기 →</Link>
  </div>:<section className="journal-compose journal-create-page">
    <h2>{current.ticker} · 지난 점검에서 약속한 행동</h2>
    <blockquote>{current.nextAction}</blockquote>
    <p className="user-footnote">작성일: {new Intl.DateTimeFormat("ko-KR",{
     timeZone:"Pacific/Auckland",dateStyle:"medium"
    }).format(new Date(current.checkinAt))} · 이전 상태: {current.state??"미확인"}</p>
    {params.error&&<p role="alert">기록을 저장하지 못했습니다. 새 자기평가가 있는지 다시 확인하세요.
     현재 상태가 바뀌었을 수 있습니다.</p>}
    <form action={submit} className="journal-compose-form">
      <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
      <input type="hidden" name="checkinId" value={current.checkinId}/>
      <label>내가 실제로 어떻게 진행했나요?
        <select name="state" required defaultValue={current.state??""}>
          <option value="" disabled>상태 선택</option>
          <option value="DONE">직접 실행했다고 확인</option>
          <option value="NOT_DONE">아직 하지 못함</option>
          <option value="NOT_APPLICABLE">지금은 해당 없음</option>
          <option value="UNCERTAIN">실행 여부 판단 유보</option>
        </select>
      </label>
      <label>그렇게 판단한 이유나 다음에 확인할 내용 (선택)
        <textarea name="note" rows={4} maxLength={1000} defaultValue={current.note??""}
          placeholder="예: 자료를 읽고 정리했다. 아직 공식 발표를 확인하지 못했다."/>
      </label>
      <p className="user-footnote">저장하면 이전 행동 상태를 지우지 않고 새 변경 이력을 남깁니다.
        AI가 판단하거나 자동으로 거래를 실행하지 않습니다.</p>
      <button className="btn btn-primary" type="submit">내 확인 결과 저장</button>
    </form>
  </section>}
 </main>;
}
