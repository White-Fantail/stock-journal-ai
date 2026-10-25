import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { currentWorkspace } from "../../../../../lib/require-workspace";
import { exportFullJournal, manualTradeEnabled } from "../../../../../lib/saas-trades-api";

export const dynamic = "force-dynamic";
export async function GET() {
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  if(!workspace || !session?.user?.id) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  if(!manualTradeEnabled()) return NextResponse.json({error:"NOT_ENABLED"},{status:503});
  try {
    const data=await exportFullJournal(session.user.id);
    return new Response(JSON.stringify(data), {status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Content-Disposition":'attachment; filename="stock-journal-export.json"',
      "Cache-Control":"private, no-store, max-age=0",
      "X-Content-Type-Options":"nosniff",
    }});
  }catch{
    return NextResponse.json({error:"EXPORT_NOT_AVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
