import { currentWorkspace } from "../../../../lib/require-workspace";

export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const headers = { "Cache-Control":"private, no-store, max-age=0",
    "Pragma":"no-cache","X-Robots-Tag":"noindex, nofollow, noarchive" };
  const workspace = await currentWorkspace();
  if (!workspace) return Response.json({error:"UNAUTHORIZED"},{status:401,headers});
  return Response.json({
    workspaceId: workspace.workspaceId,
    role: workspace.role,
    journal: "NOT_ENABLED",
    tigerConnection: "NOT_CONNECTED",
    currentPortfolio: "UNAVAILABLE",
  },{headers});
}
