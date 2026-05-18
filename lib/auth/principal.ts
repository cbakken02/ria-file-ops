import "server-only";

import crypto from "node:crypto";
import type { Session } from "next-auth";

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

type PrincipalSession =
  | Pick<Session, "user">
  | {
      user?: {
        email?: string | null;
        id?: string | null;
      } | null;
    }
  | null
  | undefined;

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

  try {
    return getAppPrincipalFromSession(session);
  } catch {
    return null;
  }
}

export async function requireAppPrincipal(): Promise<AppPrincipal> {
  const principal = await getAppPrincipalOrNull();

  if (principal) {
    return principal;
  }

  return await redirectToLogin();
}

export async function requireApiPrincipal(): Promise<ApiPrincipalResult> {
  const principal = await getAppPrincipalOrNull();

  if (!principal) {
    return apiPrincipalError("Unauthorized", 401);
  }

  return { ok: true, principal };
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

export function getApiPrincipalFromSession(
  session: PrincipalSession,
): ApiPrincipalResult {
  try {
    return { ok: true, principal: getAppPrincipalFromSession(session) };
  } catch {
    return apiPrincipalError("Unauthorized", 401);
  }
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

async function redirectToLogin(): Promise<never> {
  const { redirect } = await import("next/navigation");
  redirect("/login");
  throw new AppPrincipalError("Redirecting to login.", 401);
}
