import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAppPrincipal } from "@/lib/auth/principal";
import { assertSensitiveActionAuthorized } from "@/lib/auth/sensitive-actions";
import { recordAuthAuditEvent } from "@/lib/audit/auth-audit-events";
import { buildAppUrl } from "@/lib/app-url";
import {
  authRateLimitResponse,
  checkStorageOAuthStartRateLimit,
} from "@/lib/auth-rate-limit";
import { GOOGLE_DRIVE_WRITE_SCOPE } from "@/lib/google-drive";
import {
  buildGoogleOAuthFlowCookie,
  GOOGLE_STORAGE_OAUTH_FLOW_COOKIE,
  GOOGLE_STORAGE_OAUTH_FLOW_TTL_MS,
} from "@/lib/storage/google-oauth-flow";

export async function GET(request: Request) {
  const principal = await requireAppPrincipal();

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    redirect("/setup?section=workspace&notice=Google+OAuth+credentials+are+missing+for+this+workspace.");
  }

  const url = new URL(request.url);
  const replaceRequested =
    url.searchParams.get("replace") === "1" ||
    url.searchParams.get("mode") === "replace";
  if (replaceRequested) {
    assertSensitiveActionAuthorized(principal, "storage.replace_connection", {
      provider: "google_drive",
      resourceType: "storage_connection",
    });
  }

  const rateLimit = checkStorageOAuthStartRateLimit(
    request,
    principal.legacyOwnerEmail,
  );
  if (rateLimit) {
    return authRateLimitResponse(rateLimit);
  }

  const state = crypto.randomUUID();
  const redirectUri = buildAppUrl("/api/storage/google/callback", request);
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email profile ${GOOGLE_DRIVE_WRITE_SCOPE}`,
    state,
  });

  const cookieStore = await cookies();
  cookieStore.set(
    GOOGLE_STORAGE_OAUTH_FLOW_COOKIE,
    buildGoogleOAuthFlowCookie({
      mode: replaceRequested ? "replace" : "connect",
      principal,
      state,
    }),
    {
      httpOnly: true,
      maxAge: GOOGLE_STORAGE_OAUTH_FLOW_TTL_MS / 1000,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );

  recordAuthAuditEvent({
    eventType: replaceRequested ? "storage.replace_start" : "storage.oauth.start",
    metadata: { mode: replaceRequested ? "replace" : "connect" },
    principal,
    provider: "google_drive",
    resourceType: "storage_connection",
    status: "succeeded",
  });

  redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
