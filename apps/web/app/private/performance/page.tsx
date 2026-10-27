import Link from "next/link";
import {redirect} from "next/navigation";
import type {Metadata} from "next";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {tigerLedgerRead,tigerReviewStatus} from "../../../lib/tiger-api";
import {assessPerformanceReadiness} from "../../../lib/performance-readiness";
import {completedPerformanceIntervals,selectPerformanceInterval} from "../../../lib/performance-periods";

export const metadata:Metadata={title:"장기 투자 성과 검증 · Positionary"};
export const dynamic="force-dynamic";
const dateLabel=(value:string)=>new Intl.DateTimeFormat("ko-KR",{
 timeZone:"Pacific/Auckland",dateStyle:"medium",
}).format(new Date(value));
const intervalName:Record<string,string>={
 MONTH:"월간",QUARTER:"분기",YEAR:"연간",
};
const GATE_LABEL:Record<string,string>={
 SOURCE_ACCESS:"증권사 조회 권한",
 BROKER_EXECUTIONS:"원장에 공개된 검증 체결·보유 증거",
 BROKER_COVERAGE:"기간 전체·전 계좌 원본 이력",
 CASH_FLOWS:"외부 입출금과 계좌 간 이체",
 DIVIDENDS_CORPORATE_ACTIONS:"배당·수수료·세금·기업행동",
 FX_CONVERSION:"거래 시점별 환율 및 기준 통화",
 HISTORICAL_VALUATIONS:"기간 경계별 NAV 및 현금흐름 시점",
 PERFORMANCE_RELEASE:"독립 검증된 성과 공개 승인",
};
export default async function PerformancePage({searchParams}:{
 searchParams:Promise<{period?:string}>
}){
 const [session,workspace,params]=await Promise.all([auth(),currentWorkspace(),searchParams]);
 if(!workspace||!session?.user?.id)redirect("/login");
 const intervals=completedPerformanceIntervals();
 const selected=selectPerformanceInterval(intervals,params.period);
 const [ledgerResult,reviewResult]=await Promise.allSettled([
   tigerLedgerRead(),tigerReviewStatus(),
 ]);
 const ledger=ledgerResult.status==="fulfilled"?ledgerResult.value:null;
 const review=reviewResult.status==="fulfilled"?reviewResult.value:null;
 const readiness=assessPerformanceReadiness(ledger,null);
 const groups=[
   {kind:"MONTH",label:"최근 완료된 월"},
   {kind:"QUARTER",label:"완료된 분기"},
   {kind:"YEAR",label:"완료된 연도"},
 ] as const;
 return <main className="journal-page performance-page">
   <div className="page-intro journal-page-heading">
     <div><span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
       <h1>장기 투자 성과</h1>
       <p>월간·분기·연간 수익률을 공개하기 전에 필요한 데이터의 검증 상태를 확인합니다.
         불완전한 기록으로 수익률이나 벤치마크 비교를 만들어내지 않습니다.</p>
     </div>
     <Link className="btn btn-outline" href="/private/reports/monthly">투자 복기 보고서 →</Link>
   </div>

   <section className="user-panel">
     <div className="user-panel-head"><h2>기간 선택</h2><small>뉴질랜드 달력 기준 · 종료된 기간만</small></div>
     {groups.map(group=><div key={group.kind} className="performance-period-group">
       <h3>{group.label}</h3>
       <div className="performance-period-links" role="group" aria-label={group.label}>
         {intervals.filter(p=>p.kind===group.kind).map(p=>
           <Link key={p.key} className={"performance-period-link"+(p.key===selected?.key?" is-active":"")}
             aria-current={p.key===selected?.key?"page":undefined}
             href={"/private/performance?period="+encodeURIComponent(p.key)}>{p.label}</Link>)}
       </div>
     </div>)}
   </section>

   <section className="user-panel" aria-label="선택한 투자 성과 기간 검증 결과">
     <div className="user-panel-head"><div>
       <h2>{selected?.label??"선택 기간 없음"} · {selected?intervalName[selected.kind]:"기간"} 성과</h2>
       {selected&&<p className="user-footnote">기간: {dateLabel(selected.start)}부터 {dateLabel(selected.end)} 직전까지 (NZ)</p>}
     </div><span className="pill pill-warning">수익률 계산 보류</span></div>
     <div className="account-summary-values portfolio-account-values">
       <div><small>기간 수익률</small><strong>미검증</strong></div>
       <div><small>외부 입출금 반영 성과</small><strong>미검증</strong></div>
       <div><small>벤치마크 대비 성과</small><strong>계산 보류</strong></div>
     </div>
     <p>이 기간의 전체 계좌 NAV, 입출금 발생 시각, 기업행동, 수수료와 환율 근거가
       독립적으로 연결되지 않았습니다. 현재 잔고와 주문 스냅샷만으로는
       자금 유입을 투자 수익으로 잘못 계산할 위험이 있습니다.</p>
     <p className="journal-limit">다른 증권사·은행·외부 자산의 포함 범위도 검증되지 않았습니다.
       계산 가능한 기간이 자동으로 존재한다고 가정하거나 임의의 원금을 채우지 않습니다.
       현재 이 페이지는 검증 현황만 읽으며 어떤 수치도 DB에 저장하지 않습니다.</p>
   </section>

   <section className="user-panel">
     <div className="user-panel-head"><h2>성과 데이터 검증 체크리스트</h2>
       <Link href="/private/portfolio">계좌별 상태 →</Link></div>
     <p>현재 공개된 검증 원장 계좌 <strong>{readiness.verifiedAccounts}개</strong>.
       전체 증권사 계좌 및 선택 기간을 증명한 수치가 아닙니다.</p>
     <div className="user-list">
       {readiness.gates.map(gate=><div className="user-list-row performance-proof-row" key={gate.kind}>
         <div><strong>{GATE_LABEL[gate.kind]??gate.label}</strong>
           <small>{gate.detail}</small></div>
         <div className="user-list-value"><strong>
           {gate.state==="VERIFIED"?"현재 원장 일부 확인":
            gate.state==="UNAVAILABLE"?"상태 조회 불가":"검증 필요"}
         </strong></div>
       </div>)}
     </div>
     <p className="journal-limit">위의 '현재 원장 일부 확인'은 해당 조건의 일부 공개 기록에만
       적용됩니다. 선택 기간의 완전한 자료나 수익률 계산 가능 여부를 증명하지 않습니다.</p>
   </section>

   <section className="user-panel">
     <div className="user-panel-head"><h2>Tiger 원장 검토 단계</h2>
       <Link href="/private/brokers">증권사 연결 →</Link></div>
     {review===null?<p role="status">독립 검증 진행 상태를 조회하지 못했습니다. 아직 검증된 성과로 간주하지 않습니다.</p>:
      review.accounts.length===0?<p>현재 별도로 확인할 검토 원장 계좌가 없습니다.
        Tiger 개인 RSA 자금 거래 진단은 증빙 제출 또는 성과 승인과 구분합니다.</p>:
      <div className="user-list">
        {review.accounts.map(a=><div className="user-list-row" key={a.accountId}>
          <div><strong>{a.alias}</strong><small>검토 버전 {a.version}
            {" · "}{a.state==="BLOCKED"?"검증 장애":"단계별 증거 대조 중"}</small></div>
          <div className="user-list-value"><strong>{a.issues.length}개 확인 항목</strong>
            <small>원본 연결 증거 {a.sourceEvidenceCount}건 · 성과 승인은 별도</small></div>
        </div>)}
      </div>}
     <p className="journal-limit">배당·이체·환전·체결 수수료의 개별 출처와 전 계좌 이력을
       독립적으로 검증하기 전에는 확정된 장기 투자 수익률을 계산하지 않습니다.
       매수·매도 주문이나 가격 조건 알림은 이 페이지에서 제공하지 않습니다.</p>
   </section>
 </main>;
}
