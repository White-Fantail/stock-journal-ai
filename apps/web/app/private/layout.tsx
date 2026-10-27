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
      <nav className="app-nav" aria-label="내 공간 메뉴">
        <Link href="/private">대시보드</Link>
        <Link href="/private/portfolio">포트폴리오</Link>
        <Link href="/private/risk">위험 계산기</Link>
        <Link href="/private/trades">거래 기록</Link>
        <Link href="/private/journal">투자 일지</Link>
        <Link href="/private/analysis">AI 분석</Link>
        <Link href="/private/alerts">점검 센터</Link>
        <Link href="/private/reports/monthly">월간 복기</Link>
        <Link href="/private/performance">장기 성과</Link>
        <Link href="/private/brokers">증권사 연결</Link>
        <Link href="/private/settings">설정</Link>
      </nav>
      <nav className="app-mobile-nav" aria-label="모바일 주 메뉴">
        <Link href="/private">홈</Link>
        <Link href="/private/portfolio">포트폴리오</Link>
        <Link href="/private/trades">거래 기록</Link>
        <Link href="/private/journal">투자 일지</Link>
        <details className="app-mobile-more">
          <summary>더보기 <span aria-hidden="true">▾</span></summary>
          <div className="app-mobile-more-panel">
            <Link href="/private/risk">위험 계산기</Link>
            <Link href="/private/analysis">AI 분석</Link>
            <Link href="/private/alerts">점검 센터</Link>
            <Link href="/private/reports/monthly">월간 복기</Link>
        <Link href="/private/performance">장기 성과</Link>
            <Link href="/private/brokers">증권사 연결</Link>
            <Link href="/private/settings">설정</Link>
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
