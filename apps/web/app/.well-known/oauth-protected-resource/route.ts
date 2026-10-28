import { enabled, origin, MCP_SCOPES } from "../../../lib/positionary-mcp-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!enabled()) return new Response(null, { status: 404 });
  const issuer = origin();
  return Response.json({
    resource: issuer + "/api/mcp",
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: MCP_SCOPES,
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
