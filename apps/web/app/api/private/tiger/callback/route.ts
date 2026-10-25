import { tigerCall, safeTigerRedirect } from "../../../../../lib/tiger-api";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  // Tiger redirects here with a one-use high entropy state. The backend binds
  // state to the currently Google-authenticated workspace and consumes it once.
  const query = new URL(request.url).searchParams;
  const code = query.get("code") || "";
  const state = query.get("state") || "";
  const scope = query.get("scope") || "";
  if (query.get("error") || !code || !state || !scope) {
    return Response.redirect(safeTigerRedirect("/private/tiger?error=denied"),303);
  }
  try {
    await tigerCall("callback", { code, state, scope });
    const response = Response.redirect(safeTigerRedirect("/private/tiger?linked=1"), 303);
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control","no-store");
    return response;
  } catch {
    const response = Response.redirect(safeTigerRedirect("/private/tiger?error=callback"),303);
    response.headers.set("Referrer-Policy","no-referrer");
    response.headers.set("Cache-Control","no-store");
    return response;
  }
}
