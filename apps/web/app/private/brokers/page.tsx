import Link from "next/link";
import { redirect } from "next/navigation";
import { currentWorkspace } from "../../../lib/require-workspace";

export const dynamic = "force-dynamic";
export default async function BrokerConnections() {
  if (!(await currentWorkspace())) redirect("/login");
  return (
    <main>
      <h1>증권사 선택</h1>
      <p>증권사마다 공식 인증을 거쳐 각각 조회 권한을 연결할 수 있습니다.</p>
      <section>
        <h2>Tiger Brokers</h2>
        <p>첫 지원 증권사 · 조회 전용 OAuth2 · 승인 확인 후 연결 가능</p>
        <p><Link href="/private/tiger">Tiger Brokers 선택 · 연결 상태 확인</Link></p>
      </section>
      <section><h2>다른 증권사</h2><p>IBKR 등은 이후 어댑터로 제공할 예정입니다.</p></section>
      <p>주문 권한은 P3에서 요청하지 않습니다.</p>
      <p><Link href="/private">내 워크스페이스로 돌아가기</Link></p>
    </main>
  );
}
