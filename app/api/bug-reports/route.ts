import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getApiPrincipalFromSession,
  getLegacyOwnerEmail,
} from "@/lib/auth/principal";
import { createBugReport } from "@/lib/db";

export async function POST(request: Request) {
  const session = await auth();
  const principalResult = getApiPrincipalFromSession(session);

  if (!principalResult.ok) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const ownerEmail = getLegacyOwnerEmail(principalResult.principal);

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const message =
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
      ? payload.message.trim()
      : "";

  const currentPath =
    typeof payload === "object" &&
    payload !== null &&
    "currentPath" in payload &&
    typeof payload.currentPath === "string" &&
    payload.currentPath.trim()
      ? payload.currentPath.trim()
      : null;

  if (message.length < 3) {
    return NextResponse.json(
      { error: "Add a few details before submitting." },
      { status: 400 },
    );
  }

  createBugReport({
    ownerEmail,
    reporterEmail: principalResult.principal.email,
    reporterName: session?.user?.name ?? null,
    currentPath,
    message,
  });

  return NextResponse.json({ ok: true });
}
