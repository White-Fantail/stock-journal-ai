/** Pure and testable GitHub owner allowlist. No email/name-based access. */
export function isApprovedOwner(candidate: unknown, configuredId: string | undefined): boolean {
  if (typeof configuredId !== "string" || !/^[1-9][0-9]{0,19}$/.test(configuredId)) return false;
  if (typeof candidate !== "string" && typeof candidate !== "number") return false;
  if (typeof candidate === "number" && !Number.isSafeInteger(candidate)) return false;
  return String(candidate) === configuredId;
}

export type AuthConfig = Readonly<Record<string, string | undefined>>;

export function ownerAuthConfigured(env: AuthConfig): boolean {
  if (!isApprovedOwner(env.OWNER_GITHUB_ID, env.OWNER_GITHUB_ID)) return false;
  if (!env.AUTH_GITHUB_ID || !env.AUTH_GITHUB_SECRET) return false;
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) return false;
  if (!env.AUTH_URL) return false;
  try {
    const uri = new URL(env.AUTH_URL);
    return uri.protocol === "https:" && !!uri.hostname && !uri.username &&
      !uri.password && !uri.search && !uri.hash && uri.pathname === "/" &&
      uri.hostname !== "localhost" && uri.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}
