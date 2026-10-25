import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth, signOut } from "../../../auth";
import { currentWorkspace } from "../../../lib/require-workspace";
import { deleteMyAccount, manualTradeEnabled } from "../../../lib/saas-trades-api";

export const metadata: Metadata = {title:"계정 설정"};
export const dynamic="force-dynamic";

async function removeMyAccount(form:FormData) {
  "use server";
  if (!manualTradeEnabled()) redirect("/private/settings?error=unavailable");
  const [session,workspace] = await Promise.all([auth(),currentWorkspace()]);
  if(!workspace || !session?.user?.id) redirect("/login");
  if(form.get("confirm")!=="DELETE_MY_ACCOUNT") redirect("/private/settings?error=confirm");
  try {await deleteMyAccount(session.user.id,"DELETE_MY_ACCOUNT");}
  catch {redirect("/private/settings?error=blocked");}
  await signOut({redirectTo:"/login?deleted=1"});
}
export default async function SettingsPage({searchParams}: {searchParams:Promise<{error?:string}>}) {
  if(!await currentWorkspace()) redirect("/login");
  const params=await searchParams;
  const enabled=manualTradeEnabled();
  return <main>
    <div className="page-intro"><span className="breadcrumb"><Link href="/private">← 대시보드</Link></span>
      <h1>내 계정과 데이터</h1>
      <p>개인 투자 기록은 내 워크스페이스에 속합니다. 데이터 내보내기와 삭제 기능의 현재 제공 상태를 확인하세요.</p></div>
    <section className="state-panel"><h2>데이터 내보내기</h2>
      <p>지원되는 경우 내가 작성한 거래·투자 일지 데이터를 JSON 파일로 받을 수 있습니다. 증권사 인증 정보는 포함되지 않습니다.</p>
      {enabled ? <Link className="btn btn-outline" href="/api/private/journal/export">기록 내보내기 →</Link>
        : <><span className="pill pill-neutral">운영 검증 중</span><p className="subtle">데이터 내보내기는 보안 검증 이후 이용할 수 있습니다.</p></>}
    </section>
    <section className="state-panel"><h2>증권사 연결 관리</h2>
      <p>연결된 증권사가 있다면 계정 삭제 전 연결 해제가 필요합니다.</p>
      <Link href="/private/brokers" className="btn btn-outline">증권사 연결 보기 →</Link>
    </section>
    <section className="state-panel"><h2>계정 삭제</h2>
      <p>삭제 시 내 계정에 속한 거래 기록, 투자 일지, 관심종목 이력과 워크스페이스 데이터 삭제를 요청합니다. 복구할 수 없으며 백업 사본은 정책에 따라 일정 기간 남을 수 있습니다.</p>
      {params.error && <p role="alert">삭제 요청을 완료할 수 없었습니다. 현재 기능 제공 상태와 확인 문구 및 증권사 연결 여부를 확인해 주세요.</p>}
      {enabled ? <form action={removeMyAccount} style={{display:"grid",gap:14,maxWidth:450}}>
        <label>삭제를 확인하려면 DELETE_MY_ACCOUNT 입력<input required name="confirm" autoComplete="off"/></label>
        <button type="submit" className="btn btn-outline">내 계정과 데이터 영구 삭제</button>
      </form> : <><span className="pill pill-neutral">운영 검증 중</span>
        <p className="subtle">셀프서비스 삭제는 현재 비활성화되어 있습니다. 정식 운영 전 개인정보 처리 및 지원 요청 절차를 확정할 예정입니다.</p></>}
    </section>
    <p className="subtle">서비스의 데이터 처리 원칙은 <Link href="/privacy">개인정보 처리 안내</Link>에서 확인할 수 있습니다.</p>
  </main>;
}
