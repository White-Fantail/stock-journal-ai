import { enabled, origin, readTicket, matchesPkce, consumeOneUse, accessGrant } from "../../../../lib/positionary-mcp-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Pragma": "no-cache" };
function failure(error: string, status=400) {
  return Response.json({ error }, { status, headers });
}
export async function POST(request: Request) {
  if (!enabled()) return failure("temporarily_unavailable", 503);
  try {
    const raw = await request.text();
    if (raw.length > 8192) return failure("invalid_request");
    const form = new URLSearchParams(raw);
    const clientId = form.get("client_id") ?? "";
    if (!readTicket(clientId, "client")) return failure("invalid_client", 401);
    if (form.get("client_secret")) return failure("invalid_client", 401);
    if (form.get("resource") && form.get("resource") !== origin() + "/api/mcp")
      return failure("invalid_target");
    const grantType = form.get("grant_type");
    if (grantType === "authorization_code") {
      const code = readTicket(form.get("code"), "code");
      if (!code || code.clientId !== clientId ||
          code.redirectUri !== form.get("redirect_uri") ||
          !matchesPkce(form.get("code_verifier"), code.challenge!))
        return failure("invalid_grant");
      // The signed code nonce is inserted atomically into the existing DB-backed
      // replay table and resolves fresh Google subject membership. Fail closed.
      if (!await consumeOneUse(code.subject!, code.nonce, code.exp)) return failure("invalid_grant");
      return Response.json(accessGrant(code.subject!, clientId, code.scope!), { headers });
    }
    if (grantType === "refresh_token") {
      const refresh = readTicket(form.get("refresh_token"), "refresh");
      if (!refresh || refresh.clientId !== clientId) return failure("invalid_grant");
      if (!await consumeOneUse(refresh.subject!, refresh.nonce, refresh.exp)) return failure("invalid_grant");
      return Response.json(accessGrant(refresh.subject!, clientId, refresh.scope!), { headers });
    }
    return failure("unsupported_grant_type");
  } catch {
    return failure("invalid_request");
  }
}
