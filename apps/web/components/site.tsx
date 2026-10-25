import Link from "next/link";

export function Brand() {
  return <Link href="/" className="brand" aria-label="Positionary 홈">
    <span className="brand-icon" aria-hidden="true">↗</span><span>positionary</span>
  </Link>;
}
export function PublicHeader() {
  return <header className="site-header"><div className="container site-header__inner">
    <Brand />
    <nav className="site-header__links" aria-label="메인 메뉴">
      <Link href="/#how-it-works">이용 방법</Link>
      <Link href="/#features">주요 기능</Link>
      <Link href="/login" className="btn btn-primary">시작하기 <span aria-hidden="true">→</span></Link>
    </nav>
  </div></header>;
}
export function PublicFooter() {
  return <footer className="site-footer"><div className="container footer-inner">
    <span>© {new Date().getFullYear()} Positionary · 투자 기록을 더 명확하게.</span>
    <div className="footer-links"><Link href="/privacy">개인정보 처리 안내</Link><Link href="/terms">이용 안내</Link></div>
    <span>베타 서비스 · 투자 자문 및 주문 실행 기능 미제공</span>
  </div></footer>;
}
