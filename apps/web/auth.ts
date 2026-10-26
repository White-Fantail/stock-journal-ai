import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { googleIdentity } from "./lib/saas-auth-policy";
import { provisionGoogle } from "./lib/saas-api";
import { SESSION_MAX_AGE_SECONDS } from "./lib/auth-session-policy";

// App login is independent of Tiger authorization. No broker OAuth tokens are stored here.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  // Only trust forwarded hosts on Vercel or during local development.
  // Never rely on unvalidated forwarded hosts from arbitrary proxies.
  trustHost: process.env.VERCEL === "1" || process.env.NODE_ENV === "development",
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      const identity = googleIdentity(profile);
      if (!identity) return false;
      // Google-authenticated account creation is atomic in isolated Railway SaaS DB.
      return Boolean(await provisionGoogle(identity));
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "google") {
        const identity = googleIdentity(profile);
        if (identity) token.googleSubject = identity.subject;
        else delete token.googleSubject;
      }
      // Old GitHub owner JWTs cannot provide a Google subject.
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.googleSubject === "string" ? token.googleSubject : "";
      }
      return session;
    },
  },
});
