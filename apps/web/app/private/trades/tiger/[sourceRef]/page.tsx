import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {auth} from "../../../../../auth";
import {currentWorkspace} from "../../../../../lib/require-workspace";
import {tigerPersonalRead} from "../../../../../lib/tiger-api";
import {fetchJournal,fetchJournalPlans} from "../../../../../lib/saas-trades-api";
import {planAtAuthoredTime} from "../../../../../lib/plan-revision-context";
import {formatMoney,formatQuantity} from "../../../../../lib/format-decimal";
import {groupTigerOrderObservations} from "../../../../../lib/tiger-order-groups";
import {orderStatusLabel,orderTypeLabel,orderTerms,executionPriceIsKnown,feeIsKnown} from "../../../../../lib/tiger-order-display";
import {notesForObserved,tigerTradeHref,latestObservedReasons,correctionOf} from "../../../../../lib/trade-reasons";
import {parseStatementFeeEvidence,resolvedFeeCurrency} from "../../../../../lib/tiger-fee-statement";

export const dynamic="force-dynamic";
const REF=/^[a-f0-9]{64}$/;
function readQuery(query:{page?:string;kind?:string}){
 const page=/^(?:0|[1-9][0-9]?)$/.test(query.page??"0")&&Number(query.page??"0")<=20
   ? Number(query.page??"0"):-1;
 const kind=query.kind??"ORDER";
 if(page<0||(kind!=="ORDER"&&kind!=="FILL")||(kind==="FILL"&&page!==0))notFound();
 return {page,kind};
}
function nzTime(value:string|null){
 if(!value)return "시각 확인 필요";
 const number=Number(value);
 if(!Number.isFinite(number))return "시각 확인 필요";
 return new Intl.DateTimeFormat("ko-KR",{dateStyle:"medium",timeStyle:"short",
  timeZone:"Pacific/Auckland"}).format(new Date(number));
}
export default async function TigerTradeDetail({params,searchParams}:{
 params:Promise<{sourceRef:string}>;
 searchParams:Promise<{page?:string;kind?:string;saved?:string;error?:string}>;
}){
 const [workspace,session,p,q]=await Promise.all([currentWorkspace(),auth(),params,searchParams]);
 if(!workspace||!session?.user?.id)redirect("/login");
 if(!REF.test(p.sourceRef))notFound();
 const {page,kind}=readQuery(q);
 const data=await tigerPersonalRead(page).catch(()=>null);
 if(!data) return <main className="journal-page"><p role="alert">Tiger 주문 기록을 지금 조회할 수 없습니다. 저장된 매매 이유는 삭제되지 않았습니다.</p>
   <Link href="/private/trades">← 거래 기록</Link></main>;
 const matches=data.accounts.flatMap(a=>(kind==="ORDER"?a.orders:a.fillObservations)
   .filter(o=>o.sourceRef===p.sourceRef).map(o=>({o,account:a})));
 if(matches.length!==1)notFound();
 const {o,account}=matches[0];
 const recordKind=kind as "ORDER"|"FILL";
 const [notesResult,plansResult]=await Promise.allSettled([fetchJournal(session.user.id),fetchJournalPlans(session.user.id)]);
 const plans=plansResult.status==="fulfilled"&&plansResult.value.length<200?plansResult.value:null;
 const notesAvailable=notesResult.status==="fulfilled";
 const notes=notesAvailable?notesForObserved(notesResult.value,p.sourceRef,recordKind):[];
 const activeReasons=latestObservedReasons(notes);
 const isOrder=recordKind==="ORDER";
 const order=isOrder?account.orders.find(o=>o.sourceRef===p.sourceRef):null;
 const fill=!isOrder?account.fillObservations.find(f=>f.sourceRef===p.sourceRef):null;
 const grouped=order?groupTigerOrderObservations([order],account.fillObservations).orders[0]:null;
 // Match the list's strictly scoped fee-currency evidence. Never infer a
 // fee currency from the stock or account currency alone.
 const proof=data.accounts.length===1
   ?parseStatementFeeEvidence(process.env.POSITIONARY_PERSONAL_FEE_STATEMENT_EVIDENCE)
   :null;
 const feeView=order?resolvedFeeCurrency(order,account.alias,account.assets?.currency??null,proof):null;
 const href=tigerTradeHref(p.sourceRef,page,recordKind);
 const direction=o.side==="BUY"?"매수":"매도";
 const heading=isOrder?(order?.filled==="0"?"주문 목적 · 매매 판단":"매매 이유 · 실행 복기"):"개별 체결 메모";
 const noteLink="/private/trades/tiger/"+p.sourceRef+"/note?page="+page+"&kind="+recordKind;
 return <main className="journal-page" style={{maxWidth:850,margin:"1.5rem auto",padding:"0 1rem"}}>
  <p><Link href={"/private/trades?page="+page}>← Tiger 거래 기록</Link></p>
  <div className="page-intro">
    <div><h1>{o.symbol} · {direction} {isOrder?"주문":"개별 체결"}</h1>
      <p>증권사 관측 정보와 직접 작성한 매매 이유를 한곳에서 관리합니다.</p></div>
    <Link className="btn btn-primary" href={noteLink}>+ {isOrder&&order?.filled==="0"?"주문 목적":"매매 이유"} 추가</Link>
  </div>
  {q.saved==="1"&&<p role="status">이 거래에 매매 이유를 연결했습니다. 기존 기록은 그대로 유지됩니다.</p>}
  {q.error&&<p role="alert">저장 결과를 확인할 수 없습니다. 중복 작성 전 기존 메모를 먼저 확인하세요.</p>}
  <section className="state-panel">
    <h2>주문·체결 정보</h2>
    <dl className="mobile-data-card-fields" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:14}}>
      <div><dt>종목 / 방향</dt><dd>{o.symbol} · {direction}</dd></div>
      <div><dt>상태</dt><dd>{isOrder?orderStatusLabel(order?.status??"UNKNOWN"):"개별 체결 관측"}</dd></div>
      {order&&<div><dt>주문 유형</dt><dd>{orderTypeLabel(order.orderType)}</dd></div>}
      <div><dt>수량</dt><dd>{order?order.filled===null?"체결 수량 미확인":formatQuantity(order.filled)+"주":formatQuantity(fill?.quantity)+"주"}</dd></div>
      <div><dt>가격</dt><dd>{order
       ?executionPriceIsKnown(order)?formatMoney(order.price)+" "+order.currency:"체결 전 · 없음"
       :formatMoney(fill?.price??null)+" "+fill?.currency}</dd></div>
      <div><dt>수수료</dt><dd>{order&&feeIsKnown(order)
       ?feeView?.basis==="CONFLICT"?formatMoney(order.fee)+" (통화 확인 필요: 원본·명세서 불일치)"
         :formatMoney(order.fee)+" "+(feeView?.currency??"통화 미확인")+
           (feeView?.basis==="STATEMENT_MATCH"?" (명세서 대조)":"")
       :"확정 정보 없음"}</dd></div>
      <div><dt>계좌</dt><dd>{account.alias}</dd></div>
      <div><dt>원본 시각</dt><dd>{order?nzTime(order.at):fill?.timeRaw??"확인 필요 (시간대 미검증)"}</dd></div>
    </dl>
    {order&&orderTerms(order).length>0&&<p><strong>주문 조건:</strong> {orderTerms(order).join(" · ")}</p>}
    {grouped&&grouped.fills.length>0&&<details className="data-disclosure">
      <summary>개별 부분체결 {grouped.fills.length}건</summary>
      <ul>{grouped.fills.map(f=><li key={f.sourceRef}>
        {formatQuantity(f.quantity)}주 · {formatMoney(f.price)} {f.currency} ·
        <Link href={tigerTradeHref(f.sourceRef,0,"FILL")}>체결 상세 보기</Link>
      </li>)}</ul>
      <p>{grouped.reconciliation==="OBSERVED_SUM_MATCH"?"조회된 수량 합계 일치 (완전성 미검증)":"체결 일부 조회 또는 수량 확인 필요"}</p>
    </details>}
    <p className="user-footnote">이 정보는 Tiger 주문·체결 관측값이며 검증된 전체 거래 원장이나 손익 계산 자료가 아닙니다. 수수료 통화의 명세서 대조는 해당 주문에만 적용되며 개별 체결 수수료를 확정하지 않습니다.</p>
  </section>
  <section className="state-panel" aria-label={heading}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <h2>{heading}</h2>
      <Link href={noteLink} className="btn btn-outline">+ 이유 추가</Link>
    </div>
    {!notesAvailable?<p role="alert">메모를 불러올 수 없습니다. 기록을 삭제하거나 새로 작성하기 전에 다시 조회하세요.</p>:
      notes.length===0?<p>이 {isOrder?"주문":"체결"}에 연결된 이유가 아직 없습니다.</p>:
      <div style={{display:"grid",gap:14}}>
        {activeReasons.map(({current:n,history})=><article className="journal-entry" key={n.id}>
          <small>{new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",dateStyle:"medium",timeStyle:"short"}).format(new Date(n.createdAt))}
            {" · "}사용자 작성 기록</small>
          <p className="journal-entry-text" style={{whiteSpace:"pre-wrap"}}>{correctionOf(n)?.content??n.content}</p>
          <p className="user-footnote">메모 작성 시점의 투자계획: {plans===null?"계획 이력 조회 확인 필요":(()=>{const associated=planAtAuthoredTime(plans,o.symbol,n.createdAt);return associated?"당시까지 작성된 계획 개정 "+associated.id.slice(0,8)+" · "+associated.rationale:"해당 시점 이전에 작성된 계획 미확인";})()} · 시간순 참고 관계이며 거래 당시 실제 적용한 계획을 증명하지 않습니다.</p>
          <p><Link href={noteLink+"&correct="+encodeURIComponent(n.id)}>이유 정정</Link></p>
          {history.length>1&&<details className="data-disclosure"><summary>정정 전 기록 {history.length-1}건</summary>{history.slice(1).map(old=><p key={old.id} className="journal-entry-text" style={{whiteSpace:"pre-wrap"}}>{correctionOf(old)?.content??old.content}</p>)}</details>}
        </article>)}
      </div>}
    <p className="user-footnote">기존 메모를 덮어쓰지 않고 새로운 기록을 추가합니다. 투자일지에는 매매 사실을 요약해 연결합니다.</p>
  </section>
  <p><Link href={"/private/journal?ticker="+encodeURIComponent(o.symbol)}>이 종목의 투자 판단·계획 보기</Link>{" · "}<Link href={"/private/journal/review/new?ticker="+encodeURIComponent(o.symbol)}>이 종목의 투자 판단 복기 작성</Link></p>
  <p className="user-footnote">연결 기준: Tiger 관측 원본 식별자 · 저장된 메모는 투자일지의 단일 데이터 원본을 재사용합니다.</p>
 </main>;
}
