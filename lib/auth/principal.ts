import "server-only";

import crypto from "node:crypto";
import type { Session } from "next-auth";
import {
  enforceSessionActivity,
  SessionActivityError,
} from "@/lib/auth/session-activity";

export type AppRole = "owner" | "admin" | "member";

export type AppPrincipal = {
  userId: string;
  email: string;
  normalizedEmail: string;
  workspaceId: string;
  ownerKey: string;
  legacyOwnerEmail: string;
  role: AppRole;
};

export type ApiPrincipalResult =
  | {
      ok: true;
      principal: AppPrincipal;
    }
  | {
      ok: false;
      response: Response;
      status: 401 | 403;
      error: string;
    };

export type AppPrincipalResult =
  | {
      ok: true;
      principal: AppPrincipal;
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
      reason?: string;
    };

type PrincipalSession =
  | Pick<Session, "appSessionCreatedAt" | "appSessionIdHash" | "user">
  | {
      appSessionCreatedAt?: string | null;
      appSessionIdHash?: string | null;
      user?: {
        email?: string | null;
        id?: string | null;
      } | null;
    }
  | null
  | undefined;

type PrincipalSessionOptions = {
  touchSessionActivity?: boolean;
};

export class AppPrincipalError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403 = 403) {
    super(message);
    this.name = "AppPrincipalError";
    this.status = status;
  }
}

export function normalizeOwnerEmail(input: string): string {
  const normalized = input.trim().toLowerCase();

  if (!normalized) {
    throw new AppPrincipalError("A signed-in email is required.", 401);
  }

  return normalized;
}

export function buildWorkspaceIdFromOwnerKey(ownerKey: string): string {
  const normalizedOwnerKey = normalizeOwnerEmail(ownerKey);
  const digest = crypto
    .createHash("sha256")
    .update(normalizedOwnerKey)
    .digest("hex")
    .slice(0, 16);

  return `workspace:${digest}`;
}

export function getAppPrincipalFromSession(
  session: PrincipalSession,
): AppPrincipal {
  const email = normalizeOwnerEmail(session?.user?.email ?? "");
  const ownerKey = email;

  return {
    userId: session?.user?.id?.trim() || email,
    email,
    normalizedEmail: email,
    workspaceId: buildWorkspaceIdFromOwnerKey(ownerKey),
    ownerKey,
    legacyOwnerEmail: ownerKey,
    role: "owner",
  };
}

export async function getAppPrincipalOrNull() {
  const { auth } = await import("@/auth");
  const session = await auth();
  const result = await getAppPrincipalResultFromSession(session);

  return result.ok ? result.principal : null;
}

export async function getAppPrincipalResultFromSession(
  session: PrincipalSession,
  options: PrincipalSessionOptions = {},
): Promise<AppPrincipalResult> {
  try {
    const principal = getAppPrincipalFromSession(session);
    await enforceSessionActivity(session, principal, {
      touch: options.touchSessionActivity,
    });
    return { ok: true, principal };
  } catch (error) {
    return appPrincipalErrorResult(error);
  }
}

export async function requireAppPrincipal(): Promise<AppPrincipal> {
  const { auth } = await import("@/auth");
  const session = await auth();
  const result = await getAppPrincipalResultFromSession(session);

  if (result.ok) {
    return result.principal;
  }

  return await redirectToLogin(result.reason);
}

export async function requireApiPrincipal(): Promise<ApiPrincipalResult> {
  const { auth } = await import("@/auth");
  const session = await auth();

  return getApiPrincipalFromSession(session);
}

export async function requireWorkspaceAccess(workspaceId?: string) {
  const principal = await requireAppPrincipal();

  if (workspaceId && workspaceId !== principal.workspaceId) {
    throw new AppPrincipalError("Forbidden", 403);
  }

  return principal;
}

export async function requireWorkspaceRole(role: AppRole | AppRole[]) {
  const principal = await requireAppPrincipal();
  const allowedRoles = Array.isArray(role) ? role : [role];

  if (!allowedRoles.includes(principal.role)) {
    throw new AppPrincipalError("Forbidden", 403);
  }

  return principal;
}

export function assertOwnerKeyMatchesPrincipal(
  principal: AppPrincipal,
  ownerKey: string,
) {
  if (principal.ownerKey !== normalizeOwnerEmail(ownerKey)) {
    throw new AppPrincipalError("Forbidden", 403);
  }
}

export function getLegacyOwnerEmail(principal: AppPrincipal) {
  return principal.legacyOwnerEmail;
}

export async function getApiPrincipalFromSession(
  session: PrincipalSession,
  options: PrincipalSessionOptions = {},
): Promise<ApiPrincipalResult> {
  const result = await getAppPrincipalResultFromSession(session, options);

  if (result.ok) {
    return { ok: true, principal: result.principal };
  }

  return apiPrincipalError(result.error, result.status);
}

function apiPrincipalError(
  error: string,
  status: 401 | 403,
): ApiPrincipalResult {
  return {
    ok: false,
    error,
    response: Response.json({ error }, { status }),
    status,
  };
}

async function redirectToLogin(reason?: string): Promise<never> {
  const { redirect } = await import("next/navigation");
  redirect(reason ? `/login?reason=${encodeURIComponent(reason)}` : "/login");
  throw new AppPrincipalError("Redirecting to login.", 401);
}

function appPrincipalErrorResult(error: unknown): AppPrincipalResult {
  if (error instanceof SessionActivityError) {
    return {
      ok: false,
      status: error.status,
      error: "Session expired",
      reason: error.reason,
    };
  }

  if (error instanceof AppPrincipalError) {
    return {
      ok: false,
      status: error.status,
      error: error.status === 401 ? "Unauthorized" : "Forbidden",
    };
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized",
  };
}
