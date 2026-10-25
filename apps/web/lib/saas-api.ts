import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { saasAuthConfigured } from "./saas-auth-policy";

type Workspace = { userId: string; workspaceId: string; role: "OWNER" };

async function internalPost(path: "/internal/v1/provision" | "/internal/v1/resolve",
                            payload: object): Promise<Workspace | null> {
  const env = process.env;
  if (!saasAuthConfigured(env, env.NODE_ENV === "development")) return null;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac("sha256", env.SAAS_INTERNAL_SECRET!)
    .update(`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`).digest("hex");
  try {
    const response = await fetch(new URL(path, env.SAAS_INTERNAL_API_URL), {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json",
        "X-Saas-Timestamp": timestamp, "X-Saas-Nonce": nonce, "X-Saas-Signature": signature },
      body,
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") return null;
    const result = data as Record<string, unknown>;
    if (typeof result.userId !== "string" || typeof result.workspaceId !== "string" ||
        result.role !== "OWNER" ||
        !/^[0-9a-f-]{36}$/i.test(result.userId) ||
        !/^[0-9a-f-]{36}$/i.test(result.workspaceId)) return null;
    return { userId: result.userId, workspaceId: result.workspaceId, role: "OWNER" };
  } catch {
    return null; // database/backend outage fails closed, never mock an account
  }
}

export async function provisionGoogle(claims: {
  subject: string; email: string; name: string; email_verified: true
}): Promise<Workspace | null> {
  return internalPost("/internal/v1/provision", claims);
}

export async function resolveGoogleSubject(subject: string): Promise<Workspace | null> {
  return internalPost("/internal/v1/resolve", { subject });
}
