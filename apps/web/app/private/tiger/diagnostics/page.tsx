import Link from "next/link";
import {redirect} from "next/navigation";
import type {Metadata} from "next";
import {currentWorkspace} from "../../../../lib/require-workspace";
import {tigerPersonalDiagnostics,tigerPersonalRead} from "../../../../lib/tiger-api";

export const metadata:Metadata={title:"Tiger 계좌 데이터 점검 · Positionary"};
export const dynamic="force-dynamic";

export default async function TigerDiagnosticsPage(){
  if(!await currentWorkspace()) redirect("/login");
  const [diagnostics,personal]=await Promise.all([
    tigerPersonalDiagnostics(),tigerPersonalRead(),
  ]);
  const total=diagnostics?.snapshotCounts.reduce((n,x)=>n+x.count,0)??0;
  const observed=diagnostics?.snapshotCounts.find(x=>x.kind==="TRANSACTIONS")?.count??0;
  return <main>
    <div className="page-intro">
      <span className="breadcrumb"><Link href="/private/brokers">← 증권사 연결</Link></span>
      <h1>Tiger 계좌 데이터 점검</h1>
      <p>계좌번호, 보유 종목, 주문 금액은 표시하지 않고 현재 로그인 계정에 귀속된 저장 기록의 건수만 조회합니다.
        이 화면은 데이터를 삭제하거나 재수집하지 않습니다.</p>
    </div>
    {!diagnostics?<section className="state-panel">
      <h2>개인 계좌 진단에 접근할 수 없습니다</h2>
      <p>개인 Tiger API 대상 계정이 아니거나 서버가 진단 결과를 반환하지 않았습니다.
        승인 대기 상태와 장애를 이 화면만으로 구분할 수 없습니다.</p>
    </section>:<>
      <section className="state-panel">
        <h2>저장 상태</h2>
        <p>등록된 Tiger 계좌 {diagnostics.accountCount}개 · 현재 개인 API 조회 조건에 맞는 계좌 {diagnostics.pilotReadableAccountCount}개</p>
        <p>저장된 원본 스냅샷 {total}개 · 그중 거래 관측 자료 {observed}개</p>
        <p>현재 화면 응답: {personal===null?"읽기 실패 또는 응답 검증 실패":
          personal.accounts.length===0?"계좌 0개":personal.accounts.length+"개 계좌 반환"}</p>
        {!!personal?.readWarnings?.length && <p role="status">일부 세부 자료 형식 검사 문제: {personal.readWarnings.join(", ")}. 검증 가능한 나머지 정보만 부분 표시합니다.</p>}
        {observed>0 && (personal===null || personal.accounts.length===0) &&
          <p role="status">데이터베이스에 Tiger 거래 관측 자료가 남아 있습니다.
            기존 기록을 초기화하지 마세요. 계좌 연결 상태나 응답 검증 문제를 조사해야 합니다.</p>}
        {diagnostics.accountCount>0 && diagnostics.pilotReadableAccountCount===0 &&
          <p role="status">계좌 기록은 있으나 개인 API 조회 조건에 맞는 연결이 없습니다.
            연결 상태를 확인해야 하며 계좌를 새로 만들지 마세요.</p>}
        {total===0 && <p role="status">이 로그인 계정에 귀속된 스냅샷을 찾지 못했습니다.
          이 결과만으로 다른 DB·백업에 있던 기록까지 삭제됐다고 확정할 수는 없습니다.</p>}
      </section>
      <section className="state-panel">
        <h2>연결 상태별 건수</h2>
        {diagnostics.connections.length===0?<p>등록된 Tiger 연결이 없습니다.</p>:
          <ul>{diagnostics.connections.map((x,i)=>
            <li key={i}>{x.mode} / {x.status}: {x.count}개</li>)}</ul>}
        <h2>저장된 자료 종류</h2>
        {diagnostics.snapshotCounts.length===0?<p>조회된 스냅샷이 없습니다.</p>:
          <ul>{diagnostics.snapshotCounts.map(x=>
            <li key={x.kind}>{x.kind}: {x.count}개</li>)}</ul>}
      </section>
    </>}
    <p><Link href="/private/trades">거래 기록으로 돌아가기 →</Link></p>
  </main>;
}
