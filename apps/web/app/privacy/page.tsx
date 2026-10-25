import Link from "next/link";
import type { Metadata } from "next";
import { PublicHeader, PublicFooter } from "../../components/site";

export const metadata: Metadata = {title:"개인정보 처리 안내"};
export default function PrivacyPage() {
  return <><PublicHeader/><main className="container legal-page">
    <span className="section-kicker">PRIVACY</span><h1>개인정보 처리 안내</h1>
    <p>Positionary는 사용자가 자신의 투자 기록과 판단을 비공개로 정리할 수 있도록 설계된 서비스입니다. 이 페이지는 현재 베타 준비 단계의 데이터 처리 원칙과 제공 상태를 안내합니다.</p>
    <p className="legal-note">2026년 10월 26일 기준 · 정식 서비스 약관 및 운영 정책은 공개 전 법률·보안 검토에 따라 갱신될 수 있습니다. Tiger 계좌 연결은 현재 공식 승인 준비 단계입니다.</p>
    <h2>1. 어떤 정보를 처리하나요?</h2>
    <p>Google 로그인 시 인증에 필요한 계정 식별 정보와 기본 프로필 정보를 처리합니다. 계정에 개인 워크스페이스가 생성되며, 기록 기능이 활성화되면 사용자가 직접 입력한 거래·투자 일지 등의 정보가 해당 워크스페이스에 저장됩니다.</p>
    <h2>2. 증권사 계좌 정보</h2>
    <p>Tiger Brokers는 첫 연결 대상입니다. 공식 승인 및 조회 전용 권한 검증 전에는 인증을 제공하지 않습니다. 지원되는 경우에도 증권사 로그인을 Positionary에 직접 입력받지 않으며, 사용자가 허용한 범위의 데이터만 조회하도록 설계되어 있습니다. 거래 및 계좌 기록의 조회 가능 범위는 브로커가 제공하는 기능에 따라 달라집니다.</p>
    <h2>3. 이용 목적과 보관</h2>
    <p>로그인, 개인 워크스페이스 관리, 사용자가 요청한 기록·연동 기능 제공, 보안 운영 목적으로 처리합니다. 웹 서비스는 Vercel, 백엔드 및 데이터베이스는 Railway 기반으로 구성됩니다. 데이터 보관 위치, 백업 보존 기간 등 상세 운영 정책은 정식 서비스 전 확정해 안내합니다.</p>
    <h2>4. 외부 제공 및 AI</h2>
    <p>Google은 로그인 제공자이며, Tiger는 사용자가 별도로 연결을 승인하는 경우에만 계좌 데이터 제공자가 됩니다. 현재 개인 투자 데이터를 외부 AI 서비스로 전송하는 기능은 제공하지 않으며, 향후 분석 기능이 도입될 경우 별도 동의 절차를 마련합니다.</p>
    <h2>5. 사용자의 선택</h2>
    <p>사용자는 증권사 연결 상태를 확인하고 지원되는 경우 연결을 해제할 수 있습니다. 기록 내보내기와 계정 삭제는 보안 검증 상태에 따라 비활성화될 수 있으므로, 이용 가능 여부는 <Link href="/private/settings">계정 설정</Link>에서 확인해 주세요. 백업 및 외부 증권사의 권한 철회는 별도 절차가 필요할 수 있습니다.</p>
    <h2>6. 서비스 상태와 변경</h2>
    <p>이 안내는 현재의 서비스 설계 및 베타 제공 범위를 설명합니다. 정식 운영 전 공개된 개인정보 처리방침, 연락처, 보존 정책 및 국외 이전 사항을 별도로 검토하고 보완할 예정입니다.</p>
    <p><Link href="/">← Positionary 홈</Link></p>
  </main><PublicFooter/></>;
}
