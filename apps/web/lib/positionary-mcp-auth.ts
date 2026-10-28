/** Server-side OAuth exchanges and fresh workspace membership check. */
import "server-only";
import { createHmac } from "node:crypto";
import { resolveGoogleSubject } from "./saas-api";
import { ticket, readTicket, enabled, uuid, subjectPattern } from "./positionary-mcp-crypto";
export { MCP_SCOPES, origin, enabled, ticket, readTicket, validRedirectUri, validScopes, validateAuthorization, matchesPkce } from "./positionary-mcp-crypto";

/** Reuse the existing atomically consumed Railway HMAC nonce table to prevent
 * authorization-code and refresh-token replay across all Vercel instances.
 * The nonce is the ticket's server-generated UUID, never client supplied. */
export async function consumeOneUse(subject: string, nonce: string): Promise<boolean> {
  if (!subjectPattern.test(subject) || !uuid.test(nonce)) return false;
  const path = "/internal/v1/resolve";
  const body = JSON.stringify({ subject });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", process.env.SAAS_INTERNAL_SECRET!)
    .update(timestamp + "\n" + nonce + "\nPOST\n" + path + "\n" + body).digest("hex");
  try {
    const res = await fetch(new URL(path, process.env.SAAS_INTERNAL_API_URL), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", "X-Saas-Timestamp": timestamp,
        "X-Saas-Nonce": nonce, "X-Saas-Signature": signature }, body
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
