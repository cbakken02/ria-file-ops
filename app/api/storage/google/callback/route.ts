import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLegacyOwnerEmail, requireAppPrincipal } from "@/lib/auth/principal";
import { recordAuthAuditEvent } from "@/lib/audit/auth-audit-events";
import { buildAppUrl } from "@/lib/app-url";
import {
  getPrimaryStorageConnectionByOwnerEmail,
  saveStorageConnectionForOwner,
} from "@/lib/db";
import { resolveStorageOAuthConnectionDecision } from "@/lib/storage-connections";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

type GoogleUserInfo = {
  email?: string;
  name?: string;
  picture?: string;
  sub?: string;
};

export async function GET(request: Request) {
  const principal = await requireAppPrincipal();
  const ownerEmail = getLegacyOwnerEmail(principal);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieStore = await cookies();
  const savedFlow = parseGoogleOAuthFlowCookie(
    cookieStore.get("storage_google_oauth_flow")?.value,
  );
  cookieStore.delete("storage_google_oauth_flow");
  // Clear legacy split-flow cookies if an older browser session still has them.
  cookieStore.delete("storage_google_oauth_state");
  cookieStore.delete("storage_google_oauth_mode");

  if (error) {
    recordAuthAuditEvent({
      eventType: "storage.oauth.callback_denied",
      metadata: { providerError: error },
      principal,
      provider: "google_drive",
      reason: "provider_error",
      resourceType: "storage_connection",
      status: "denied",
    });
    redirect(
      `/setup?section=workspace&notice=${encodeURIComponent(
        `Google returned an authorization error: ${error}.`,
      )}`,
    );
  }

  if (!code || !state || !savedFlow || state !== savedFlow.state) {
    recordAuthAuditEvent({
      eventType: "storage.oauth.callback_denied",
      metadata: {
        hasCode: Boolean(code),
        hasCookieFlow: Boolean(savedFlow),
        hasState: Boolean(state),
        mode: savedFlow?.mode ?? null,
      },
      principal,
      provider: "google_drive",
      reason: "invalid_state",
      resourceType: "storage_connection",
      status: "denied",
    });
    redirect("/setup?section=workspace&notice=The+storage+connection+flow+could+not+be+verified.");
  }

  const redirectUri = buildAppUrl("/api/storage/google/callback", request);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const tokenJson = (await tokenResponse.json()) as GoogleTokenResponse;

  if (!tokenResponse.ok || !tokenJson.access_token) {
    recordAuthAuditEvent({
      eventType: "storage.oauth.callback_denied",
      metadata: { mode: savedFlow.mode, tokenStatus: tokenResponse.status },
      principal,
      provider: "google_drive",
      reason: "token_exchange_failed",
      resourceType: "storage_connection",
      status: "denied",
    });
    redirect("/setup?section=workspace&notice=Google+did+not+return+a+usable+storage+token.");
  }

  const userInfoResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
      },
    },
  );

  const userInfo = (await userInfoResponse.json()) as GoogleUserInfo;

  if (!userInfoResponse.ok || !userInfo.email) {
    recordAuthAuditEvent({
      eventType: "storage.oauth.callback_denied",
      metadata: { mode: savedFlow.mode, userInfoStatus: userInfoResponse.status },
      principal,
      provider: "google_drive",
      reason: "missing_account_details",
      resourceType: "storage_connection",
      status: "denied",
    });
    redirect("/setup?section=workspace&notice=Google+did+not+return+account+details+for+that+connection.");
  }

  const activeConnection = getPrimaryStorageConnectionByOwnerEmail(ownerEmail);
  const decision = resolveStorageOAuthConnectionDecision({
    activeConnection,
    candidate: {
      accountEmail: userInfo.email,
      externalAccountId: userInfo.sub ?? userInfo.email ?? null,
      provider: "google_drive",
    },
    replaceRequested: savedFlow.mode === "replace",
  });

  if (!decision.ok) {
    recordAuthAuditEvent({
      actorEmail: userInfo.email,
      eventType: "storage.replace_denied",
      metadata: {
        activeAccountLabelPresent: Boolean(decision.activeAccountLabel),
        candidateAccountPresent: Boolean(userInfo.email),
        mode: savedFlow.mode,
      },
      principal,
      provider: "google_drive",
      reason: decision.mode,
      resourceType: "storage_connection",
      status: "denied",
    });
    redirect(
      `/setup?section=workspace&notice=${encodeURIComponent(
        `Storage was not changed. This workspace is already connected to ${decision.activeAccountLabel}. Use Replace storage connection to connect ${userInfo.email}.`,
      )}`,
    );
  }

  const externalAccountId =
    decision.mode === "reconnect" && activeConnection
      ? activeConnection.externalAccountId ?? userInfo.sub ?? userInfo.email ?? null
      : userInfo.sub ?? userInfo.email ?? null;

  saveStorageConnectionForOwner({
    ownerEmail,
    provider: "google_drive",
    accountEmail: userInfo.email ?? null,
    accountName: userInfo.name ?? null,
    accountImage: userInfo.picture ?? null,
    externalAccountId,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token ?? null,
    expiresAt:
      typeof tokenJson.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + tokenJson.expires_in
        : null,
    grantedScopes:
      typeof tokenJson.scope === "string" ? tokenJson.scope.split(" ") : [],
    status: "connected",
    makePrimary: decision.makePrimary,
  });

  recordAuthAuditEvent({
    actorEmail: userInfo.email,
    eventType:
      decision.mode === "replace"
        ? "storage.replace_success"
        : decision.mode === "reconnect"
          ? "storage.reconnect"
          : "storage.oauth.callback_success",
    metadata: {
      mode: decision.mode,
      scopeCount:
        typeof tokenJson.scope === "string" ? tokenJson.scope.split(" ").length : 0,
    },
    principal,
    provider: "google_drive",
    resourceId: externalAccountId ?? userInfo.email,
    resourceType: "storage_connection",
    status: "succeeded",
  });

  const notice =
    decision.mode === "replace"
      ? `${userInfo.email} replaced the workspace storage connection.`
      : decision.mode === "reconnect"
        ? `${userInfo.email} was reconnected.`
        : `${userInfo.email} was connected as workspace storage.`;

  redirect(
    `/setup?section=workspace&notice=${encodeURIComponent(
      notice,
    )}`,
  );
}

function parseGoogleOAuthFlowCookie(value: string | undefined) {
  if (!value) {
    return null;
  }

  const [state, mode] = value.split(":", 2);
  if (!state || (mode !== "connect" && mode !== "replace")) {
    return null;
  }

  return { mode, state };
}
