import { currentWorkspace } from "../../../../../lib/require-workspace";
import { connectionReadiness } from "../../../../../lib/tiger-connection-policy";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control":"private, no-store, max-age=0",
  "Pragma":"no-cache","X-Robots-Tag":"noindex, nofollow, noarchive" };
export async function GET(): Promise<Response> {
  if (!await currentWorkspace()) return Response.json({error:"UNAUTHORIZED"},{status:401,headers});
  return Response.json(connectionReadiness(),{headers});
}
