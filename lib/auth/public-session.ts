import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { hashSessionIdentifier } from "@/lib/auth/session-activity";

type PublicSessionToken = Pick<JWT, "appSessionCreatedAt" | "appSessionId" | "sub"> &
  Record<string, unknown>;

export function applyPublicSessionMetadata(
  session: Session,
  token: PublicSessionToken,
) {
  const publicSession = session as typeof session & Record<string, unknown>;
  delete publicSession.accessToken;
  delete publicSession.refreshToken;
  delete publicSession.authError;
  delete publicSession.driveConnected;
  delete publicSession.driveWritable;
  delete publicSession.grantedScopes;

  session.appSessionIdHash =
    typeof token.appSessionId === "string"
      ? hashSessionIdentifier(token.appSessionId)
      : undefined;
  session.appSessionCreatedAt =
    typeof token.appSessionCreatedAt === "number"
      ? new Date(token.appSessionCreatedAt).toISOString()
      : undefined;

  if (session.user && token.sub) {
    session.user.id = token.sub;
  }

  return session;
}
