import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { auth } from "../auth";
import { currentWorkspace } from "./require-workspace";
import { saasAuthConfigured } from "./saas-auth-policy";

export type TigerConnection = { id: string; status: string; expiresAt: string | null; lastSuccessAt: string | null };
export type TigerAccount = { id: string; connectionId: string; alias: string };
export type TigerStatus = { provider: "TIGER"; enabled: boolean; connections: TigerConnection[]; accounts: TigerAccount[] };
export type TigerAction = "status" | "start" | "callback" | "bind" | "read" | "disconnect";

async function subjectForRequest(): Promise<string> {
  const [session, scope] = await Promise.all([auth(), currentWorkspace()]);
  const subject = session?.user?.id;
  if (!scope || !subject || !/^[0-9]{3,255}$/.test(subject))
    throw new Error("UNAUTHORIZED");
  return subject;
}

/** Gateway body is fixed by the server: never accept tenant/URL/token from browser. */
export async function tigerCall(action: TigerAction, extra: Record<string,string> = {}): Promise<unknown> {
  const env = process.env;
  if (!saasAuthConfigured(env, env.NODE_ENV === "development"))
    throw new Error("NOT_CONFIGURED");
  const subject = await subjectForRequest();
  const path = "/internal/v1/tiger/" + action;
  const body = JSON.stringify({ subject, ...extra });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac("sha256", env.SAAS_INTERNAL_SECRET!)
    .update(timestamp + "\n" + nonce + "\nPOST\n" + path + "\n" + body).digest("hex");
  const response = await fetch(new URL(path, env.SAAS_INTERNAL_API_URL), {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(14000),
    headers: { "Content-Type": "application/json", "X-Saas-Timestamp": timestamp,
      "X-Saas-Nonce": nonce, "X-Saas-Signature": signature }, body,
  });
  if (!response.ok) throw new Error("TIGER_" + response.status);
  return response.json();
}

export async function tigerStatus(): Promise<TigerStatus> {
  const value = await tigerCall("status") as TigerStatus;
  if (!value || value.provider !== "TIGER" || !Array.isArray(value.connections) || !Array.isArray(value.accounts))
    throw new Error("INVALID_TIGER_STATUS");
  return value;
}

export function checkSameOrigin(request: Request): boolean {
  const expected = process.env.AUTH_URL;
  const origin = request.headers.get("origin");
  if (!expected || !origin) return false;
  try {
    return new URL(expected).origin === origin &&
      new URL(request.url).origin === origin;
  } catch { return false; }
}

export function safeTigerRedirect(path: string): URL {
  const base = process.env.AUTH_URL;
  if (!base || new URL(base).protocol !== "https:") throw new Error("AUTH_URL_REQUIRED");
  return new URL(path, base);
}
