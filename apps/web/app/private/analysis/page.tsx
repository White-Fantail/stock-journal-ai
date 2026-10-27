import Link from "next/link";
import {redirect} from "next/navigation";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchJournal,fetchJournalPlans,fetchManualTrades} from "../../../lib/saas-trades-api";
import {tigerPersonalRead} from "../../../lib/tiger-api";
import {aiConfigured} from "../../../lib/ai-configuration";
import {AnalysisPanel} from "./analysis-panel";

export const dynamic="force-dynamic";
export const metadata={title:"AI 투자 복기 · Positionary"};

export default async function AnalysisPage({searchParams}:{searchParams:Promise<{mode?:string}>}){
  const [workspace,session,params]=await Promise.all([currentWorkspace(),auth(),searchParams]);
  if(!workspace||!session?.user?.id)redirect("/login");
  const id=session.user.id;
  const data=await Promise.allSettled([
    fetchJournal(id),fetchJournalPlans(id),fetchManualTrades(id),tigerPersonalRead(),
  ]);
  const symbols=new Set<string>();
  if(data[0].status==="fulfilled")for(const n of data[0].value)symbols.add(n.ticker);
  if(data[1].status==="fulfilled")for(const p of data[1].value)symbols.add(p.ticker);
  if(data[2].status==="fulfilled")for(const e of data[2].value.events)
    if(e.kind==="EXECUTION"&&e.ticker)symbols.add(e.ticker);
  if(data[3].status==="fulfilled")for(const a of data[3].value?.accounts??[]){
    for(const p of a.positions)symbols.add(p.symbol);
    for(const o of a.orders)symbols.add(o.symbol);
  }
  const safe=[...symbols].filter(x=>/^[A-Z0-9.:-]{1,32}$/.test(x)).sort().slice(0,150);
  return <main style={{maxWidth:860,margin:"2rem auto",padding:"0 1rem"}}>
    <div className="page-intro">
      <span className="breadcrumb"><Link href="/private/journal">← 투자 일지</Link></span>
      <h1>AI 투자 복기</h1>
      <p>어떤 판단을 했는지, 지난 점검의 다음 행동을 다시 확인했는지, 반복되는 습관은 무엇인지 돌아봅니다.</p>
    </div>
    <AnalysisPanel available={aiConfigured()} symbols={safe}
      initialMode={params.mode==="COACHING"?"COACHING":"STOCK_REVIEW"}/>
  </main>;
}
