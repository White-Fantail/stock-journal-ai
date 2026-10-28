/** OAuth credentials for Positionary remote MCP. No secrets or credentials enter the browser bundle. */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const MCP_SCOPES = ["positionary:read", "positionary:write"] as const;
export type McpScope = typeof MCP_SCOPES[number];
export type TicketKind = "client" | "code" | "access" | "refresh";
export type Ticket = {
  kind: TicketKind; iat: number; exp: number; nonce: string;
  subject?: string; clientId?: string; redirectUri?: string;
  challenge?: string; scope?: string; redirectUris?: string[];
  clientName?: string;
};
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const subjectPattern = /^[0-9]{3,255}$/;
const pkcePattern = /^[A-Za-z0-9_-]{43}$/;

export function origin(): string {
  const url = new URL(process.env.AUTH_URL ?? "");
  if (!((url.protocol === "https:") ||
    (process.env.NODE_ENV === "development" && url.protocol === "http:" && url.hostname === "localhost")) ||
    url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("MCP_ORIGIN_UNAVAILABLE");
  return url.origin;
}
export function enabled(): boolean {
  return process.env.POSITIONARY_MCP_ENABLED === "1" &&
    !!process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 &&
    !!process.env.SAAS_INTERNAL_SECRET && process.env.SAAS_INTERNAL_SECRET.length >= 32;
}
function key(): Buffer {
  if (!enabled()) throw new Error("MCP_DISABLED");
  return createHmac("sha256", process.env.AUTH_SECRET!).update("positionary-mcp-ticket-v1").digest();
}
export function ticket(kind: TicketKind, values: Partial<Ticket>, lifetimeSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body: Ticket = { ...values, kind, iat: now, exp: now + lifetimeSeconds, nonce: randomUUID() };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const mac = createHmac("sha256", key()).update(payload).digest("base64url");
  return payload + "." + mac;
}
export function readTicket(value: unknown, kind: TicketKind): Ticket | null {
  if (typeof value !== "string" || value.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))
    return null;
  const [payload, mac] = value.split(".");
  const expected = createHmac("sha256", key()).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(mac, "base64url"); }
  catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let valueObj: unknown;
  try { valueObj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { return null; }
  if (!valueObj || typeof valueObj !== "object") return null;
  const t = valueObj as Ticket;
  const now = Math.floor(Date.now() / 1000);
  if (t.kind !== kind || !Number.isSafeInteger(t.iat) || !Number.isSafeInteger(t.exp) ||
    t.iat > now + 30 || t.exp <= now || t.exp - t.iat > 366 * 86400 || !uuid.test(t.nonce))
    return null;
  if (kind === "client") {
    if (!Array.isArray(t.redirectUris) || t.redirectUris.length < 1 ||
      t.redirectUris.length > 10 || !t.redirectUris.every(validRedirectUri)) return null;
  } else if (!subjectPattern.test(t.subject ?? "") || typeof t.clientId !== "string" ||
    typeof t.scope !== "string" || !validScopes(t.scope)) return null;
  if (kind === "code" && (!validRedirectUri(t.redirectUri) || !pkcePattern.test(t.challenge ?? ""))) return null;
  return t;
}
export function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 1024) return false;
  try {
    const u = new URL(raw);
    const dev = process.env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1"].includes(u.hostname);
    return !u.username && !u.password && !u.hash &&
      (u.protocol === "https:" || (dev && u.protocol === "http:")) &&
      u.hostname !== "" && !u.hostname.endsWith(".");
  } catch { return false; }
}
export function validScopes(raw: string): boolean {
  const items = raw.split(" ");
  return items.length >= 1 && items.length <= 2 &&
    new Set(items).size === items.length &&
    items.every(x => MCP_SCOPES.includes(x as McpScope)) &&
    (!items.includes("positionary:write") || items.includes("positionary:read"));
}
export function validateAuthorization(query: URLSearchParams): {
  clientId: string; redirectUri: string; scope: string; challenge: string; state: string;
} | null {
  const clientId = query.get("client_id") ?? "";
  const client = readTicket(clientId, "client");
  const redirectUri = query.get("redirect_uri") ?? "";
  const scope = query.get("scope") ?? "";
  const challenge = query.get("code_challenge") ?? "";
  const state = query.get("state") ?? "";
  if (!client || !client.redirectUris?.includes(redirectUri) ||
    query.get("response_type") !== "code" || query.get("code_challenge_method") !== "S256" ||
    !pkcePattern.test(challenge) || !validScopes(scope) ||
    !/^[\x21-\x7e]{8,512}$/.test(state) ||
    (query.get("resource") != null && query.get("resource") !== origin() + "/api/mcp")) return null;
  return { clientId, redirectUri, scope, challenge, state };
}
export function matchesPkce(verifier: unknown, challenge: string): boolean {
  return typeof verifier === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) &&
    createHash("sha256").update(verifier, "ascii").digest("base64url") === challenge;
}
