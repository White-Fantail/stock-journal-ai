import { enabled, origin, MCP_SCOPES } from "../../../lib/positionary-mcp-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!enabled()) return new Response(null, { status: 404 });
  const issuer = origin();
  return Response.json({
    issuer,
    authorization_endpoint: issuer + "/mcp/authorize",
    token_endpoint: issuer + "/api/mcp/oauth/token",
    registration_endpoint: issuer + "/api/mcp/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: MCP_SCOPES,
    resource_indicators_supported: true,
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
