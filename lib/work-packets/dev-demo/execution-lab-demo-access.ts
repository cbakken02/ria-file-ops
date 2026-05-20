import "server-only";

import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { isWaitlistAdminEmail } from "@/lib/admin";
import {
  getApiPrincipalFromSession,
  getAppPrincipalResultFromSession,
  type AppPrincipal,
} from "@/lib/auth/principal";

export async function requireExecutionLabDemoPrincipal(): Promise<AppPrincipal> {
  const session = await auth();
  const principalResult = await getAppPrincipalResultFromSession(session);

  if (!session?.user || !principalResult.ok) {
    const loginPath =
      !principalResult.ok && principalResult.reason
        ? `/login?reason=${encodeURIComponent(principalResult.reason)}`
        : "/login";

    redirect(loginPath);
  }

  if (
    isProductionRuntime() &&
    !isWaitlistAdminEmail(principalResult.principal.email)
  ) {
    notFound();
  }

  return principalResult.principal;
}

export async function getExecutionLabDemoRoutePrincipal(): Promise<
  | {
      ok: true;
      principal: AppPrincipal;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  const session = await auth();
  const principalResult = await getApiPrincipalFromSession(session);

  if (!principalResult.ok) {
    return {
      ok: false,
      response: principalResult.response,
    };
  }

  if (
    isProductionRuntime() &&
    !isWaitlistAdminEmail(principalResult.principal.email)
  ) {
    return {
      ok: false,
      response: new Response("Not found.", { status: 404 }),
    };
  }

  return {
    ok: true,
    principal: principalResult.principal,
  };
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}
