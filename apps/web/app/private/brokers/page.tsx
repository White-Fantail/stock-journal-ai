import Link from "next/link";
import { redirect } from "next/navigation";
import { currentWorkspace } from "../../../lib/require-workspace";
import { connectionReadiness } from "../../../lib/tiger-connection-policy";

/** Private, server-rendered provider directory. NO connect callback is active. */
export const dynamic = "force-dynamic";

export default async function BrokerConnections() {
  if (!(await currentWorkspace())) redirect("/login");
  const tiger = connectionReadiness();
  return (
    <main>
      <h1>증권사 연결</h1>
      <p>
        한 계정에서 여러 증권사와 계좌를 관리할 수 있도록 준비 중입니다.
        연결마다 접근 권한과 동기화 범위가 별도로 관리됩니다.
      </p>
      <section>
        <h2>Tiger Brokers</h2>
        <p>상태: 연동 준비 중 ({tiger.authorization})</p>
        <p>개인 계좌 조회·체결 가져오기: 현재 비활성화</p>
        <p>
          <Link href="/private/tiger">Tiger 인증·연동 준비 상태 확인</Link>
        </p>
      </section>
      <section>
        <h2>다른 증권사</h2>
        <p>증권사별 인증 방식과 데이터 지원 범위를 검증한 후 순차 추가합니다.</p>
        <p>IBKR 등 다른 증권사는 아직 연결 기능이 없습니다.</p>
      </section>
      <section>
        <h2>수동 거래 기록</h2>
        <p>증권사 연동 없이 거래를 직접 기록하는 기능을 개발 중입니다.</p>
      </section>
      <p>보안을 위해 비밀번호, API 개인키, 토큰을 입력하거나 업로드하지 마세요.</p>
      <p><Link href="/private">내 워크스페이스로 돌아가기</Link></p>
    </main>
  );
}
