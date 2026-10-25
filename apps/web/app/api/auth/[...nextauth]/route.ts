import type { NextRequest } from "next/server";
import { handlers } from "../../../../auth";
import { saasAuthConfigured } from "../../../../lib/saas-auth-policy";

function disabled(): Response {
  return new Response("Google sign-in is not yet configured.", {
    status: 503,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return saasAuthConfigured(process.env,process.env.NODE_ENV === "development") ?
    handlers.GET(request) : disabled();
}
export async function POST(request: NextRequest): Promise<Response> {
  return saasAuthConfigured(process.env,process.env.NODE_ENV === "development") ?
    handlers.POST(request) : disabled();
}
