import Link from "next/link";
import { redirect } from "next/navigation";
import { currentWorkspace } from "../../../lib/require-workspace";
import { connectionReadiness } from "../../../lib/tiger-connection-policy";

export const dynamic = "force-dynamic";
export default async function TigerConnectionStatus() {
  if (!await currentWorkspace()) redirect("/login");
  const status = connectionReadiness();
  return (
    <main>
      <h1>나의 증권사 연결</h1>
      <p>Tiger 계좌를 고객별로 안전하게 연결하기 위한 검증이 진행 중입니다.</p>
      <dl>
        <dt>계좌 연결</dt><dd>{status.authorization}</dd>
        <dt>실시간 조회</dt><dd>{status.brokerageQueries}</dd>
        <dt>모의 동기화</dt><dd>{status.shadowSync}</dd>
      </dl>
      <p>현재 브로커 연결 버튼을 제공하지 않으며 개인 계좌에 접근하지 않습니다.</p>
      <p><Link href="/private">내 워크스페이스로 돌아가기</Link></p>
    </main>
  );
}
