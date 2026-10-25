import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentWorkspace } from "../../../lib/require-workspace";
import { tigerStatus, type TigerStatus } from "../../../lib/tiger-api";

export const metadata: Metadata = {title:"Tiger Brokers 연결"};
export const dynamic = "force-dynamic";

export default async function TigerConnections() {
  if (!await currentWorkspace()) redirect("/login");
  let state: TigerStatus | null = null;
  try {state=await tigerStatus();} catch { /* No invented connected state. */ }
  return <main>
    <div className="page-intro"><span className="breadcrumb"><Link href="/private/brokers">← 증권사 목록</Link></span>
      <h1>Tiger Brokers 계좌 연결</h1>
      <p>Tiger 공식 인증으로 계좌 조회 권한을 승인하는 방식입니다. 현재 앱 승인을 준비하고 있으며, 승인되지 않은 권한으로 계좌에 접근하지 않습니다.</p></div>
    <div className="state-panel">
      <span className={!state ? "pill pill-neutral" : state.enabled ? "pill" : "pill pill-warning"}>{!state ? "상태 확인 필요" : state.enabled ? "연결 설정 활성화" : "공식 승인 준비 중"}</span>
      <h2 style={{marginTop:17}}>{!state ? "연동 상태를 불러오지 못했습니다." : state.enabled ? "Tiger 공식 인증으로 연결하세요." : "Tiger 연동을 준비하고 있습니다."}</h2>
      <p>{!state ? "연동 서버에 일시적으로 접근할 수 없습니다. 연결 여부를 단정할 수 없으니 나중에 다시 확인해 주세요." : state.enabled ? "아래 버튼을 누르면 Tiger 공식 로그인·권한 동의 페이지로 이동합니다. 연결 후 접근이 허용된 계좌만 추가할 수 있습니다." : "Tiger 제3자 앱 승인, 조회 전용 권한 검증과 보안 설정이 끝난 뒤 이 화면에서 연결할 수 있습니다."}</p>
      <div className="connection-steps">
        <div className="connection-step">1 · 연결 시작<small>Tiger 공식 인증 페이지로 이동</small></div>
        <div className="connection-step">2 · 권한 동의<small>허용 범위를 확인하고 동의</small></div>
        <div className="connection-step">3 · 계좌 조회<small>승인된 범위 안에서 계좌 확인</small></div>
      </div>
      {state?.enabled ? <form action="/api/private/tiger/start" method="post">
        <button type="submit" className="btn btn-primary">Tiger 공식 인증 시작 →</button>
      </form> : <button type="button" className="btn btn-muted" disabled>승인 후 연결할 수 있습니다</button>}
    </div>
    {!!state?.connections.length && <div className="dashboard-heading"><h2>연결된 인증</h2></div>}
    {state?.connections.map(connection=><section className="state-panel" key={connection.id}>
      <h2>연결 상태 · {connection.status === "CONNECTED" ? "연결됨" : connection.status}</h2>
      {connection.expiresAt && <p>인증 만료 예정: {connection.expiresAt}</p>}
      {connection.lastSuccessAt && <p>마지막 조회 성공: {connection.lastSuccessAt}</p>}
      {connection.status === "CONNECTED" && state.enabled && <form action="/api/private/tiger/account" method="post" style={{maxWidth:480,display:"grid",gap:10}}>
        <input name="action" type="hidden" value="bind"/>
        <input name="connectionId" type="hidden" value={connection.id}/>
        <label htmlFor={"account-"+connection.id}>Tiger 계좌번호
          <input id={"account-"+connection.id} name="accountNumber" pattern="[A-Za-z0-9]{5,25}" autoComplete="off" maxLength={25} required/>
        </label>
        <small>해당 계좌의 조회 권한을 확인하는 데 사용하며, 계좌번호는 암호화해 저장합니다.</small>
        <button type="submit" className="btn btn-primary">조회 권한 확인 후 계좌 추가</button>
      </form>}
      <hr className="divider"/>
      <form action="/api/private/tiger/account" method="post">
        <input name="action" type="hidden" value="disconnect"/>
        <input name="connectionId" type="hidden" value={connection.id}/>
        <button type="submit" className="btn btn-outline">이 연결 해제</button>
      </form>
    </section>)}
    {!!state?.accounts.length && <div className="dashboard-heading"><h2>계좌 조회</h2></div>}
    {state?.accounts.filter(a=>state!.connections.some(c=>c.id===a.connectionId && c.status==="CONNECTED")).map(account=><section className="state-panel" key={account.id}>
      <h2>{account.alias}</h2>
      <p>현재 보유 자산 스냅샷을 조회할 수 있습니다. 모든 과거 체결내역 복원이 완료되었다는 뜻은 아닙니다.</p>
      <form action="/api/private/tiger/account" method="post">
        <input name="action" type="hidden" value="read"/>
        <input name="accountId" type="hidden" value={account.id}/>
        <button type="submit" className="btn btn-primary" disabled={!state?.enabled}>자산·포지션 새로 조회</button>
      </form>
    </section>)}
    <div className="info-strip"><span aria-hidden="true">ⓘ</span><div><strong>조회 전용 연결 안내</strong>
      <p>Positionary는 현재 주문·취소·이체를 지원하지 않습니다. 계좌 비밀번호나 개인 API 키를 입력하지 마세요. 연결 해제 시 앱의 토큰을 삭제하고 Tiger에 철회를 요청하며, 원격 철회 실패 시 Tiger 개발자 센터에서 직접 철회해야 합니다.</p></div></div>
  </main>;
}
