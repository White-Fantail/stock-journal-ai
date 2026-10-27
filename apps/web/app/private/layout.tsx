import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "../../auth";
import { currentWorkspace } from "../../lib/require-workspace";
import { Brand, PublicFooter } from "../../components/site";
import { SessionRefresh } from "../../components/session-refresh";

export const dynamic = "force-dynamic";

export default async function PrivateLayout({children}: Readonly<{children: React.ReactNode}>) {
  if (!await currentWorkspace()) redirect("/login");
  return <SessionRefresh>
    <header className="app-header"><div className="container">
      <Brand />
      {/* Use native document navigation in private menus. Next's RSC client transitions can
          stall across deployments or slow authenticated server renders. Plain anchors
          also avoid prefetching every item when a long More menu opens. */}
      <nav className="app-nav" aria-label="내 공간 메뉴">
        <a href="/private">홈</a>
        <a href="/private/portfolio">포트폴리오</a>
        <a href="/private/journal">투자일지</a>
        <a href="/private/review">점검</a>
        <details className="app-desktop-more">
          <summary>더보기 ▾</summary>
          <div className="app-desktop-more-panel">
            <a href="/private/principles">나의 투자 원칙</a>
            <a href="/private/trades">거래 기록</a>
            <a href="/private/risk">위험 계산기</a>
            <a href="/private/analysis">AI 분석</a>
            <a href="/private/analysis?mode=COACHING">AI 코칭</a>
            <a href="/private/alerts">점검 센터</a>
            <a href="/private/reports/weekly">주간 점검</a>
            <a href="/private/reports/monthly">월간 복기</a>
            <a href="/private/performance">장기 성과</a>
            <a href="/private/brokers">증권사 연결</a>
            <a href="/private/settings">설정</a>
          </div>
        </details>
      </nav>
      <nav className="app-mobile-nav" aria-label="모바일 주 메뉴">
        <a href="/private">홈</a>
        <a href="/private/portfolio">포트폴리오</a>
        <a href="/private/journal">투자일지</a>
        <a href="/private/review">점검</a>
        <details className="app-mobile-more">
          <summary>더보기 <span aria-hidden="true">▾</span></summary>
          <div className="app-mobile-more-panel">
            <a href="/private/principles">나의 투자 원칙</a>
            <a href="/private/trades">거래 기록</a>
            <a href="/private/risk">위험 계산기</a>
            <a href="/private/analysis">AI 분석</a>
            <a href="/private/analysis?mode=COACHING">AI 코칭</a>
            <a href="/private/alerts">점검 센터</a>
            <a href="/private/reports/weekly">주간 점검</a>
            <a href="/private/reports/monthly">월간 복기</a>
            <a href="/private/performance">장기 성과</a>
            <a href="/private/brokers">증권사 연결</a>
            <a href="/private/settings">설정</a>
          </div>
        </details>
      </nav>
      <form action={async () => {"use server";await signOut({redirectTo:"/login"});}}>
        <button type="submit" className="logout-btn">로그아웃</button>
      </form>
    </div></header>
    <div className="container app-shell">{children}</div>
    <PublicFooter />
  </SessionRefresh>;
}
