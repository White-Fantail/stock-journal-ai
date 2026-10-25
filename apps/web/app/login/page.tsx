import Link from "next/link";
import { signIn } from "../../auth";
import { saasAuthConfigured } from "../../lib/saas-auth-policy";

export const dynamic = "force-dynamic";
export default async function Login() {
  const enabled = saasAuthConfigured(process.env,process.env.NODE_ENV === "development");
  return (
    <main>
      <p><Link href="/">← Stock Journal AI</Link></p>
      <h1>로그인 또는 무료 계정 만들기</h1>
      <p>Google 계정으로 가입하면 나만의 비공개 투자일지가 생성됩니다.</p>
      {enabled ? (
        <form action={async () => {
          "use server";
          if (!saasAuthConfigured(process.env,process.env.NODE_ENV === "development")) {
            throw new Error("Sign-in unavailable");
          }
          await signIn("google", { redirectTo: "/private" });
        }}>
          <button type="submit" style={{padding:"0.9rem 1.4rem",fontSize:"1rem"}}>
            Google로 계속하기
          </button>
        </form>
      ) : (
        <p>Google 로그인을 설정 중입니다. 아직 회원가입은 활성화되지 않았습니다.</p>
      )}
      <p style={{color:"#666",fontSize:"0.875rem"}}>
        Google 로그인은 투자 계좌 연결과 별개입니다. 계좌 거래 권한은 요청하지 않습니다.
      </p>
    </main>
  );
}
