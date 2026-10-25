import Link from "next/link";
import { PublicHeader, PublicFooter } from "../components/site";

export default function Home() {
  return <>
    <PublicHeader />
    <main>
      <section className="hero"><div className="container hero-inner">
        <div>
          <span className="eyebrow">Your investment journal, with context</span>
          <h1>무엇을 샀는지보다,<br/><em>왜 샀는지</em> 기억하세요.</h1>
          <p className="hero-description">매매 기록과 투자 판단을 하나의 흐름으로. Positionary는 거래의 사실, 나의 투자 논리, 그리고 복기를 분리해 정리할 수 있도록 돕는 개인 투자 저널입니다.</p>
          <div className="hero-actions">
            <Link href="/login" className="btn btn-light">Google로 시작하기 <span aria-hidden="true">→</span></Link>
            <Link href="/#how-it-works" className="btn btn-ghost" style={{color:"#e4f5ef",borderColor:"#69958b"}}>서비스 알아보기</Link>
          </div>
          <p className="hero-note">Google 로그인 지원 · Tiger 공식 계좌 연동은 승인 준비 중</p>
        </div>
        <div className="preview" aria-label="Positionary 서비스 화면 예시">
          <div className="preview-top"><span className="preview-title">positionary / 나의 기록</span><span className="preview-dots" aria-hidden="true"><i/><i/><i/></span></div>
          <div className="preview-body">
            <div className="preview-overline">INVESTMENT WORKSPACE</div>
            <h3>판단의 맥락이 쌓이는 공간</h3>
            <div className="preview-row"><span className="preview-icon" aria-hidden="true">01</span><div><strong>거래 사실</strong><small>연결된 증권사의 확인 가능한 기록</small></div><span className="preview-tag">출처 구분</span></div>
            <div className="preview-row"><span className="preview-icon" aria-hidden="true">02</span><div><strong>투자 논리와 전략</strong><small>내가 직접 작성하는 이유와 계획</small></div><span className="preview-tag">직접 작성</span></div>
            <div className="preview-row"><span className="preview-icon" aria-hidden="true">03</span><div><strong>매매 복기</strong><small>당시의 판단을 되짚는 기록</small></div><span className="preview-tag">기록 이력</span></div>
            <div className="preview-caption">화면 구성 예시 · 실계좌 데이터가 아닙니다</div>
          </div>
        </div>
      </div></section>
      <section className="section" id="features"><div className="container">
        <div className="section-heading"><span className="section-kicker">BUILT FOR THOUGHTFUL INVESTORS</span><h2>숫자만 남는 거래 기록을 넘어</h2><p>매매 데이터와 투자 이유가 뒤섞이지 않도록, 출처와 작성 시점을 명확하게 관리합니다.</p></div>
        <div className="feature-grid">
          <article className="feature-card"><span className="feature-card__icon" aria-hidden="true">◎</span><h3>거래 사실은 명확하게</h3><p>증권사에서 조회한 데이터와 직접 입력한 내용을 구분합니다. Tiger 계좌 자동 조회는 공식 승인 후 단계적으로 제공합니다.</p></article>
          <article className="feature-card"><span className="feature-card__icon" aria-hidden="true">✎</span><h3>투자 판단은 나답게</h3><p>매수 이유, 전략 변경, 리스크 판단과 매매 복기를 나만의 기록으로 남깁니다. 기록은 체결 사실과 별도로 관리됩니다.</p></article>
          <article className="feature-card"><span className="feature-card__icon" aria-hidden="true">⌁</span><h3>내 계정 중심의 비공개 공간</h3><p>Google 계정으로 개인 워크스페이스를 만들고, 데이터 내보내기와 계정 삭제 흐름도 준비 중이며, 운영 검증 후 활성화합니다.</p></article>
        </div>
      </div></section>
      <section className="section section-soft" id="how-it-works"><div className="container">
        <div className="section-heading"><span className="section-kicker">GET STARTED</span><h2>투자 기록, 어렵게 시작하지 마세요</h2><p>계좌를 연결하지 않아도 회원가입할 수 있습니다. 준비된 기능부터 이용하고, 연동 범위는 연결 전에 확인하세요.</p></div>
        <div className="steps">
          <div><span className="step-index">01</span><h3>Google로 가입</h3><p>별도의 GitHub 계정 없이 내 워크스페이스를 만듭니다.</p></div>
          <div><span className="step-index">02</span><h3>증권사 연동 확인</h3><p>Tiger를 첫 지원 대상으로 준비 중입니다. 공식 승인 전에는 연결이 차단됩니다.</p></div>
          <div><span className="step-index">03</span><h3>판단과 복기 기록</h3><p>지원되는 기록 기능에서 내가 매매한 이유와 이후의 판단 변화를 남깁니다.</p></div>
        </div>
      </div></section>
      <section className="cta-section"><div className="container"><div className="cta-panel">
        <div><h2>나만의 투자 기록 공간을 시작하세요.</h2><p>Positionary는 투자자의 판단을 기록하기 위해 만들어지고 있습니다.</p></div>
        <Link href="/login" className="btn btn-light">계정 만들기 <span aria-hidden="true">→</span></Link>
      </div></div></section>
    </main>
    <PublicFooter />
  </>;
}
