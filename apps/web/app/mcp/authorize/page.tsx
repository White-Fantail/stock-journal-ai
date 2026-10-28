import { auth, signIn } from "../../auth";
import { resolveGoogleSubject } from "../../lib/saas-api";
import { enabled, origin, ticket, validateAuthorization } from "../../lib/positionary-mcp-auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Positionary 연결 승인" };

async function googleSignIn(form: FormData) {
  "use server";
  const raw = String(form.get("request") ?? "");
  if (!enabled() || raw.length > 8192 || !validateAuthorization(new URLSearchParams(raw)))
    throw new Error("Invalid authorization request");
  await signIn("google", { redirectTo: origin() + "/mcp/authorize?" + raw });
}
async function finishConsent(form: FormData) {
  "use server";
  const raw = String(form.get("request") ?? "");
  if (!enabled() || raw.length > 8192) throw new Error("MCP unavailable");
  const params = validateAuthorization(new URLSearchParams(raw));
  if (!params) throw new Error("Invalid authorization request");
  const session = await auth();
  const subject = session?.user?.id;
  if (!subject || !/^[0-9]{3,255}$/.test(subject) || !await resolveGoogleSubject(subject))
    throw new Error("Please sign in to Positionary");
  const callback = new URL(params.redirectUri);
  callback.searchParams.set("state", params.state);
  if (form.get("decision") !== "approve") {
    callback.searchParams.set("error", "access_denied");
  } else {
    const code = ticket("code", { subject, clientId: params.clientId,
      redirectUri: params.redirectUri, challenge: params.challenge, scope: params.scope }, 120);
    callback.searchParams.set("code", code);
  }
  redirect(callback.toString());
}

export default async function McpAuthorizePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!enabled()) return <main><h1>Positionary MCP는 비활성 상태입니다.</h1></main>;
  const data = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) if (typeof value === "string") query.set(key, value);
  const request = query.toString();
  const params = validateAuthorization(query);
  if (!params) return <main style={{ maxWidth: 560, margin: "60px auto", padding: 24 }}>
    <h1>잘못된 연결 요청</h1><p>OAuth 클라이언트, 콜백 주소, PKCE 또는 권한 범위가 유효하지 않습니다.</p>
  </main>;
  const session = await auth();
  const subject = session?.user?.id;
  const workspace = subject && /^[0-9]{3,255}$/.test(subject)
    ? await resolveGoogleSubject(subject) : null;
  return <main style={{ maxWidth: 560, margin: "60px auto", padding: 24 }}>
    <h1>Positionary MCP 연결</h1>
    <p>웹에서 사용하는 <strong>동일한 Google 계정</strong>으로 인증하며, 연결된 MCP 클라이언트는 해당 계정의 투자정보만 이용할 수 있습니다.</p>
    {!workspace ? <form action={googleSignIn}>
      <input type="hidden" name="request" value={request}/>
      <button type="submit" className="btn btn-primary">Google 로그인 후 계속</button>
    </form> : <>
      <p>로그인된 계정: <strong>{session?.user?.email}</strong></p>
      <section className="state-panel">
        <h2>접근 권한 승인</h2>
        <p><strong>조회:</strong> 계좌 자산·보유 종목의 관측 스냅샷, 투자계획, 투자일지 및 투자 기록</p>
        {params.scope.includes("positionary:write") && <p><strong>수정:</strong> 투자계획, 투자일지, 직접 입력한 거래, 보조지표 등 사용자 작성 기록을 추가하거나 버전을 갱신합니다.</p>}
        <p>증권사 주문·취소·이체 권한은 제공하지 않습니다. Tiger 조회값은 완전성이 검증되지 않은 관측정보일 수 있습니다.</p>
        <p>15분짜리 접근 토큰과 최대 7일의 갱신 토큰을 부여합니다. 비밀번호와 Tiger 개인키는 MCP 클라이언트에 전달하지 않습니다.</p>
        <form action={finishConsent}>
          <input type="hidden" name="request" value={request}/>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button name="decision" value="approve" type="submit" className="btn btn-primary">접근 허용</button>
            <button name="decision" value="deny" type="submit" className="btn btn-outline">거부</button>
          </div>
        </form>
      </section>
    </>}
  </main>;
}
