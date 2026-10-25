import Link from "next/link";
import type { Metadata } from "next";
import { PublicHeader, PublicFooter } from "../../components/site";

export const metadata: Metadata = {title:"이용 안내"};
export default function TermsPage() {
  return <><PublicHeader/><main className="container legal-page">
    <span className="section-kicker">SERVICE GUIDE</span><h1>Positionary 이용 안내</h1>
    <p>Positionary는 자신의 투자 활동을 기록하고 판단 과정을 돌아보기 위한 개인 투자 저널입니다. 현재 베타 준비 단계이며, 이 안내는 제공 기능의 범위와 한계를 설명합니다.</p>
    <p className="legal-note">정식 계약 약관이 아닌 서비스 이용 안내입니다. Tiger 앱 신청에 필요한 최종 약관·정책은 실제 서비스 운영 조건에 맞추어 검토 후 확정해야 합니다.</p>
    <h2>1. 로그인과 내 공간</h2>
    <p>Google 계정으로 로그인하면 개인 워크스페이스가 생성됩니다. 타인에게 계정 접근을 허용하지 말고, 자신에게 권한이 있는 거래 정보만 기록해 주세요.</p>
    <h2>2. 거래 데이터와 기록의 차이</h2>
    <p>사용자가 직접 기록한 내용은 브로커가 확인한 거래 사실과 구분됩니다. 증권사 연동 이후에도 데이터 제공 범위·시점·누락 여부를 확인해야 하며, 수익률이나 잔고를 추정치로 확정 표시하지 않습니다.</p>
    <h2>3. 베타 기능의 제한</h2>
    <p>Tiger 계좌 인증과 자동 데이터 동기화는 제공사 승인 및 안전성 검증 후 활성화됩니다. 일부 거래·일지·내보내기·삭제 기능은 운영 검증 상태에 따라 사용할 수 없으며, 앱 화면에 현재 상태를 표시합니다.</p>
    <h2>4. 투자 서비스가 아닙니다</h2>
    <p>Positionary는 현재 투자 자문, 자산 운용, 투자 성과 보장, 주식 주문·취소·이체 서비스를 제공하지 않습니다. 투자 결정과 증권사 거래 실행의 책임은 사용자에게 있습니다.</p>
    <h2>5. 개인정보와 변경</h2>
    <p>데이터 처리 내용은 <Link href="/privacy">개인정보 처리 안내</Link>를 확인해 주세요. 향후 공식 정책, 서비스 범위 및 지원 증권사를 갱신할 수 있습니다.</p>
    <p><Link href="/">← Positionary 홈</Link></p>
  </main><PublicFooter/></>;
}
