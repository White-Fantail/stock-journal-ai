import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "../../auth";
import { currentWorkspace } from "../../lib/require-workspace";

export const dynamic = "force-dynamic";
export default async function WorkspaceHome() {
  const workspace = await currentWorkspace();
  if (!workspace) redirect("/login");
  return (
    <main>
      <h1>내 Stock Journal AI</h1>
      <p>개인 워크스페이스가 준비되었습니다.</p>
      <p>Google 로그인과 개인 워크스페이스를 사용 중입니다. 거래 원장은 별도의 보안 검증 후 활성화됩니다.</p>
      <p><Link href="/private/trades">내 거래 원장</Link> · <Link href="/private/journal">투자 일지·관심종목</Link> · <Link href="/private/settings">내보내기·계정 삭제</Link></p>
      <dl>
        <dt>워크스페이스 ID</dt><dd><code>{workspace.workspaceId}</code></dd>
        <dt>계정 권한</dt><dd>{workspace.role}</dd>
        <dt>브로커 연결</dt><dd>미연결 (COMING SOON)</dd>
      </dl>
      <p><Link href="/private/brokers">증권사 연동 준비 상태</Link></p>
      <form action={async () => {
        "use server";
        await signOut({redirectTo:"/login"});
      }}><button type="submit">로그아웃</button></form>
    </main>
  );
}
