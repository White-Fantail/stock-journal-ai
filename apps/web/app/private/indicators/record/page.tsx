import {randomUUID} from "node:crypto";
import {redirect,notFound} from "next/navigation";
import {auth} from "../../../../auth";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {fetchIndicatorRules,fetchTradeDetail,fetchJournal} from "../../../../lib/saas-trades-api";
import {RecordForm} from "./record-form";
export const dynamic="force-dynamic";
export const metadata={title:"매매 당시 보조지표 기록 · Positionary"};
export default async function IndicatorRecordPage({searchParams}:{searchParams:Promise<{
 ticker?:string;tradeEventId?:string;journalId?:string;savedTrade?:string;savedJournal?:string;
}>}){
 const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
 if(!workspace||!session?.user?.id)redirect("/login");
 let ticker=/^[A-Z0-9.:-]{1,32}$/.test(params.ticker??"")?params.ticker!:"";
 let side:"BUY"|"SELL"="BUY",observedAt="";
 const tradeEventId=params.tradeEventId??"",journalId=params.journalId??"";
 if(tradeEventId&&journalId)notFound();
 if(tradeEventId){
   const trade=await fetchTradeDetail(session.user.id,tradeEventId).catch(()=>null);
   if(!trade||trade.kind!=="EXECUTION"||!trade.ticker||!trade.side)notFound();
   ticker=trade.ticker;side=trade.side;observedAt=trade.executedAt??"";
 }
 if(journalId){
   const entries=await fetchJournal(session.user.id).catch(()=>null);
   const entry=entries?.find(e=>e.id===journalId);
   if(!entry)notFound();
   ticker=entry.ticker;
 }
 const rules=await fetchIndicatorRules(session.user.id).catch(()=>null);
 return <main className="journal-page"><p><a href="/private/indicators">← 나의 보조지표</a></p>
   <h1>매매 당시 보조지표 기록</h1>
   <p>주봉·일봉의 검토 조건과 분봉의 시점 판단을 직접 기록합니다.</p>
   {(params.savedTrade||params.savedJournal)&&<p role="status">매매·일지 기록은 저장되었습니다. 보조지표 기록은 선택 사항입니다.</p>}
   {(tradeEventId||journalId)&&<p>연결된 기록: {ticker} · {tradeEventId?"직접 입력 거래":"투자 일지"}</p>}
   {rules===null?<p role="alert">지표 기준을 불러올 수 없습니다. 연결된 기존 매매 기록은 유지됩니다.</p>:
     <section className="user-panel"><RecordForm rules={rules} idempotencyKey={randomUUID()} ticker={ticker}
       initialSide={side} tradeEventId={tradeEventId} journalId={journalId} observedAt={observedAt}/></section>}
 </main>;
}
