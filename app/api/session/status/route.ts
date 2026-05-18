import { auth } from "@/auth";
import { getApiPrincipalFromSession } from "@/lib/auth/principal";
import { getAccountSessionStatusForSession } from "@/lib/auth/account-session-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const principalResult = await getApiPrincipalFromSession(session, {
    touchSessionActivity: false,
  });

  if (!principalResult.ok) {
    return principalResult.response;
  }

  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getAccountSessionStatusForSession(
    session,
    principalResult.principal,
  );

  return Response.json(status, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
