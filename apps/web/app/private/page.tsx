import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentWorkspace } from "../../lib/require-workspace";
import { manualTradeEnabled } from "../../lib/saas-trades-api";
import { tigerStatus, type TigerStatus } from "../../lib/tiger-api";

export const metadata: Metadata = {title:"내 대시보드"};
export const dynamic = "force-dynamic";

export default async function WorkspaceHome() {
  const workspace = await currentWorkspace();
  if (!workspace) redirect("/login");
  let state: TigerStatus | null = null;
  try {state = await tigerStatus();} catch { /* Distinguish unavailable state from disconnected. */ }
  const connected = (state?.connections ?? []).filter(c => c.status === "CONNECTED").length;
  const connectionLabel = !state ? "상태 확인 필요" : connected ? "계좌 연결됨" : state.enabled ? "연결 가능" : "연동 준비 중";
  return <main>
    <section className="dashboard-hero">
      <div><span className="eyebrow">MY INVESTMENT WORKSPACE</span>
        <h1>내 투자의 이유를 기록하는 곳</h1>
        <p>매매했던 사실, 그때의 생각, 그리고 이후의 판단을 차곡차곡 정리하세요. Positionary는 기록의 출처와 맥락을 중요하게 생각합니다.</p>
      </div><div className="dashboard-graphic" aria-hidden="true">↗</div>
    </section>
    <div className="dashboard-heading"><h2>내 공간 한눈에 보기</h2><span className="pill pill-neutral">개인 워크스페이스</span></div>
    <div className="dashboard-grid">
      <article className="dashboard-card">
        <div className="icon-square" aria-hidden="true">◎</div>
        <h3>증권사 연결</h3>
        <span className={state?.enabled && connected ? "pill" : "pill pill-warning"}>{connectionLabel}</span>
        <p style={{marginTop:14}}>Tiger Brokers부터 지원을 준비하고 있습니다. 공식 승인 전에는 인증이 시작되지 않습니다.</p>
        <Link href="/private/brokers">연결 상태 확인 →</Link>
      </article>
      <article className="dashboard-card">
        <div className="icon-square" aria-hidden="true">◈</div>
        <h3>내 포트폴리오</h3>
        <span className="pill pill-warning">검증 대기</span>
        <p style={{marginTop:14}}>연결 계좌별 거래이력·수수료·보유수량 검증 상태를 확인합니다. 미확인 금액은 표시하지 않습니다.</p>
        <Link href="/private/portfolio">포트폴리오 상태 보기 →</Link>
      </article>
      <article className="dashboard-card">
        <div className="icon-square" aria-hidden="true">≡</div>
        <h3>거래 기록</h3>
        <span className={manualTradeEnabled() ? "pill" : "pill pill-neutral"}>{manualTradeEnabled() ? "직접 입력 이용 가능" : "운영 검증 중"}</span>
        <p style={{marginTop:14}}>거래 기록을 출처별로 구분하여 관리합니다. 거래 입력은 보안 검증 후 활성화됩니다.</p>
        <Link href="/private/trades">거래 기록 보기 →</Link>
      </article>
      <article className="dashboard-card">
        <div className="icon-square" aria-hidden="true">✎</div>
        <h3>투자 일지</h3>
        <span className={manualTradeEnabled() ? "pill" : "pill pill-neutral"}>{manualTradeEnabled() ? "기록 이용 가능" : "운영 검증 중"}</span>
        <p style={{marginTop:14}}>매수 근거, 투자 전략과 복기를 내가 작성한 기록으로 남기는 공간입니다.</p>
        <Link href="/private/journal">내 투자 일지 열기 →</Link>
      </article>
    </div>
    <div className="dashboard-heading"><h2>이렇게 시작해 보세요</h2></div>
    <div className="state-panel">
      <div className="connection-steps">
        <div className="connection-step">1 · 가입 완료<small>Google 계정으로 개인 공간 생성</small></div>
        <div className="connection-step">2 · 연동 상태 확인<small>Tiger 연결은 공식 승인 이후 사용 가능</small></div>
        <div className="connection-step">3 · 투자 기록 쌓기<small>운영 검증이 완료된 기록 기능부터 이용</small></div>
      </div>
      <p className="subtle">계좌 잔액·수익률은 검증된 데이터가 준비되기 전까지 표시하지 않습니다. 없는 데이터를 0으로 계산하지 않습니다.</p>
    </div>
    <div className="info-strip"><span aria-hidden="true">ⓘ</span><div><strong>Positionary는 현재 베타 준비 단계입니다.</strong>
      <p>브로커 인증, 체결내역 자동 동기화, 포트폴리오 분석은 단계적으로 검증하고 있습니다. 현재 이용 가능한 기능과 준비 중인 기능을 구분해 안내합니다.</p></div></div>
  </main>;
}
