import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentWorkspace } from "../../../lib/require-workspace";
import { tigerStatus, tigerPersonalRead, type TigerStatus } from "../../../lib/tiger-api";

export const metadata: Metadata = {title:"증권사 연결"};
export const dynamic = "force-dynamic";
export default async function BrokerConnections() {
  if (!await currentWorkspace()) redirect("/login");
  const personal=await tigerPersonalRead();
  let state: TigerStatus | null = null;
  try {state=await tigerStatus();} catch { /* Provider state not available. */ }
  const count=(state?.connections ?? []).filter(c=>c.status==="CONNECTED").length;
  return <main>
    <div className="page-intro"><span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
      <h1>내 증권사 연결</h1><p>사용할 증권사를 선택하고, 지원 상태와 인증에 필요한 권한을 확인하세요. 증권사 연결은 Google 로그인과 별도로 진행합니다.</p></div>
    <div className="broker-list">
      <section className="broker-card broker-card--highlight">
        <div className="broker-top"><span className="broker-logo" aria-hidden="true">T</span>
          <span className={personal?.accounts.length || count ? "pill" : "pill pill-warning"}>{personal?.accounts.length ? "내 계좌 연결됨" : count ? "연결됨" : state?.enabled ? "연결 가능" : state ? "승인 준비 중" : "상태 확인 필요"}</span></div>
        <h2>Tiger Brokers</h2>
        <p>Positionary의 첫 번째 연동 대상입니다. {personal?.accounts.length ? "내 계정은 개인 API로 조회 중입니다. 다른 사용자는 공식 OAuth 승인 대기 상태입니다." : "공식 승인이 확인되면 Tiger 인증으로 조회 권한을 연결할 수 있습니다."}</p>
        <Link href="/private/tiger" className="btn btn-primary">연결 상태 자세히 보기 <span aria-hidden="true">→</span></Link>
      </section>
      <section className="broker-card">
        <div className="broker-top"><span className="broker-logo broker-logo--muted" aria-hidden="true">+</span><span className="pill pill-neutral">추후 지원</span></div>
        <h2>다른 증권사</h2>
        <p>다른 증권사도 각 업체의 공식 인증 및 데이터 제공 범위를 검증한 뒤 추가할 계획입니다. 현재 연결할 수 없습니다.</p>
      </section>
    </div>
    <div className="info-strip"><span aria-hidden="true">🔒</span><div><strong>계좌 로그인 정보는 Positionary에 입력하지 마세요.</strong><p>공식 인증이 지원되는 경우에도 로그인은 증권사 화면에서 진행합니다. 초기 연동은 조회용이며, 주문이나 이체 기능은 제공하지 않습니다.</p></div></div>
  </main>;
}
