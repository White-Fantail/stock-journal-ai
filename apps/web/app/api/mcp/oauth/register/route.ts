import { enabled, origin, ticket, validRedirectUri } from "../../../../lib/positionary-mcp-auth";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
export async function POST(request: Request) {
  if (!enabled()) return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: noStore });
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw new Error("oversize");
    const payload: unknown = JSON.parse(raw);
    if (!payload || typeof payload !== "object") throw new Error("invalid");
    const p = payload as Record<string, unknown>;
    if (!Array.isArray(p.redirect_uris) || p.redirect_uris.length < 1 || p.redirect_uris.length > 10 ||
      !p.redirect_uris.every(validRedirectUri) || new Set(p.redirect_uris).size !== p.redirect_uris.length ||
      (p.token_endpoint_auth_method !== undefined && p.token_endpoint_auth_method !== "none") ||
      (p.grant_types !== undefined &&
        (!Array.isArray(p.grant_types) || !p.grant_types.includes("authorization_code"))) ||
      (p.response_types !== undefined &&
        (!Array.isArray(p.response_types) || !p.response_types.includes("code"))) ||
      (p.client_name !== undefined && (typeof p.client_name !== "string" || p.client_name.length > 120))
    ) throw new Error("invalid");
    const redirectUris = p.redirect_uris as string[];
    const name = typeof p.client_name === "string" ? p.client_name : "MCP client";
    const clientId = ticket("client", { redirectUris, clientName: name }, 365 * 86400);
    return Response.json({
      client_id: clientId, client_name: name, client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0, redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "positionary:read positionary:write",
    }, { status: 201, headers: noStore });
  } catch {
    return Response.json({ error: "invalid_client_metadata" }, { status: 400, headers: noStore });
  }
}
