import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAppPrincipal } from "@/lib/auth/principal";
import { recordAuthAuditEvent } from "@/lib/audit/auth-audit-events";
import { buildAppUrl } from "@/lib/app-url";
import { GOOGLE_DRIVE_WRITE_SCOPE } from "@/lib/google-drive";

export async function GET(request: Request) {
  const principal = await requireAppPrincipal();

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    redirect("/setup?section=workspace&notice=Google+OAuth+credentials+are+missing+for+this+workspace.");
  }

  const url = new URL(request.url);
  const replaceRequested =
    url.searchParams.get("replace") === "1" ||
    url.searchParams.get("mode") === "replace";
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
  cookieStore.set("storage_google_oauth_flow", buildGoogleOAuthFlowCookie({
    mode: replaceRequested ? "replace" : "connect",
    state,
  }), {
    httpOnly: true,
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

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

function buildGoogleOAuthFlowCookie(input: {
  mode: "connect" | "replace";
  state: string;
}) {
  return `${input.state}:${input.mode}`;
}
