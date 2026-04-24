import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { buildAppUrl } from "@/lib/app-url";
import { GOOGLE_DRIVE_WRITE_SCOPE } from "@/lib/google-drive";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    redirect("/setup?section=storage&notice=Google+OAuth+credentials+are+missing+for+this+workspace.");
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
  cookieStore.set("storage_google_oauth_state", state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
