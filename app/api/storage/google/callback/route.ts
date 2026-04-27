import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { buildAppUrl } from "@/lib/app-url";
import {
  getPrimaryStorageConnectionByOwnerEmail,
  saveStorageConnectionForOwner,
} from "@/lib/db";

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
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieStore = await cookies();
  const savedState = cookieStore.get("storage_google_oauth_state")?.value;
  cookieStore.delete("storage_google_oauth_state");

  if (error) {
    redirect(
      `/setup?section=workspace&notice=${encodeURIComponent(
        `Google returned an authorization error: ${error}.`,
      )}`,
    );
  }

  if (!code || !state || !savedState || state !== savedState) {
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
    redirect("/setup?section=workspace&notice=Google+did+not+return+account+details+for+that+connection.");
  }

  saveStorageConnectionForOwner({
    ownerEmail: session.user.email,
    provider: "google_drive",
    accountEmail: userInfo.email ?? null,
    accountName: userInfo.name ?? null,
    accountImage: userInfo.picture ?? null,
    externalAccountId: userInfo.sub ?? userInfo.email ?? null,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token ?? null,
    expiresAt:
      typeof tokenJson.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + tokenJson.expires_in
        : null,
    grantedScopes:
      typeof tokenJson.scope === "string" ? tokenJson.scope.split(" ") : [],
    status: "connected",
    makePrimary: !getPrimaryStorageConnectionByOwnerEmail(session.user.email),
  });

  redirect(
    `/setup?section=workspace&notice=${encodeURIComponent(
      `${userInfo.email} was added as a storage connection.`,
    )}`,
  );
}
