/** Server-side OAuth exchanges and fresh workspace membership check. */
import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { resolveGoogleSubject } from "./saas-api";
import { ticket, readTicket, enabled, uuid, subjectPattern } from "./positionary-mcp-crypto";
export { MCP_SCOPES, origin, enabled, ticket, readTicket, validRedirectUri, validScopes, validateAuthorization, matchesPkce } from "./positionary-mcp-crypto";

/** Require an independently authenticated Railway API to atomically consume each
 * OAuth code or refresh token until its absolute expiry. A short-lived request
 * nonce is separate from the durable MCP grant nonce; refresh reuse is denied
 * even after the ordinary two-minute request nonce housekeeping interval. */
export async function consumeOneUse(subject: string, tokenNonce: string, exp: number): Promise<boolean> {
  if (!subjectPattern.test(subject) || !uuid.test(tokenNonce) ||
    !Number.isSafeInteger(exp) || exp <= Math.floor(Date.now()/1000)) return false;
  const path = "/internal/v1/mcp/consume";
  const body = JSON.stringify({ subject, tokenNonce, expiresAt: exp });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestNonce = randomUUID();
  const signature = createHmac("sha256", process.env.SAAS_INTERNAL_SECRET!)
    .update(timestamp + "\n" + requestNonce + "\nPOST\n" + path + "\n" + body).digest("hex");
  try {
    const res = await fetch(new URL(path, process.env.SAAS_INTERNAL_API_URL), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", "X-Saas-Timestamp": timestamp,
        "X-Saas-Nonce": requestNonce, "X-Saas-Signature": signature }, body
    });
    return res.ok;
  } catch { return false; }
}

export async function activeSubject(subject: string): Promise<boolean> {
  return !!(subjectPattern.test(subject) && await resolveGoogleSubject(subject));
}
export function accessGrant(subject: string, clientId: string, scope: string) {
  return {
    access_token: ticket("access", { subject, clientId, scope }, 900),
    token_type: "Bearer" as const, expires_in: 900, scope,
    refresh_token: ticket("refresh", { subject, clientId, scope }, 7 * 86400),
  };
}
export async function bearerSubject(header: string | null): Promise<{subject: string; scope: string} | null> {
  if (!enabled() || !header || !/^Bearer [A-Za-z0-9_.-]{1,4096}$/.test(header)) return null;
  const granted = readTicket(header.slice(7), "access");
  if (!granted || !await activeSubject(granted.subject!)) return null;
  return { subject: granted.subject!, scope: granted.scope! };
}
