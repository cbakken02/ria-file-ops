import crypto from "node:crypto";
import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { recordAuthAuditEvent } from "@/lib/audit/auth-audit-events";
import { applyPublicSessionMetadata } from "@/lib/auth/public-session";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "openid email profile",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (typeof token.appSessionId !== "string") {
        token.appSessionId = crypto.randomUUID();
      }

      if (typeof token.appSessionCreatedAt !== "number") {
        token.appSessionCreatedAt = Date.now();
      }

      if (account) {
        recordAuthAuditEvent({
          actorEmail: typeof token.email === "string" ? token.email : null,
          eventType: "auth.login",
          metadata: { provider: account.provider },
          provider: account.provider,
          resourceType: "app_session",
          status: "succeeded",
        });
      }

      return token;
    },
    async session({ session, token }) {
      return applyPublicSessionMetadata(session, token);
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}
