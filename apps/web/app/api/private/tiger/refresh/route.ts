import {checkSameOrigin,tigerPersonalRefresh} from "../../../../../lib/tiger-api";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Content-Type":"application/json"};

export async function GET(){
  try {
    return Response.json(await tigerPersonalRefresh(),{headers});
  } catch {
    return Response.json({state:"UNAVAILABLE"},{status:503,headers});
  }
}

export async function POST(request:Request){
  if(!checkSameOrigin(request))
    return Response.json({state:"UNAVAILABLE"},{status:403,headers});
  try {
    // No account selector, arbitrary endpoint or request payload is accepted.
    if(request.headers.get("content-length") && Number(request.headers.get("content-length"))>0)
      return Response.json({state:"UNAVAILABLE"},{status:400,headers});
    return Response.json(await tigerPersonalRefresh(true),{headers});
  } catch {
    return Response.json({state:"UNAVAILABLE"},{status:503,headers});
  }
}
