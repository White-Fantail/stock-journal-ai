import Link from "next/link";
import {randomUUID} from "node:crypto";
import {notFound,redirect} from "next/navigation";
import {auth} from "../../../../../../auth";
import {currentWorkspace} from "../../../../../../lib/require-workspace";
import {tigerPersonalRead} from "../../../../../../lib/tiger-api";
import {submitTigerObservationNote,fetchJournal} from "../../../../../../lib/saas-trades-api";
import {notesForObserved,tigerTradeHref,reasonPreview} from "../../../../../../lib/trade-reasons";

export const dynamic="force-dynamic";
const REF=/^[a-f0-9]{64}$/;
const TICKER=/^[A-Z0-9.:-]{1,32}$/;

function parse(query:{page?:string;kind?:string},ref:string){
 const page=/^(?:0|[1-9][0-9]?)$/.test(query.page??"0")&&Number(query.page??"0")<=20
   ? Number(query.page??"0"):-1;
 const kind=query.kind??"ORDER";
 if(!REF.test(ref)||page<0||(kind!=="ORDER"&&kind!=="FILL")||
   (kind==="FILL"&&page!==0))notFound();
 return {page,kind:kind as "ORDER"|"FILL"};
}

async function addReason(form:FormData){
 "use server";
 const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const get=(key:string)=>typeof form.get(key)==="string"?String(form.get(key)).trim():"";
 const ref=get("sourceRef"),pageRaw=get("page"),kind=get("kind"),ticker=get("ticker");
 const page=Number(pageRaw);
 const correctionId=get("corrects");
 let content=get("content");
 if(!REF.test(ref)||!TICKER.test(ticker)||!/^([0-9]|1[0-9]|20)$/.test(pageRaw)||
   (kind!=="ORDER"&&kind!=="FILL")||(kind==="FILL"&&page!==0)||
   !content||content.length>6000||
   (correctionId!==""&&!/^[0-9a-f-]{36}$/i.test(correctionId)))
   redirect("/private/trades?error=invalid");
 const back=tigerTradeHref(ref,page,kind as "ORDER"|"FILL");
 // Form fields can be altered independently of the displayed broker record.
 // Re-read owner-scoped evidence immediately before writing a trade reason.
 let matchingRecord=false;
 try{
   const current=await tigerPersonalRead(page);
   const matches=current?.accounts.flatMap(account=>
     (kind==="ORDER"?account.orders:account.fillObservations)
       .filter(record=>record.sourceRef===ref));
   matchingRecord=matches?.length===1 && matches[0].symbol===ticker;
 }catch{
   // Fail closed when Tiger observation evidence is unavailable.
 }
 if(!matchingRecord) redirect(back+"&error=source");
 // Recheck existing authored reasons on submission, not only at form render.
 // A failed journal read must never result in an accidental duplicate write.
 let existing;
 try { existing=await fetchJournal(session.user.id); }
 catch { redirect(back+"&error=notes-unavailable"); }
 const sameTrade=notesForObserved(existing,ref,kind as "ORDER"|"FILL");
 if(correctionId){
   const target=sameTrade.find(note=>note.id===correctionId&&note.ticker===ticker);
   if(!target)redirect(back+"&error=source");
   content="정정 ("+correctionId+"): "+content;
   if(content.length>6000)redirect(back+"&error=invalid");
 }
 if(sameTrade.some(note=>note.content.trim()===content))
   redirect(back+"&error=duplicate");
 try{
   await submitTigerObservationNote(session.user.id,{
     idempotencyKey:get("idempotencyKey"),sourceRef:ref,page,
     observationKind:kind as "ORDER"|"FILL",ticker,content,
   });
 }catch{
   redirect(back+"&error=save");
 }
 redirect(back+"&saved=1");
}

export default async function TigerReasonNew({params,searchParams}:{
 params:Promise<{sourceRef:string}>;
 searchParams:Promise<{page?:string;kind?:string;correct?:string}>;
}){
 const [workspace,session,p,q]=await Promise.all([currentWorkspace(),auth(),params,searchParams]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const {page,kind}=parse(q,p.sourceRef);
 const data=await tigerPersonalRead(page).catch(()=>null);
 if(!data)return <main className="journal-page"><p role="alert">현재 Tiger 거래 기록을 확인할 수 없어 이유를 저장할 수 없습니다.</p><Link href="/private/trades">← 거래 기록</Link></main>;
 const matches=data.accounts.flatMap(a=>(kind==="ORDER"?a.orders:a.fillObservations)
  .filter(x=>x.sourceRef===p.sourceRef).map(x=>({row:x,alias:a.alias})));
 if(matches.length!==1)notFound();
 const {row,alias}=matches[0];
 const previous=await fetchJournal(session.user.id).catch(()=>null);
 const notes=previous?notesForObserved(previous,p.sourceRef,kind):[];
 const back=tigerTradeHref(p.sourceRef,page,kind);
 const correction=notes.find(n=>n.id===q.correct&&n.ticker===row.symbol);
 return <main className="journal-page" style={{maxWidth:750,margin:"1.5rem auto",padding:"0 1rem"}}>
  <p><Link href={back}>← 거래 상세</Link></p>
  <div className="page-intro"><div><h1>{row.symbol} · {kind==="ORDER"?"주문":"체결"} 이유 추가</h1>
    <p>매매 이유는 이 거래에만 연결합니다. 투자일지에는 동일 내용을 다시 저장하지 않습니다.</p>
    {correction&&<p>기존 기록을 삭제하거나 덮어쓰지 않고 정정 내용을 새 기록으로 남깁니다.</p>}</div></div>
  <section className="state-panel">
   <p><strong>{row.symbol} · {row.side==="BUY"?"매수":"매도"}</strong> · {alias}
     {" · "}{kind==="ORDER"?("status" in row?row.status:""):"개별 체결 관측"}</p>
   {previous===null?<p role="alert">기존 메모를 확인할 수 없어 중복 작성을 방지하기 위해 저장 양식을 표시하지 않습니다.</p>:
    <>
     {notes.length>0&&<details className="data-disclosure">
       <summary>이미 연결된 매매 이유 {notes.length}건 확인</summary>
       {notes.map(n=><p key={n.id} style={{whiteSpace:"pre-wrap"}}>{reasonPreview([n],220)}{" · "}<Link href={back.replace("?","/note?")+"&correct="+encodeURIComponent(n.id)}>정정하기</Link></p>)}
     </details>}
     <form action={addReason} className="journal-compose-form">
      <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
      {correction&&<input type="hidden" name="corrects" value={correction.id}/>}
      <input type="hidden" name="sourceRef" value={p.sourceRef}/>
      <input type="hidden" name="kind" value={kind}/>
      <input type="hidden" name="page" value={page}/>
      <input type="hidden" name="ticker" value={row.symbol}/>
      <label>{kind==="ORDER"&&"filled" in row&&row.filled==="0"?"주문 목적 · 미체결 판단":"매매 이유 · 실행 복기"}
        <textarea required name="content" rows={8} maxLength={6000}
          defaultValue={correction?.content??""}
          placeholder="왜 이 주문을 냈나요? 당초 계획과 실제 결과, 위험 관리 판단을 기록하세요."/>
      </label>
      <p className="journal-form-hint">새 메모만 추가하고 이전 기록은 보존합니다. 원본 계좌·주문 식별자는 서버에서 다시 확인합니다. 실제 증권사 주문을 실행하지 않습니다.</p>
      <button type="submit" className="btn btn-primary journal-save">{correction?"정정 기록 저장":"이 거래에 이유 저장"}</button>
     </form>
    </>}
  </section>
 </main>;
}
