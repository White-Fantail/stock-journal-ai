/** Pure startup and Google identity policy, no mutable email-based authorization. */
export type EnvMap = Readonly<Record<string, string | undefined>>;

function validOrigin(raw: string | undefined, allowLocal: boolean): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const local = allowLocal && ["localhost","127.0.0.1"].includes(url.hostname);
    return (url.protocol === "https:" || (local && url.protocol === "http:")) &&
      !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === "/" && !!url.hostname;
  } catch {
    return false;
  }
}

export function googleIdentity(profile: unknown): {
  subject: string; email: string; name: string; email_verified: true
} | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  // Google subject is immutable for this OAuth client; never use email as account key.
  if (p.email_verified !== true || typeof p.sub !== "string" ||
      !/^[0-9]{3,255}$/.test(p.sub) ||
      typeof p.email !== "string" ||
      p.email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(p.email)) return null;
  return { subject: p.sub, email: p.email, name: typeof p.name === "string" ? p.name : "",
           email_verified: true };
}

export function saasAuthConfigured(env: EnvMap, allowLocal = false): boolean {
  return Boolean(env.AUTH_GOOGLE_ID?.trim() && env.AUTH_GOOGLE_SECRET?.trim() &&
    env.AUTH_SECRET && env.AUTH_SECRET.length >= 32 &&
    env.SAAS_INTERNAL_SECRET && env.SAAS_INTERNAL_SECRET.length >= 32 &&
    validOrigin(env.AUTH_URL,allowLocal) &&
    validOrigin(env.SAAS_INTERNAL_API_URL,allowLocal));
}
