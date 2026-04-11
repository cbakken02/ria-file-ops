import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import {
  GOOGLE_DRIVE_READ_SCOPE,
  GOOGLE_DRIVE_WRITE_SCOPE,
} from "@/lib/google-drive";

async function refreshGoogleAccessToken(token: {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  grantedScopes?: string[];
}) {
  if (!token.refreshToken) {
    return {
      ...token,
      error: "MissingRefreshToken",
    };
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshed = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
    };

    if (!response.ok || !refreshed.access_token) {
      return {
        ...token,
        error: refreshed.error || "RefreshAccessTokenError",
      };
    }

    return {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt:
        typeof refreshed.expires_in === "number"
          ? Math.floor(Date.now() / 1000) + refreshed.expires_in
          : token.expiresAt,
      grantedScopes:
        typeof refreshed.scope === "string"
          ? refreshed.scope.split(" ")
          : token.grantedScopes,
      error: undefined,
    };
  } catch {
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

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
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken =
          account.refresh_token ??
          (typeof token.refreshToken === "string" ? token.refreshToken : undefined);
        token.expiresAt =
          typeof account.expires_at === "number" ? account.expires_at : undefined;
        token.grantedScopes =
          typeof account.scope === "string" ? account.scope.split(" ") : [];
        token.error = undefined;
      }

      if (
        typeof token.expiresAt === "number" &&
        Date.now() < (token.expiresAt - 60) * 1000
      ) {
        return token;
      }

      if (typeof token.expiresAt === "number") {
        return refreshGoogleAccessToken(token);
      }

      return token;
    },
    async session({ session, token }) {
      session.accessToken =
        typeof token.accessToken === "string" ? token.accessToken : undefined;
      session.grantedScopes = Array.isArray(token.grantedScopes)
        ? token.grantedScopes.filter(
            (scope): scope is string => typeof scope === "string",
          )
        : [];
      session.driveConnected =
        session.grantedScopes.includes(GOOGLE_DRIVE_READ_SCOPE) ||
        session.grantedScopes.includes(GOOGLE_DRIVE_WRITE_SCOPE);
      session.driveWritable = session.grantedScopes.includes(
        GOOGLE_DRIVE_WRITE_SCOPE,
      );
      session.authError = typeof token.error === "string" ? token.error : undefined;

      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      return session;
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}
