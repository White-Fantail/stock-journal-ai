import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchInvestorPrinciples,fetchJournalPlans} from "../../../lib/saas-trades-api";
export const dynamic="force-dynamic";
export const metadata={title:"투자 기록 시작하기 · Positionary"};
export default async function GettingStarted({searchParams}:{
 searchParams:Promise<{saved?:string}>
}){
 const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
 if(!session?.user?.id||!workspace)redirect("/login");
 const result=await Promise.allSettled([
   fetchInvestorPrinciples(session.user.id),fetchJournalPlans(session.user.id),
 ]);
 const principleOk=result[0].status==="fulfilled";
 const p=result[0].status==="fulfilled"?result[0].value:null;
 const plans=result[1].status==="fulfilled"?result[1].value:null;
 const hasPlan=plans!==null&&plans.length>0;
 return <main className="journal-page">
   <div className="page-intro">
     <span className="breadcrumb"><Link href="/private">← 내 투자 홈</Link></span>
     <h1>내 방식으로 투자 기록 시작하기</h1>
     <p>세 단계를 차례로 진행하거나 필요한 부분만 선택하세요.
       증권사 연결 없이 시작할 수 있고 언제든 수정할 수 있습니다.</p>
   </div>
   {params.saved==="1"&&<p role="status">나의 투자 원칙을 저장했습니다. 다음으로 종목 계획을 작성할 수 있습니다.</p>}
   <div className="getting-started-steps">
     <section className="user-panel">
       <span className="breadcrumb">1단계 · 투자 원칙</span>
       <h2>왜 투자하나요?</h2>
       <p>투자 기간과 목표, 내가 정한 위험 기준을 선택적으로 기록하세요.</p>
       {!principleOk&&<p role="alert">저장 상태를 확인할 수 없습니다. 다시 확인한 후 진행하세요.</p>}
       {principleOk&&<p className="user-footnote">{p?"원칙이 저장돼 있습니다. 필요하면 수정하세요.":"아직 작성한 원칙이 없습니다."}</p>}
       <Link className="btn btn-primary" href="/private/principles?origin=setup">{p?"원칙 확인·수정":"원칙 작성하기"} →</Link>
     </section>
     <section className="user-panel">
       <span className="breadcrumb">2단계 · 첫 종목 계획</span>
       <h2>왜 이 종목에 관심이 있나요?</h2>
       <p>매매하지 않았더라도 종목별 투자 이유와 언제 다시 검토할지 기록해 보세요.</p>
       {plans===null?<p role="alert">투자 계획을 확인하지 못했습니다. 기존 기록을 먼저 확인하세요.</p>:
         <p className="user-footnote">{hasPlan?"이미 작성한 종목 계획이 있습니다.":"아직 작성한 종목 계획이 없습니다."}</p>}
       <Link className="btn btn-outline" href={hasPlan?"/private/journal":"/private/journal/new?mode=plan"}>
         {hasPlan?"내 계획 확인":"첫 종목 계획 작성"} →
       </Link>
     </section>
     <section className="user-panel">
       <span className="breadcrumb">3단계 · 기록하고 점검하기</span>
       <h2>나의 판단을 이어서 관리하세요</h2>
       <p>투자일지를 남기고 내가 정한 주기에 맞춰 투자 원칙을 돌아보세요.
         Tiger 연동은 선택사항이며 공식 승인이 필요한 사용자에게는 별도로 안내합니다.</p>
       <div className="principles-actions">
         <Link href="/private" className="btn btn-primary">내 투자 홈으로 →</Link>
         <Link href="/private/brokers" className="btn btn-outline">증권사 연결 상태 →</Link>
       </div>
     </section>
   </div>
   <p className="user-footnote"><Link href="/private">지금은 건너뛰고 홈으로 이동 →</Link>
     {" "}기존 기록을 지우거나 예시 거래를 추가하지 않습니다.</p>
 </main>;
}
