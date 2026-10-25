import Link from "next/link";
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main>
      <h1>Stock Journal AI</h1>
      <p>내 투자 기록을 체계적으로 관리하는 개인 투자일지.</p>
      <p>Google 계정으로 시작하고, 거래 근거와 투자 전략을 비공개로 기록하세요.</p>
      <p><Link href="/login">Google로 시작하기</Link></p>
      <p>현재 SaaS 초기 개발 단계로 브로커 자동 연동, 과금 및 실거래 기능은 제공되지 않습니다.</p>
    </main>
  );
}
