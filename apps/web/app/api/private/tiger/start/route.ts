import { tigerCall, checkSameOrigin, safeTigerRedirect } from "../../../../../lib/tiger-api";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!checkSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  try {
    const result = await tigerCall("start") as { authorizationUrl?: string };
    const url = result?.authorizationUrl;
    if (!url || new URL(url).origin !== "https://openapi.tigerfintech.com" ||
      new URL(url).pathname !== "/oauth2/v1/authorize") throw new Error("INVALID_AUTH_URL");
    return Response.redirect(url, 303);
  } catch {
    return Response.redirect(safeTigerRedirect("/private/tiger?error=connect"),303);
  }
}
