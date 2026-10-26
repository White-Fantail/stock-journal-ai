import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "../../../../../auth";
import { currentWorkspace } from "../../../../../lib/require-workspace";

export const dynamic="force-dynamic";
export default async function PilotSetup() {
  const membership=await currentWorkspace();
  if (!membership) redirect("/login");
  const session=await auth();
  if (!session?.user?.id) redirect("/login");
  return <main className="state-panel">
    <h1>Tiger 개인 테스트 · 본인 확인</h1>
    <p>Google 계정으로 확인된 내 고유 식별자입니다. 개인 테스트 연결 대상 확인에만 사용합니다.</p>
    <p><code>{session.user.id}</code></p>
    <p>개인 Tiger 인증키는 이 페이지에 입력하지 않습니다.</p>
    <Link href="/private/tiger/personal">← 개인 테스트로 돌아가기</Link>
  </main>;
}
