import "server-only";

import { recordAuthAuditEvent } from "@/lib/audit/auth-audit-events";
import {
  AppPrincipalError,
  requireAppPrincipal,
  type AppPrincipal,
} from "@/lib/auth/principal";

export type SensitiveAction =
  | "history.export_data"
  | "storage.change_provider"
  | "storage.remove_connection"
  | "storage.replace_connection"
  | "team.manage_settings";

export type SensitiveActionAuthorizationContext = {
  provider?: string | null;
  reason?: string | null;
  resourceId?: string | null;
  resourceType?: string | null;
};

export type SensitiveActionAuthorizationResult =
  | {
      ok: true;
      principal: AppPrincipal;
    }
  | {
      error: string;
      ok: false;
      status: 401 | 403;
    };

export async function requireSensitiveActionAuthorization(
  action: SensitiveAction,
  context: SensitiveActionAuthorizationContext = {},
) {
  const principal = await requireAppPrincipal();
  assertSensitiveActionAuthorized(principal, action, context);
  return principal;
}

export function getSensitiveActionAuthorizationResult(
  principal: AppPrincipal | null | undefined,
  action: SensitiveAction,
  context: SensitiveActionAuthorizationContext = {},
): SensitiveActionAuthorizationResult {
  if (!principal) {
    recordSensitiveActionDenied(action, context, "missing_principal");
    return {
      error: "Unauthorized",
      ok: false,
      status: 401,
    };
  }

  return { ok: true, principal };
}

export function assertSensitiveActionAuthorized(
  principal: AppPrincipal | null | undefined,
  action: SensitiveAction,
  context: SensitiveActionAuthorizationContext = {},
): asserts principal is AppPrincipal {
  const result = getSensitiveActionAuthorizationResult(
    principal,
    action,
    context,
  );

  if (!result.ok) {
    throw new AppPrincipalError(result.error, result.status);
  }
}

function recordSensitiveActionDenied(
  action: SensitiveAction,
  context: SensitiveActionAuthorizationContext,
  reason: string,
) {
  recordAuthAuditEvent({
    eventType: getDeniedAuditEventType(action),
    metadata: {
      action,
      reason: context.reason ?? reason,
    },
    provider: context.provider ?? null,
    reason: context.reason ?? reason,
    resourceId: context.resourceId ?? null,
    resourceType: context.resourceType ?? getDefaultResourceType(action),
    status: "denied",
  });
}

function getDeniedAuditEventType(action: SensitiveAction) {
  return action.startsWith("storage.")
    ? "storage.access.denied"
    : "auth.access.denied";
}

function getDefaultResourceType(action: SensitiveAction) {
  if (action.startsWith("storage.")) {
    return "storage_connection";
  }

  if (action === "history.export_data") {
    return "filing_history";
  }

  return "workspace";
}
