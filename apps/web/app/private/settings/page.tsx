import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "../../../auth";
import { currentWorkspace } from "../../../lib/require-workspace";
import { deleteMyAccount } from "../../../lib/saas-trades-api";

export const dynamic="force-dynamic";
async function removeMyAccount(form:FormData) {
  "use server";
  const [session,workspace] = await Promise.all([auth(),currentWorkspace()]);
  if(!workspace || !session?.user?.id) redirect("/login");
  if(form.get("confirm")!=="DELETE_MY_ACCOUNT") redirect("/private/settings?error=confirm");
  try {
    await deleteMyAccount(session.user.id, "DELETE_MY_ACCOUNT");
  }catch{
    redirect("/private/settings?error=blocked");
  }
  await signOut({redirectTo:"/login?deleted=1"});
}
export default async function SettingsPage({
  searchParams,
}: { searchParams:Promise<{error?:string}> }) {
  if(!await currentWorkspace()) redirect("/login");
  const params=await searchParams;
  return <main style={{maxWidth:720,margin:"2rem auto",padding:"0 1rem"}}>
    <p><Link href="/private">← 워크스페이스</Link></p>
    <h1>데이터 내보내기 및 계정 삭제</h1>
    <p>사용자가 기록한 거래와 투자 일지를 JSON 파일로 내보낼 수 있습니다. 브로커 API 연동 정보는 포함하지 않습니다.</p>
    <p><Link href="/api/private/journal/export">내 거래·투자 일지 JSON 내보내기</Link></p>
    <h2>계정 삭제</h2>
    <p>실행하면 이 계정의 거래와 투자 일지, 관심종목 이력 및 워크스페이스 데이터를 삭제합니다. 복구할 수 없으며 백업 보존 기간에 따라 사본이 남을 수 있습니다. 브로커 인증이 연결돼 있으면 삭제 전에 연결을 해제해야 합니다.</p>
    {params.error && <p role="alert">삭제를 완료하지 못했습니다. 확인 문구나 연결된 브로커 상태를 확인하세요.</p>}
    <form action={removeMyAccount} style={{display:"grid",gap:12}}>
      <label>삭제하려면 DELETE_MY_ACCOUNT 입력 <input required name="confirm" autoComplete="off"/></label>
      <button type="submit">내 계정과 데이터 영구 삭제</button>
    </form>
  </main>;
}
