import Link from "next/link";
import type { Metadata } from "next";
import { signIn } from "../../auth";
import { saasAuthConfigured } from "../../lib/saas-auth-policy";
import { PublicHeader, PublicFooter } from "../../components/site";

export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

export default async function Login({searchParams}: {searchParams: Promise<{deleted?:string}>}) {
  const enabled = saasAuthConfigured(process.env, process.env.NODE_ENV === "development");
  const {deleted} = await searchParams;
  return <>
    <PublicHeader />
    <main className="auth-screen"><div className="auth-card">
      <span className="pill">나만의 투자 기록 공간</span>
      <h1>Positionary에 오신 것을 환영합니다.</h1>
      <p>Google 계정으로 간편하게 시작하세요. 처음 로그인하면 개인 워크스페이스가 생성됩니다.</p>
      {deleted === "1" && <p role="status">계정 삭제 요청이 완료되었습니다.</p>}
      {enabled ? <form action={async () => {
        "use server";
        if (!saasAuthConfigured(process.env, process.env.NODE_ENV === "development")) {
          throw new Error("Sign-in unavailable");
        }
        await signIn("google", {redirectTo:"/private"});
      }}>
        <button className="btn btn-primary" type="submit"><span className="google-g" aria-hidden="true" style={{color:"white"}}>G</span> Google로 계속하기</button>
      </form> : <div className="info-strip"><div><strong>로그인 준비 중</strong><p>현재 Google 로그인을 사용할 수 없습니다. 설정이 완료되면 다시 시도할 수 있습니다.</p></div></div>}
      <hr className="divider"/>
      <small>Google 로그인은 증권사 계좌 인증과 별개입니다. 로그인만으로 거래 권한을 요청하거나 계좌를 연결하지 않습니다.</small>
      <small style={{marginTop:12}}>계속 진행하면 <Link href="/terms">이용 안내</Link> 및 <Link href="/privacy">개인정보 처리 안내</Link>를 확인할 수 있습니다.</small>
      <p style={{fontSize:".86rem",marginBottom:0}}><Link href="/">← 홈으로 돌아가기</Link></p>
    </div></main>
    <PublicFooter/>
  </>;
}
