import { auth } from "@/auth";
import { getApiPrincipalFromSession } from "@/lib/auth/principal";
import { getAccountSessionStatusForSession } from "@/lib/auth/account-session-status";
import { recordAuthAuditEvent } from "@/lib/audit/auth-audit-events";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  const principalResult = await getApiPrincipalFromSession(session);

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
  recordAuthAuditEvent({
    eventType: "auth.session.keepalive",
    metadata: { sessionStatus: status.session.status },
    principal: principalResult.principal,
    resourceType: "app_session",
    status: "succeeded",
  });

  return Response.json(status, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
