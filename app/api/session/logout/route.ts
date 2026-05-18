import { auth } from "@/auth";
import { getAppPrincipalFromSession } from "@/lib/auth/principal";
import { invalidateSessionActivityForSession } from "@/lib/auth/session-activity";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ ok: true });
  }

  try {
    const principal = getAppPrincipalFromSession(session);
    await invalidateSessionActivityForSession(session, principal);
  } catch {
    return Response.json(
      { error: "Logout could not invalidate this app session." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
