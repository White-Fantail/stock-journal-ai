import {randomUUID} from "node:crypto";
import {redirect,notFound} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {fetchIndicatorRules} from "../../../../lib/saas-trades-api";
import {RuleForm} from "./rule-form";
export const dynamic="force-dynamic";
export const metadata={title:"보조지표 기준 등록 · Positionary"};
export default async function IndicatorEdit({searchParams}:{searchParams:Promise<{ruleId?:string}>}){
  const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
  if(!workspace||!session?.user?.id)redirect("/login");
  const result=await fetchIndicatorRules(session.user.id).then(r=>({rules:r,ok:true})).catch(()=>({rules:[],ok:false}));
  const rule=result.rules.find(r=>r.ruleId===params.ruleId)??null;
  if(result.ok&&params.ruleId&&!rule)notFound();
  return <main className="journal-page"><p><a href="/private/indicators">← 나의 보조지표</a></p>
    <h1>{rule?"보조지표 기준 수정":"보조지표 등록"}</h1>
    {!result.ok?<p role="alert">기존 기준을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.</p>:
      <section className="user-panel"><RuleForm rule={rule} idempotencyKey={randomUUID()}/></section>}
  </main>;
}
