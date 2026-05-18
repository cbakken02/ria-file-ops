import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAppPrincipalResultFromSession } from "@/lib/auth/principal";

export async function requireSession() {
  const session = await auth();
  const principalResult = await getAppPrincipalResultFromSession(session);

  if (!session?.user || !principalResult.ok) {
    const loginPath =
      !principalResult.ok && principalResult.reason
        ? `/login?reason=${encodeURIComponent(principalResult.reason)}`
        : "/login";

    redirect(loginPath);
  }

  return session;
}
