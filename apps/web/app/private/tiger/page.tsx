import Link from "next/link";
import { redirect } from "next/navigation";
import { currentWorkspace } from "../../../lib/require-workspace";
import { tigerStatus, type TigerStatus } from "../../../lib/tiger-api";

export const dynamic = "force-dynamic";
export default async function TigerConnections() {
  if (!await currentWorkspace()) redirect("/login");
  let state: TigerStatus | null = null;
  try { state = await tigerStatus(); } catch { /* no fictitious connected state */ }
  return (
    <main>
      <h1>Tiger Brokers 연결</h1>
      <p>Google 로그인과 Tiger 인증은 별개입니다. 계좌 비밀번호나 개인 API 키를 이 사이트에 입력하지 마세요.</p>
      <p>계좌 조회 및 체결 조회만 허용하는 권한으로 연동하며, 주문·취소·이체 기능은 지원하지 않습니다.</p>
      {!state?.enabled ? (
        <section>
          <h2>연동 승인 확인 중</h2>
          <p>Tiger의 제3자 서비스 승인과 조회 전용 권한 검증, 별도 보안 DB 설정 전에는 인증을 시작할 수 없습니다.</p>
        </section>
      ) : (
        <section>
          <h2>안전한 Tiger 인증</h2>
          <p>연결 버튼을 누르면 Tiger 공식 로그인 및 동의 화면으로 이동합니다.</p>
          <form action="/api/private/tiger/start" method="post">
            <button type="submit">Tiger 계정 연결</button>
          </form>
        </section>
      )}
      {state?.connections.map((connection) => (
        <section key={connection.id}>
          <h2>연결 상태: {connection.status}</h2>
          {connection.expiresAt && <p>인증 만료 예정: {connection.expiresAt}</p>}
          {connection.lastSuccessAt && <p>마지막 계좌 조회: {connection.lastSuccessAt}</p>}
          {connection.status === "CONNECTED" && state.enabled && (
            <form action="/api/private/tiger/account" method="post">
              <input name="action" type="hidden" value="bind" />
              <input name="connectionId" type="hidden" value={connection.id} />
              <label htmlFor={"account-" + connection.id}>Tiger 계좌번호</label>
              <input id={"account-" + connection.id} name="accountNumber"
                pattern="[A-Za-z0-9]{5,25}" autoComplete="off" maxLength={25} required />
              <button type="submit">조회 권한 확인 후 계좌 추가</button>
              <p>계좌번호는 Tiger에서 해당 계좌에 대한 조회 권한을 확인하는 데만 사용하며 암호화해 보관합니다.</p>
            </form>
          )}
          <form action="/api/private/tiger/account" method="post">
            <input name="action" type="hidden" value="disconnect" />
            <input name="connectionId" type="hidden" value={connection.id} />
            <button type="submit">이 연결 해제</button>
          </form>
        </section>
      ))}
      {state?.accounts.filter(account => state!.connections.some(c => c.id === account.connectionId && c.status === "CONNECTED")).map(account => (
        <section key={account.id}>
          <h2>{account.alias}</h2>
          <p>보유 자산 스냅샷 조회는 가능하지만 과거 체결내역 전체 복원은 아직 검증 중입니다.</p>
          <form action="/api/private/tiger/account" method="post">
            <input name="action" type="hidden" value="read"/>
            <input name="accountId" type="hidden" value={account.id}/>
            <button type="submit" disabled={!state?.enabled}>자산·포지션 새로 조회</button>
          </form>
        </section>
      ))}
      <p>연결을 해제하면 암호화된 토큰을 삭제하고 Tiger에 원격 철회를 요청합니다. 철회가 실패한 경우 Tiger Developer Center에서 직접 철회하세요.</p>
      <p><Link href="/private/brokers">증권사 목록으로</Link></p>
    </main>
  );
}
