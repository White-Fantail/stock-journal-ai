/** Stateless Streamable HTTP MCP endpoint. Authentication is OAuth bearer only:
 * web cookies and caller-supplied Google subjects are intentionally ignored.
 */
import { enabled, origin, bearerSubject } from "../../../lib/positionary-mcp-auth";
import { toolsForScope, invokeTool } from "../../../lib/positionary-mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const protocol = "2025-06-18";
const responseHeaders = {
  "Cache-Control": "no-store",
  "MCP-Protocol-Version": protocol,
  "X-Content-Type-Options": "nosniff",
};
function jsonrpc(id: unknown, result?: unknown, error?: {code:number;message:string}) {
  return error ? {jsonrpc:"2.0", id, error} : {jsonrpc:"2.0", id, result};
}
function unauthenticated() {
  return Response.json({error:"unauthorized"}, {status:401,headers:{
    ...responseHeaders,
    "WWW-Authenticate": 'Bearer resource_metadata="' + origin() + '/.well-known/oauth-protected-resource/api/mcp"',
  }});
}
export async function POST(request: Request) {
  if (!enabled()) return new Response(null,{status:404});
  if (request.headers.get("origin") && request.headers.get("origin") !== origin())
    return new Response(null,{status:403,headers:responseHeaders});
  const actor = await bearerSubject(request.headers.get("authorization"));
  if (!actor) return unauthenticated();
  try {
    const raw = await request.text();
    if (raw.length > 32768) return Response.json(jsonrpc(null,undefined,{code:-32600,message:"Request too large"}),
      {status:413,headers:responseHeaders});
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("INVALID_JSONRPC");
    const msg = input as Record<string,unknown>;
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string" ||
        (msg.id !== undefined && typeof msg.id !== "string" && typeof msg.id !== "number"))
      throw new Error("INVALID_JSONRPC");
    if (msg.id === undefined) return new Response(null,{status:202,headers:responseHeaders});
    const id = msg.id;
    if (msg.method === "initialize") return Response.json(jsonrpc(id,{
      protocolVersion:protocol,capabilities:{tools:{listChanged:false}},
      serverInfo:{name:"Positionary",version:"1.0.0"},
      instructions:"User-authored investment records and owner-approved Tiger observation only. Broker orders, cancellation and fund transfers are NOT available. Ask the user to explicitly approve each write. Never treat unverified Tiger snapshots as audited financial facts.",
    }),{headers:responseHeaders});
    if (msg.method === "ping") return Response.json(jsonrpc(id,{}),{headers:responseHeaders});
    if (msg.method === "tools/list") return Response.json(jsonrpc(id,{
      tools:toolsForScope(actor.scope).map(t=>({
        name:t.name,description:t.description,inputSchema:t.inputSchema,
        annotations:{readOnlyHint:!t.write,destructiveHint:false,
          idempotentHint:false,openWorldHint:false},
      })),
    }),{headers:responseHeaders});
    if (msg.method === "tools/call") {
      const p = msg.params;
      if (!p || typeof p !== "object" || Array.isArray(p) ||
          typeof (p as {name?:unknown}).name !== "string")
        return Response.json(jsonrpc(id,undefined,{code:-32602,message:"Invalid tool parameters"}),
          {headers:responseHeaders});
      const params = p as {name:string;arguments?:unknown};
      try {
        const value = await invokeTool(actor.subject,actor.scope,params.name,params.arguments);
        return Response.json(jsonrpc(id,{content:[{type:"text",text:JSON.stringify(value)}]}),{headers:responseHeaders});
      } catch (error) {
        // Only fixed non-sensitive errors are exposed. Never reveal backend details.
        const message = error instanceof Error && /^(Tool unavailable or scope insufficient|Explicit user confirmation required|Unexpected tool arguments|A stable UUID idempotencyKey is required)$/.test(error.message)
          ? error.message : "Invalid input or authenticated account data unavailable";
        return Response.json(jsonrpc(id,{content:[{type:"text",text:message}],isError:true}),
          {headers:responseHeaders});
      }
    }
    return Response.json(jsonrpc(id,undefined,{code:-32601,message:"Method not found"}),{headers:responseHeaders});
  } catch {
    return Response.json(jsonrpc(null,undefined,{code:-32700,message:"Invalid JSON-RPC request"}),
      {status:400,headers:responseHeaders});
  }
}
export async function GET() {
  if (!enabled()) return new Response(null,{status:404});
  return new Response(null,{status:405,headers:{Allow:"POST",...responseHeaders}});
}
